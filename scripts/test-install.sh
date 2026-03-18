#!/usr/bin/env bash
# Test the install.sh script locally without creating a GitHub release.
#
# Usage:
#   ./scripts/test-install.sh              # build + install to temp dir
#   ./scripts/test-install.sh --keep       # keep the temp install dir for inspection
#   ./scripts/test-install.sh --in-place   # install to ~/.onlyfence (like real users)
#
# What it does:
#   1. Builds a standalone tarball via package-standalone.sh
#   2. Runs install.sh using file:// URL pointing at the local tarball
#   3. Verifies the installation works (fence --version)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

KEEP=false
IN_PLACE=false

for arg in "$@"; do
  case "$arg" in
    --keep)     KEEP=true ;;
    --in-place) IN_PLACE=true ;;
    -h|--help)
      echo "Usage: $0 [--keep] [--in-place]"
      echo ""
      echo "  --keep      Keep temp install dir for inspection"
      echo "  --in-place  Install to ~/.onlyfence (like a real user)"
      echo ""
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ─── Step 1: Build standalone tarball ─────────────────────────────────────────

echo "==> Building standalone tarball..."
"${SCRIPT_DIR}/package-standalone.sh"

VERSION=$(node -e "console.log(require('${PROJECT_ROOT}/package.json').version)")
OUTPUT_DIR="${PROJECT_ROOT}/dist-standalone"

# Verify tarball exists
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in linux*) OS="linux" ;; darwin*) OS="darwin" ;; esac

ARCH=$(uname -m)
case "$ARCH" in x86_64|amd64) ARCH="x64" ;; aarch64|arm64) ARCH="arm64" ;; esac

TARBALL="onlyfence-v${VERSION}-${OS}-${ARCH}.tar.gz"
TARBALL_PATH="${OUTPUT_DIR}/${TARBALL}"

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
if [ -n "$INSTALL_DIR" ]; then
  export ONLYFENCE_INSTALL_DIR="${INSTALL_DIR}"
fi

sh "${PROJECT_ROOT}/install.sh"

# ─── Step 3: Verify ──────────────────────────────────────────────────────────

FENCE_BIN="${ONLYFENCE_INSTALL_DIR:-$HOME/.onlyfence}/bin/fence"

echo ""
echo "==> Verifying installation..."

if [ -x "$FENCE_BIN" ]; then
  FENCE_VERSION=$("$FENCE_BIN" --version 2>/dev/null || echo "unknown")
  echo "==> SUCCESS: fence v${FENCE_VERSION}"
else
  echo "error: fence binary not found or not executable at ${FENCE_BIN}" >&2
  exit 1
fi

# ─── Step 4: Cleanup ─────────────────────────────────────────────────────────

if [ -n "$INSTALL_DIR" ] && [ "$KEEP" = false ]; then
  echo "==> Cleaning up temp install dir..."
  rm -rf "$INSTALL_DIR"
  echo "==> Done. (use --keep to preserve install dir for inspection)"
else
  echo "==> Install dir preserved at: ${ONLYFENCE_INSTALL_DIR:-$HOME/.onlyfence}"
fi
