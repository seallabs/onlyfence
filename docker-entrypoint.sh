#!/bin/sh
set -e

# Resolve password from file or environment
if [ -n "$FENCE_PASSWORD_FILE" ] && [ -f "$FENCE_PASSWORD_FILE" ]; then
  FENCE_PASSWORD=$(cat "$FENCE_PASSWORD_FILE")
  export FENCE_PASSWORD
fi

if [ -z "$FENCE_PASSWORD" ]; then
  echo "Error: FENCE_PASSWORD or FENCE_PASSWORD_FILE is required." >&2
  echo "  Set FENCE_PASSWORD env var or mount a password file and set FENCE_PASSWORD_FILE." >&2
  exit 1
fi

# Password is passed via FENCE_PASSWORD env var (resolved by daemon/index.ts).
# NEVER pass it as a CLI argument — it would be visible in /proc/<pid>/cmdline.
# Bind to 127.0.0.1 inside the container; Docker port mapping handles host exposure.
exec node dist/cli/index.js start \
  --tcp-host "${FENCE_TCP_HOST:-127.0.0.1}" \
  --tcp-port "${FENCE_TCP_PORT:-19876}" \
  "$@"
