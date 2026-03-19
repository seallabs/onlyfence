#!/usr/bin/env bash
# Test the install.sh script locally without creating a GitHub release.
#
# Usage:
#   ./scripts/test-install.sh              # build + install + verify
#   ./scripts/test-install.sh --setup      # build + install + run fence setup interactively
#   ./scripts/test-install.sh --run "swap" # build + install + run any fence subcommand
#   ./scripts/test-install.sh --keep       # keep the temp install dir for inspection
#   ./scripts/test-install.sh --in-place   # install to ~/.onlyfence (like real users)
#   ./scripts/test-install.sh --no-build   # skip build, reuse existing tarball
#
# What it does:
#   1. Builds a standalone tarball via package-standalone.sh
#   2. Runs install.sh using file:// URL pointing at the local tarball
#   3. Verifies the installation works (fence --version)
#   4. Optionally launches fence setup or any subcommand interactively

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

KEEP=false
IN_PLACE=false
RUN_SETUP=false
RUN_CMD=""
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --keep)      KEEP=true ;;
    --in-place)  IN_PLACE=true ;;
    --setup)     RUN_SETUP=true; KEEP=true ;;
    --run=*)     RUN_CMD="${arg#--run=}"; KEEP=true ;;
    --no-build)  SKIP_BUILD=true ;;
    -h|--help)
      echo "Usage: $0 [--setup] [--run=COMMAND] [--keep] [--in-place] [--no-build]"
      echo ""
      echo "  --setup     Run 'fence setup' interactively after install"
      echo "  --run=CMD   Run 'fence CMD' interactively after install (e.g. --run=status)"
      echo "  --keep      Keep temp install dir for inspection"
      echo "  --in-place  Install to ~/.onlyfence (like a real user)"
      echo "  --no-build  Skip build, reuse existing tarball from dist-standalone/"
      echo ""
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

VERSION=$(node -e "console.log(require('${PROJECT_ROOT}/package.json').version)")
OUTPUT_DIR="${PROJECT_ROOT}/dist-standalone"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in linux*) OS="linux" ;; darwin*) OS="darwin" ;; esac

ARCH=$(uname -m)
case "$ARCH" in x86_64|amd64) ARCH="x64" ;; aarch64|arm64) ARCH="arm64" ;; esac

TARBALL="onlyfence-${VERSION}-${OS}-${ARCH}.tar.gz"
TARBALL_PATH="${OUTPUT_DIR}/${TARBALL}"

# ─── Step 1: Build standalone tarball ─────────────────────────────────────────

if [ "$SKIP_BUILD" = true ]; then
  if [ ! -f "$TARBALL_PATH" ]; then
    echo "error: --no-build specified but tarball not found: ${TARBALL_PATH}" >&2
    echo "       Run without --no-build first to create it." >&2
    exit 1
  fi
  echo "==> Skipping build, reusing: ${TARBALL_PATH}"
else
  echo "==> Building standalone tarball..."
  "${SCRIPT_DIR}/package-standalone.sh"
fi

if [ ! -f "$TARBALL_PATH" ]; then
  echo "error: Expected tarball not found: ${TARBALL_PATH}" >&2
  exit 1
fi

echo "==> Built: ${TARBALL_PATH}"

# ─── Step 2: Run install.sh with local tarball ────────────────────────────────

INSTALL_DIR=""
if [ "$IN_PLACE" = true ]; then
  echo "==> Installing to ~/.onlyfence (in-place mode)..."
else
  INSTALL_DIR=$(mktemp -d)
  echo "==> Installing to temp dir: ${INSTALL_DIR}"
fi

export ONLYFENCE_BASE_URL="file://${OUTPUT_DIR}"
export ONLYFENCE_VERSION="${VERSION}"
export ONLYFENCE_SKIP_SETUP=1  # Suppress auto-setup; tested separately below
if [ -n "$INSTALL_DIR" ]; then
  export ONLYFENCE_INSTALL_DIR="${INSTALL_DIR}"
  export ONLYFENCE_SKIP_PATH_SETUP=1
fi

sh "${PROJECT_ROOT}/install.sh"

