#!/usr/bin/env sh
# OnlyFence installer
# Usage: curl -fsSL https://raw.githubusercontent.com/seallabs/onlyfence/main/install.sh | sh
#
# Respects:
#   ONLYFENCE_INSTALL_DIR  - installation directory (default: ~/.onlyfence)
#   ONLYFENCE_VERSION      - specific version to install, used as-is (e.g. 0.1.0-beta.2)
#   ONLYFENCE_REPO         - GitHub repo (default: seallabs/onlyfence)
#   ONLYFENCE_SKIP_SETUP   - skip auto-running fence setup after install (for testing)

set -eu

REPO="${ONLYFENCE_REPO:-seallabs/onlyfence}"
INSTALL_DIR="${ONLYFENCE_INSTALL_DIR:-$HOME/.onlyfence}"
BIN_DIR="${INSTALL_DIR}/bin"
# Override base URL for local testing (e.g. http://localhost:8888 or file:///path/to)
BASE_URL="${ONLYFENCE_BASE_URL:-}"
# Skip writing PATH to shell profile (useful for testing)
SKIP_PATH_SETUP="${ONLYFENCE_SKIP_PATH_SETUP:-}"
# Skip auto-running fence setup after install (useful for testing)
SKIP_SETUP="${ONLYFENCE_SKIP_SETUP:-}"

# ─── Colors ──────────────────────────────────────────────────────────────────

if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  BOLD='\033[1m'
  DIM='\033[2m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' BOLD='' DIM='' RESET=''
fi

info()  { printf "${BLUE}info${RESET}  %s\n" "$*"; }
warn()  { printf "${YELLOW}warn${RESET}  %s\n" "$*"; }
error() { printf "${RED}error${RESET} %s\n" "$*" >&2; }
ok()    { printf "${GREEN}ok${RESET}    %s\n" "$*"; }

# ─── Banner ──────────────────────────────────────────────────────────────────

print_banner() {
  if [ ! -t 1 ]; then
    printf "\nOnlyFence Installer\n\n"
    return
  fi

  # True-color ANSI codes for octopus logo
  # L=#60a5fa  M=#3b82f6  D=#2563eb  E=#e0f2fe
  _fL='\033[38;2;96;165;250m'
  _fM='\033[38;2;59;130;246m'
  _fD='\033[38;2;37;99;235m'
  _fE='\033[38;2;224;242;254m'
  _bL='\033[48;2;96;165;250m'
  _bM='\033[48;2;59;130;246m'

  # 9×8 pixel art packed into 4 terminal rows via ▀/▄ half-blocks
  # Row pairs: (0,1) (2,3) (4,5) (6,7)
  _r1=" ${_fM}▄${RESET}${_fL}${_bM}▀▀▀▀▀${RESET}${_fM}▄${RESET} "
  _r2=" ${_bM}${_fM}▀${_fE}▀${_fM}▀${_fD}▀${_fM}▀${_fE}▀${_fM}▀${RESET} "
  _r3="${_fM}▄${RESET}${_fD}▀${_fD}${_bM}▀▀${RESET}${_fD}▀${_fD}${_bM}▀▀${RESET}${_fD}▀${RESET}${_fM}▄${RESET}"
  _r4="${_fD}${_bL}▀${RESET} ${_fD}${_bL}▀${RESET} ${_fM}${_bL}▀${RESET} ${_fD}${_bL}▀${RESET} ${_fD}${_bL}▀${RESET}"

  # Right-side text aligned to logo rows
  _t2="${BOLD}${_fL}OnlyFence${RESET}"
  _t3="${DIM}Installer${RESET}"

  printf "\n"
  printf "  %b\n"        "$_r1"
  printf "  %b  %b\n"    "$_r2" "$_t2"
  printf "  %b  %b\n"    "$_r3" "$_t3"
  printf "  %b\n"        "$_r4"
  printf "\n"
}

# ─── Platform detection ──────────────────────────────────────────────────────

detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "darwin" ;;
    *)       error "Unsupported OS: $(uname -s)"; exit 1 ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  echo "x64" ;;
    aarch64|arm64)  echo "arm64" ;;
    *)              error "Unsupported architecture: $(uname -m)"; exit 1 ;;
  esac
}

# ─── Download helpers ────────────────────────────────────────────────────────

check_command() {
  command -v "$1" >/dev/null 2>&1
}

select_downloader() {
  if check_command curl; then
    echo "curl"
  elif check_command wget; then
    echo "wget"
  else
    error "Neither curl nor wget found. Install one and retry."
    exit 1
  fi
}

download() {
  url="$1"
  output="$2"
  downloader=$(select_downloader)

  case "$downloader" in
    curl) curl -fsSL --retry 3 -o "$output" "$url" ;;
    wget) wget -q --tries=3 -O "$output" "$url" ;;
  esac
}

download_to_stdout() {
  url="$1"
  downloader=$(select_downloader)

  case "$downloader" in
    curl) curl -fsSL --retry 3 "$url" ;;
    wget) wget -qO- --tries=3 "$url" ;;
  esac
}

# ─── Version resolution ─────────────────────────────────────────────────────

get_latest_version() {
  download_to_stdout "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' \
    | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/'
}

# ─── Installation ───────────────────────────────────────────────────────────

