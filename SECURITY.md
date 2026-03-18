# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

Only the latest release receives security patches. We recommend always running the most recent version.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities privately via one of the following:

1. **GitHub Security Advisories** (preferred): [Report a vulnerability](https://github.com/seallabs/onlyfence/security/advisories/new)
2. **Email**: hello@seallabs.xyz

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Potential impact (e.g., fund loss, key exposure, privilege escalation)
- Any suggested fix (optional but appreciated)

### Response Timeline

| Action                     | Timeframe        |
| -------------------------- | ---------------- |
| Acknowledgment of report   | Within 48 hours  |
| Initial assessment         | Within 5 days    |
| Patch for critical issues  | Within 14 days   |
| Public disclosure           | After fix is released, coordinated with reporter |

## Scope

The following are considered in-scope for security reports:

### Critical

- Private key or mnemonic exposure (memory, logs, disk, network)
- Keystore encryption bypass or weakening
- Transaction signing without user authorization
- Fund loss or unauthorized token transfers
- Spending limit bypass

### High

- Session token leakage or replay
- Password brute-force without rate limiting
- SQL injection in the local SQLite database
- Arbitrary code execution via crafted input
- Sensitive data in log files (mnemonics, private keys, passwords)

### Medium

- Insecure file permissions on keystore or database files
- Dependency vulnerabilities with a known exploit path
- Denial of service against the local CLI/TUI

### Out of Scope

- Vulnerabilities in upstream dependencies without a demonstrated exploit against OnlyFence
- Attacks requiring physical access to an already-unlocked machine
- Social engineering
- Issues in third-party DEX protocols or aggregator APIs that OnlyFence integrates with

## Security Architecture

OnlyFence handles sensitive cryptographic material locally. Key design principles:

- **Keystore encryption**: Mnemonics are encrypted at rest using a user-provided password. The plaintext never touches disk.
- **No network transmission of secrets**: Private keys and mnemonics are never sent over the network.
- **Session management**: Unlock sessions are time-bounded and held in memory only.
- **Sensitive log filtering**: A dedicated log filter prevents secrets from being written to log files.
- **Local-only storage**: All data (keystore, trade logs, configuration) is stored in `~/.onlyfence/` with restricted file permissions.

## Disclosure Policy

We follow coordinated disclosure:

1. Reporter submits vulnerability privately.
2. We acknowledge and assess the report.
3. We develop and test a fix.
4. We release the fix and notify the reporter.
5. After the fix is available, we publish a security advisory with credit to the reporter (unless anonymity is requested).

We will not take legal action against researchers who follow this policy and act in good faith.

## Security Best Practices for Users

- Use a strong, unique password when encrypting your keystore.
- Keep your OnlyFence installation up to date.
- Set appropriate spending limits via `fence` configuration.
- Do not share your `~/.onlyfence/` directory.
- Lock your session when not in use: `fence lock`.
