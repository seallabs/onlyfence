#!/usr/bin/env bash
# Build a standalone distributable tarball for the current platform.
#
# Usage: ./scripts/package-standalone.sh [version]
#
# Output: dist-standalone/onlyfence-<version>-<os>-<arch>.tar.gz
#
# The tarball contains:
#   lib/          — compiled JS (production dist)
#   node_modules/ — production dependencies (including native addons)
#   runtime/node  — bundled Node.js binary (no system Node.js required)
#   package.json  — version metadata

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

VERSION="${1:-$(node -e "console.log(require('./package.json').version)")}"
NODE_VERSION="v25.0.0"

# Detect platform
case "$(uname -s)" in
  Linux*)  OS="linux" ;;
  Darwin*) OS="darwin" ;;
  *)       echo "error: Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64)  ARCH="x64" ;;
  aarch64|arm64)  ARCH="arm64" ;;
  *)              echo "error: Unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

TARBALL_NAME="onlyfence-${VERSION}-${OS}-${ARCH}.tar.gz"
STAGING_DIR="${PROJECT_ROOT}/dist-standalone/staging"
OUTPUT_DIR="${PROJECT_ROOT}/dist-standalone"

echo "==> Building OnlyFence ${VERSION} for ${OS}-${ARCH}"

# Step 1: Clean
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$OUTPUT_DIR"

# Step 2: Build TypeScript
echo "==> Compiling TypeScript..."
cd "$PROJECT_ROOT"
npm run build

# Step 3: Copy compiled output
echo "==> Copying dist to lib/..."
cp -r "${PROJECT_ROOT}/dist" "${STAGING_DIR}/lib"

# Step 4: Install production dependencies into staging
echo "==> Installing production dependencies..."
cp "${PROJECT_ROOT}/package.json" "${STAGING_DIR}/package.json"
cp "${PROJECT_ROOT}/package-lock.json" "${STAGING_DIR}/package-lock.json" 2>/dev/null || true
cp -r "${PROJECT_ROOT}/scripts" "${STAGING_DIR}/scripts"
cd "$STAGING_DIR"
npm install --omit=dev --ignore-scripts=false

# Step 5: Rebuild native addons for current platform
echo "==> Rebuilding native addons..."
npm rebuild better-sqlite3

# Step 6: Download Node.js runtime
echo "==> Downloading Node.js ${NODE_VERSION} for ${OS}-${ARCH}..."
NODE_DIST_NAME="node-${NODE_VERSION}-${OS}-${ARCH}"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_DIST_NAME}.tar.xz"

NODE_TMP="${STAGING_DIR}/_node_tmp"
mkdir -p "$NODE_TMP" "${STAGING_DIR}/runtime"

curl -fsSL --retry 3 "$NODE_URL" | tar -xJ -C "$NODE_TMP"

cp "${NODE_TMP}/${NODE_DIST_NAME}/bin/node" "${STAGING_DIR}/runtime/node"
chmod +x "${STAGING_DIR}/runtime/node"
rm -rf "$NODE_TMP"

NODE_SIZE=$(du -h "${STAGING_DIR}/runtime/node" | cut -f1)
echo "==> Bundled Node.js binary: ${NODE_SIZE}"

# Step 7: Remove unnecessary files to reduce size
echo "==> Pruning unnecessary files..."
find "${STAGING_DIR}/node_modules" -type f \( \
  -name "*.md" -o \
  -name "*.ts" -o \
  -name "*.map" -o \
  -name "*.d.ts" -o \
  -name "CHANGELOG*" -o \
  -name "HISTORY*" -o \
  -name "LICENSE*" -o \
  -name "LICENCE*" -o \
  -name ".eslintrc*" -o \
  -name ".prettierrc*" -o \
  -name "tsconfig.json" -o \
  -name ".travis.yml" -o \
  -name ".github" \
\) -delete 2>/dev/null || true

find "${STAGING_DIR}/node_modules" -type d -name "__tests__" -exec rm -rf {} + 2>/dev/null || true
find "${STAGING_DIR}/node_modules" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true
find "${STAGING_DIR}/node_modules" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find "${STAGING_DIR}/node_modules" -type d -name "docs" -exec rm -rf {} + 2>/dev/null || true
find "${STAGING_DIR}/node_modules" -type d -name "example" -exec rm -rf {} + 2>/dev/null || true
find "${STAGING_DIR}/node_modules" -type d -name "examples" -exec rm -rf {} + 2>/dev/null || true

# Remove build scripts (only needed for postinstall) and devDependencies
rm -rf "${STAGING_DIR}/scripts"
node -e "
  const pkg = require('./package.json');
  delete pkg.devDependencies;
  delete pkg.scripts;
  require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Step 8: Create tarball
echo "==> Creating ${TARBALL_NAME}..."
cd "$STAGING_DIR"
tar -czf "${OUTPUT_DIR}/${TARBALL_NAME}" \
  lib/ \
  node_modules/ \
  runtime/ \
  package.json

# Step 9: Report
SIZE=$(du -h "${OUTPUT_DIR}/${TARBALL_NAME}" | cut -f1)
echo "==> Done: ${OUTPUT_DIR}/${TARBALL_NAME} (${SIZE})"

# Cleanup staging
rm -rf "$STAGING_DIR"
