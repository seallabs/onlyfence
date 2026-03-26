#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# OnlyFence Docker entrypoint
#
# Handles two concerns:
#   1. First-run setup: if no keystore exists, create one from secrets
#   2. Daemon start: read password from file, never from env var
#
# Password strategy: file-path only — NEVER env-var.
#   The daemon reads FENCE_PASSWORD_FILE directly. Previous versions did
#   `export FENCE_PASSWORD=$(cat "$file")`, which baked the password into
#   /proc/1/environ permanently — readable via docker exec.
#
# Supported secret sources (all resolve to file paths):
#   Docker Compose  →  secrets: → /run/secrets/  (tmpfs)
#   Kubernetes      →  Secret volume mount
#   Vault Agent     →  sidecar writes to shared tmpfs
# ---------------------------------------------------------------------------

# ── Validate password file ────────────────────────────────────────────────

PWFILE="${FENCE_PASSWORD_FILE:-}"

if [ -z "$PWFILE" ] || [ ! -f "$PWFILE" ]; then
  echo "Error: FENCE_PASSWORD_FILE must point to a readable password file." >&2
  echo "  Docker:  mount a Docker secret (see docker-compose.yml)" >&2
  echo "  K8s:     mount a Secret volume" >&2
  exit 1
fi

if [ ! -s "$PWFILE" ]; then
  echo "Error: Password file is empty: $PWFILE" >&2
  exit 1
fi

# ── First-run: auto-setup if no keystore exists ──────────────────────────

KEYSTORE="${ONLYFENCE_HOME:-/data}/keystore"

if [ ! -f "$KEYSTORE" ]; then
  # Check explicit env var first, then well-known Docker secret path
  MNFILE="${FENCE_MNEMONIC_FILE:-/run/secrets/fence_mnemonic}"

  if [ -s "$MNFILE" ]; then
    echo "First run: importing wallet from mnemonic..." >&2
    node dist/cli/index.js setup \
      --mnemonic-file "$MNFILE" \
      --password-file "$PWFILE"
    echo "Wallet setup complete." >&2
  else
    echo "Error: No keystore found and FENCE_MNEMONIC_FILE not provided." >&2
    echo "" >&2
    echo "  First run requires a mnemonic to create the wallet keystore." >&2
    echo "  Mount a mnemonic file and set FENCE_MNEMONIC_FILE, or run:" >&2
    echo "    docker compose run --rm onlyfence setup --generate --password-file \$FENCE_PASSWORD_FILE" >&2
    exit 1
  fi
fi

# ── Scrub sensitive env vars ─────────────────────────────────────────────

unset FENCE_PASSWORD 2>/dev/null || true

# ── Start daemon ─────────────────────────────────────────────────────────
# The daemon reads the password file via FENCE_PASSWORD_FILE env var
# in resolvePassword() → securePasswordFromFile().

# Bind to 0.0.0.0 inside the container so Docker port mapping can forward
# traffic. This is safe — the compose file / k8s service controls actual
# network exposure. The --allow-remote flag only bypasses the loopback
# assertion in tcp-guard.ts; it does not change who can reach the port.
exec node dist/cli/index.js start \
  --tcp-host "${FENCE_TCP_HOST:-0.0.0.0}" \
  --tcp-port "${FENCE_TCP_PORT:-19876}" \
  --allow-remote \
  --password-file "$PWFILE" \
  --yes \
  "$@"
