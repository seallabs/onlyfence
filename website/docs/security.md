---
sidebar_position: 10
title: Security
---

# Security

OnlyFence handles sensitive cryptographic material. Security is a core design principle, not an afterthought.

## Security Architecture

| Principle | Implementation |
|-----------|---------------|
| **Encryption at rest** | Keys encrypted with user password. Plaintext never touches disk. |
| **No network transmission** | Private keys and mnemonics are never sent over the network. |
| **Session management** | Unlock sessions are time-bounded and held in memory only. |
| **Log filtering** | Dedicated filter prevents secrets from being written to log files. |
| **Local-only storage** | All data stored in `~/.onlyfence/` with restricted file permissions. |
| **Fail-closed oracle** | If price data is unavailable, trades are rejected — not silently allowed. |
| **Dry-run simulation** | Every transaction is simulated before signing. |
| **Full audit trail** | Every trade attempt (approved or rejected) is logged. |

## Container Security

When deployed via Docker, additional hardening is applied:

| Feature | Description |
|---------|-------------|
| **Non-root user** | Runs as `onlyfence` user, never root |
| **Read-only filesystem** | Container root is immutable |
| **No capabilities** | All Linux capabilities dropped |
| **No privilege escalation** | `no-new-privileges` enforced |
| **Password via file** | Secrets on tmpfs — never as env vars |
| **Loopback-only TCP** | Daemon binds to `127.0.0.1` |
| **Process hardening** | `PR_SET_DUMPABLE=0` on Linux, `PT_DENY_ATTACH` on macOS |

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Prompt injection (agent drains wallet) | Token allowlist + spending limits |
| Compromised machine (keystore extracted) | Encrypted keystore with password |
| Oracle manipulation (fake price) | Fail-closed oracle with retry and cache TTL |
| Smart contract exploit | Dry-run simulation before signing |
| Unknown token swap | Token allowlist enforcement |

## Reporting Vulnerabilities

**Do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately via:

1. **GitHub Security Advisories** (preferred): [Report a vulnerability](https://github.com/seallabs/onlyfence/security/advisories/new)
2. **Email**: hello@seallabs.xyz

### Response Timeline

| Action | Timeframe |
|--------|-----------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 5 days |
| Patch for critical issues | Within 14 days |
| Public disclosure | After fix is released |

See [SECURITY.md](https://github.com/seallabs/onlyfence/blob/main/SECURITY.md) for the full policy.

## Best Practices

- Use a strong, unique password for your keystore
- Keep OnlyFence up to date (`fence update`)
- Set appropriate spending limits
- Do not share your `~/.onlyfence/` directory
- Lock your session when not in use: `fence lock`
- Review the activity log regularly: `fence query activity`