install_from_github_release() {
  version="$1"
  os="$2"
  arch="$3"

  tarball="onlyfence-${version}-${os}-${arch}.tar.gz"
  if [ -n "$BASE_URL" ]; then
    url="${BASE_URL}/${tarball}"
  else
    url="https://github.com/${REPO}/releases/download/${version}/${tarball}"
  fi

  info "Downloading OnlyFence ${version} for ${os}-${arch}..."

  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT

  # Support file:// URLs by copying directly
  case "$url" in
    file://*)
      local_path="${url#file://}"
      cp "$local_path" "${tmpdir}/${tarball}" || { error "Failed to copy ${local_path}"; return 1; }
      ;;
    *)
      download "$url" "${tmpdir}/${tarball}"
      ;;
  esac

  if [ ! -s "${tmpdir}/${tarball}" ]; then
    return 1
  fi

  info "Extracting to ${INSTALL_DIR}..."

  # Clean previous installation but preserve user data
  rm -rf "${INSTALL_DIR:?}/lib" "${INSTALL_DIR:?}/node_modules" "${INSTALL_DIR:?}/runtime"
  mkdir -p "${INSTALL_DIR}" "${BIN_DIR}"

  tar -xzf "${tmpdir}/${tarball}" -C "${INSTALL_DIR}"

  # Verify bundled runtime exists
  if [ ! -x "${INSTALL_DIR}/runtime/node" ]; then
    error "Bundled Node.js runtime not found in release archive."
    return 1
  fi

  # Create bin wrapper that uses the bundled Node.js
  cat > "${BIN_DIR}/fence" <<'WRAPPER'
#!/usr/bin/env sh
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(dirname "$SCRIPT_DIR")"
exec "${INSTALL_DIR}/runtime/node" "${INSTALL_DIR}/lib/cli/index.js" "$@"
WRAPPER

  chmod +x "${BIN_DIR}/fence"
  return 0
}

# ─── PATH setup ─────────────────────────────────────────────────────────────

setup_path() {
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) return 0 ;; # Already in PATH
  esac

  shell_name="$(basename "${SHELL:-/bin/sh}")"
  export_line="export PATH=\"${BIN_DIR}:\$PATH\""

  case "$shell_name" in
    zsh)
      profile="$HOME/.zshrc"
      ;;
    bash)
      if [ -f "$HOME/.bash_profile" ]; then
        profile="$HOME/.bash_profile"
      else
        profile="$HOME/.bashrc"
      fi
      ;;
    fish)
      fish_conf_dir="${XDG_CONFIG_HOME:-$HOME/.config}/fish"
      mkdir -p "$fish_conf_dir"
      profile="${fish_conf_dir}/config.fish"
      export_line="fish_add_path ${BIN_DIR}"
      ;;
    *)
      profile="$HOME/.profile"
      ;;
  esac

  if [ -n "$profile" ]; then
    # Avoid duplicate entries
    if ! grep -qF "$BIN_DIR" "$profile" 2>/dev/null; then
      printf '\n# OnlyFence\n%s\n' "$export_line" >> "$profile"
      info "Added ${BIN_DIR} to PATH in ${profile}"
    fi
  fi
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  print_banner

  os=$(detect_os)
  arch=$(detect_arch)

  # Resolve version
  version="${ONLYFENCE_VERSION:-}"
  if [ -z "$version" ]; then
    if [ -n "$BASE_URL" ]; then
      error "ONLYFENCE_VERSION is required when using ONLYFENCE_BASE_URL"
      exit 1
    fi
    info "Resolving latest version..."
    version=$(get_latest_version) || true
  fi

  if [ -z "$version" ]; then
    error "Could not resolve version. Set ONLYFENCE_VERSION or check your network."
    exit 1
  fi

  if install_from_github_release "$version" "$os" "$arch"; then
    ok "Installed OnlyFence ${version}"
  else
    error "Installation failed. No release found for ${os}-${arch}."
    info "Check available releases at https://github.com/${REPO}/releases"
    exit 1
  fi

  # Setup PATH
  if [ -z "$SKIP_PATH_SETUP" ]; then
    setup_path
  fi

  # Verify
  printf "\n"
  if [ -x "${BIN_DIR}/fence" ]; then
    ok "OnlyFence installed to ${BIN_DIR}/fence"

    # Check if it's in the current PATH
    case ":${PATH}:" in
      *":${BIN_DIR}:"*)
        fence_ver=$("${BIN_DIR}/fence" --version 2>/dev/null || echo "unknown")
        ok "fence ${fence_ver} is ready"
        ;;
      *)
        warn "Restart your shell or run:"
        printf "\n  export PATH=\"%s:\$PATH\"\n\n" "$BIN_DIR"
        ;;
    esac

    # Auto-run setup on first install (skip if already set up or via ONLYFENCE_SKIP_SETUP)
    if [ -z "$SKIP_SETUP" ] && [ ! -f "${INSTALL_DIR}/keystore" ]; then
      # Detect TTY: [ -e /dev/tty ] is not enough — on CI the node exists but cannot be opened.
      has_tty=false
      if [ -t 0 ]; then
        has_tty=true
      elif (exec </dev/tty) 2>/dev/null; then
        has_tty=true
      fi

      if [ "$has_tty" = true ]; then
        printf "\n"
        info "Starting setup wizard..."
        printf "\n"
        # Re-attach stdin to the terminal so interactive prompts work
        # even when the installer was piped via curl | sh
        "${BIN_DIR}/fence" setup </dev/tty
      else
        info "No interactive terminal detected — skipping setup wizard."
        printf "\n%bGet started:%b\n" "$BOLD" "$RESET"
        printf "  fence setup        # Initialize wallet and config\n"
        printf "  fence --help       # See all commands\n\n"
      fi
    else
      if [ -f "${INSTALL_DIR}/keystore" ]; then
        ok "Existing wallet and config preserved."
      fi
      printf "\n%bGet started:%b\n" "$BOLD" "$RESET"
      printf "  fence setup        # Re-run setup wizard\n"
      printf "  fence --help       # See all commands\n\n"
    fi
  else
    error "Installation failed — ${BIN_DIR}/fence not found."
    exit 1
  fi
}

main "$@"