# ─── Step 3: Verify ──────────────────────────────────────────────────────────

RESOLVED_DIR="${ONLYFENCE_INSTALL_DIR:-$HOME/.onlyfence}"
FENCE_BIN="${RESOLVED_DIR}/bin/fence"

echo ""
echo "==> Verifying installation..."

if [ -x "$FENCE_BIN" ]; then
  FENCE_VERSION=$("$FENCE_BIN" --version 2>/dev/null || echo "unknown")
  echo "==> SUCCESS: fence ${FENCE_VERSION}"
else
  echo "error: fence binary not found or not executable at ${FENCE_BIN}" >&2
  exit 1
fi

# ─── Step 3b: Verify installer setup behavior ──────────────────────────────
# Helper to run install.sh with no TTY and check output for expected message.
# Uses setsid to detach from the controlling terminal so /dev/tty is
# inaccessible — simulating a true no-TTY environment (e.g. CI).
run_install_expect() {
  local install_dir="$1" expected="$2" label="$3"
  local output
  output=$(
    ONLYFENCE_SKIP_SETUP="" \
    ONLYFENCE_BASE_URL="file://${OUTPUT_DIR}" \
    ONLYFENCE_VERSION="${VERSION}" \
    ONLYFENCE_INSTALL_DIR="${install_dir}" \
    ONLYFENCE_SKIP_PATH_SETUP=1 \
    perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die "exec: $!"' \
      sh "${PROJECT_ROOT}/install.sh" 2>&1 </dev/null || true
  )
  if echo "$output" | grep -q "$expected"; then
    echo "==> PASS: ${label}"
  else
    echo "error: ${label}" >&2
    echo "       Expected: ${expected}" >&2
    echo "       Output was:" >&2
    echo "$output" >&2
    rm -rf "$install_dir"
    exit 1
  fi
}

# First install with no TTY: setup should be skipped (no terminal detected)
echo ""
echo "==> Verifying installer setup flow (first install, no TTY)..."
FRESH_DIR=$(mktemp -d)
run_install_expect "$FRESH_DIR" \
  "No interactive terminal detected" \
  "installer detects no TTY and skips setup on first install"

# Re-install with keystore: setup should be skipped (already set up)
echo "==> Verifying installer skips setup on re-install..."
touch "${FRESH_DIR}/keystore"
run_install_expect "$FRESH_DIR" \
  "Existing wallet and config preserved" \
  "installer skips setup when keystore exists (re-install)"

rm -rf "$FRESH_DIR"

# ─── Step 4: Run setup or command interactively ──────────────────────────────

if [ "$RUN_SETUP" = true ]; then
  echo ""
  echo "==> Launching 'fence setup' (data dir: ${RESOLVED_DIR})..."
  echo "    All data (config, keystore, db) will be stored in: ${RESOLVED_DIR}"
  echo ""
  ONLYFENCE_HOME="${RESOLVED_DIR}" "$FENCE_BIN" setup
elif [ -n "$RUN_CMD" ]; then
  echo ""
  echo "==> Launching 'fence ${RUN_CMD}' (data dir: ${RESOLVED_DIR})..."
  echo ""
  ONLYFENCE_HOME="${RESOLVED_DIR}" "$FENCE_BIN" "${RUN_CMD}"
fi

# ─── Step 5: Cleanup ─────────────────────────────────────────────────────────

if [ -n "$INSTALL_DIR" ] && [ "$KEEP" = false ]; then
  echo "==> Cleaning up temp install dir..."
  rm -rf "$INSTALL_DIR"
  echo "==> Done. (use --keep to preserve install dir for inspection)"
else
  if [ -n "$INSTALL_DIR" ]; then
    echo ""
    echo "==> Install dir preserved at: ${RESOLVED_DIR}"
    echo "    Re-run setup:  ONLYFENCE_HOME=${RESOLVED_DIR} ${FENCE_BIN} setup"
    echo "    Run any cmd:   ONLYFENCE_HOME=${RESOLVED_DIR} ${FENCE_BIN} --help"
    echo "    Clean up:      rm -rf ${RESOLVED_DIR}"
  fi
fi
