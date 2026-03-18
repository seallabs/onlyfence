# OnlyFence — Standalone Mode: Password & Signer Management

**Version 1.0 | March 2026**
**Audience: Engineering Team**
**Dependencies: Deployment Strategy v1.0, Signer Daemon Spec v2.1**

---

## 1. Problem

In standalone mode (Tier 0), there is no daemon holding keys in memory. Every `fence swap` invocation is a short-lived process that must:

1. Obtain the keystore password
2. Decrypt the keystore (scrypt + AES-256-GCM)
3. Extract the chain-specific private key
4. Build a chain-specific `Signer`
5. Sign the transaction
6. Zero key material from memory
7. Exit

The question: **how does the password enter each invocation?**

---

## 2. Decision: Session-Based Unlock (`fence unlock` / `fence lock`)

Standalone mode is for experimentation. UX is the highest priority, but we don't want the master password lingering in environment variables or process trees. The `fence unlock` / `fence lock` session model balances both concerns — inspired by `ssh-agent` and `sudo`.

### 2.1 User Experience

```bash
# Human unlocks once
$ fence unlock
Enter password: ********
✓ Session active (expires in 4h)

# All subsequent commands work without password
$ fence swap SUI USDC 100 --output json
{"status":"success","txDigest":"8Hk..."}

$ fence swap SUI USDT 50 --output json
{"status":"success","txDigest":"9Xk..."}

# End session explicitly (or wait for auto-expiry)
$ fence lock
✓ Session ended.
```

One unlock, then forget about it. Agent-compatible. No password in environment, no password in CLI args, no password on disk.

### 2.2 Why Session Unlock Over Alternatives

| Approach | UX | Security | Verdict |
|----------|-----|----------|---------|
| `fence unlock` / `fence lock` | Good — password once per session | Moderate — time-limited, no master password on disk | **Chosen** |
| `FENCE_PASSWORD` env var | Best — zero interaction | Bad — master password in environment, inherited by all child processes, visible in `/proc/pid/environ` | **Rejected.** Leaks the master password. Agent can capture it and decrypt keystore forever. |
| `--password` CLI flag | Easy | Worst — visible in `ps`, shell history | **Removed.** |
| `--password-file` | Good for automation | Moderate — permanent file on disk | **Reserved for daemon mode only.** |
| Interactive prompt every time | Terrible | Best for Tier 0 | **Not viable.** Blocks agent usage entirely. |

### 2.3 Why Not Env Var

The `FENCE_PASSWORD` env var approach was considered but rejected for standalone mode:

1. **Leaks the master password.** The env var contains the actual keystore password. Any same-user process (including the agent) can read `process.env.FENCE_PASSWORD` — trivially, in one line of code. With the master password, the agent can decrypt the keystore and extract the private key **at any time, even after the env var is unset** (because it already captured the value).

2. **Inherited by child processes.** Every child process spawned from the shell inherits a copy. Even after the shell exits, running child processes still have the password.

3. **Persists if added to shell profile.** Users who add `export FENCE_PASSWORD=...` to `.zshrc` have the password on disk in plaintext, forever.

4. **No revocation.** `unset FENCE_PASSWORD` only clears the current shell. Child processes still have their copies. There is no clean "end my session" action.

The session model avoids all of these: the master password is never stored. Only a derived session key + encrypted blob exist, and they auto-expire.

---

## 3. Session Mechanism

### 3.1 How It Works

**`fence unlock`:**

1. Prompt password via TTY (echo disabled)
2. Decrypt keystore with password → get raw private key bytes
3. Generate a random 32-byte **session key**
4. Re-encrypt the private key bytes with the session key (AES-256-GCM)
5. Write session file to `~/.onlyfence/session` with permissions `0600`:
   ```json
   {
     "version": 1,
     "session_key": "<hex-encoded-32-bytes>",
     "encrypted_blob": "<hex-encoded-ciphertext>",
     "iv": "<hex-encoded-12-bytes>",
     "tag": "<hex-encoded-16-bytes>",
     "chain": "sui",
     "expires_at": "2026-03-18T18:00:00Z"
   }
   ```
6. Zero password and raw private key from memory
7. Print confirmation with expiry time

**`fence swap` (during active session):**

1. Check for `~/.onlyfence/session` file
2. Read and validate: file exists? not expired?
3. Decrypt the blob using the session key → raw private key bytes
4. Build chain-specific `Signer` from key bytes
5. Sign transaction
6. Zero key bytes from memory

**`fence lock`:**

1. Read session file
2. Overwrite file contents with zeros (secure delete)
3. Delete file
4. Print confirmation

**Auto-expiry:**

- Default TTL: 4 hours (configurable via `fence unlock --ttl 8h`)
- `fence swap` checks `expires_at` before using the session
- Expired session → clear error with instructions

### 3.2 Session File Contents

The session file contains:

| Field | What it is | What it is NOT |
|-------|-----------|---------------|
| `session_key` | Random 32 bytes, generated at unlock time | NOT the keystore password |
| `encrypted_blob` | Private key re-encrypted with session key | NOT the raw private key |
| `expires_at` | ISO 8601 timestamp | — |

**The master password is never written to the session file.** The session key is a one-time random value that can only decrypt the specific blob in this session file.

### 3.3 Security Properties

| Property | Status |
|----------|--------|
| Master password on disk? | **Never.** Only in memory during `fence unlock`, zeroed after. |
| Raw private key on disk? | **Never.** Encrypted with session key in session file. |
| Session file readable by same-user? | Yes. Tier 0 accepted risk. |
| What does stealing session file give you? | Session key + encrypted blob → can derive raw private key. |
| Time-limited exposure? | **Yes.** Default 4h, auto-expires. |
| Clean revocation? | **Yes.** `fence lock` zeroes and deletes. Hard cut. |
| Can stolen session file decrypt keystore? | **No.** Session key ≠ password. Cannot unlock keystore in the future. |
| Reusable after expiry? | **No.** Session key is random, blob is tied to it. |

### 3.4 Comparison: What the Agent Gets

| Mechanism | What agent captures | Can it re-derive key after revocation? | Exposure window |
|-----------|--------------------|-----------------------------------------|-----------------|
| Env var (`FENCE_PASSWORD`) | The **master password** | **Yes** — can decrypt keystore forever | Shell lifetime (hours to days) |
| Password file | The **master password** | **Yes** — file persists on disk | **Permanent** until deleted |
| Session unlock | **Session key + encrypted blob** → raw key | **No** — session key is useless without blob, blob deleted on lock | **TTL only** (4h default) |

In all cases, if the agent exfiltrates the raw private key immediately, the damage is done regardless. The session model limits the **opportunity window** and ensures the master password is never exposed.

---

## 4. Removing `--password` CLI Flag

The current `-p, --password <password>` flag on `fence swap` passes the password as a CLI argument. Visible in `ps aux` and shell history. Remove entirely.

**Before:**
```bash
fence swap SUI USDC 100 --password mysecret    # visible in `ps`
```

**After:**
```bash
fence unlock                                    # password once, via TTY
fence swap SUI USDC 100                         # session handles auth
```

---

## 5. Removing `SUI_PRIVATE_KEY` and `SUI_MNEMONIC` Env Vars

The current `resolveSuiSigner()` in `src/wallet/signer.ts` supports three priority levels:

1. `SUI_PRIVATE_KEY` env var — raw bech32 private key
2. `SUI_MNEMONIC` env var — BIP-39 mnemonic
3. Encrypted keystore (password required)

**Remove priorities 1 and 2 entirely.** Reasons:

1. **Raw key material in env vars is categorically worse than a password.** `SUI_PRIVATE_KEY` puts the actual private key in the environment — any same-user process can extract it and immediately sign transactions without any policy engine involvement.

2. **Bypasses the keystore entirely.** These env vars skip encryption, skip the keystore file, skip the password. They exist as developer shortcuts but create a dangerous precedent.

3. **Sui-specific.** These env vars hardcode Sui SDK imports (`Ed25519Keypair`) in the generic wallet module. The signer module should be chain-agnostic.

4. **The session model replaces the use case.** Developers who used `SUI_PRIVATE_KEY` for convenience can use `fence unlock` instead — comparable UX (one extra command), but the key stays encrypted on disk and the master password is never persisted.

---

## 6. Chain-Agnostic Signer Architecture

### 6.1 Current Architecture (Problems)

```
src/wallet/signer.ts
  └── resolveSuiSigner(password?)
        ├── reads SUI_PRIVATE_KEY env var          ← Sui-specific, remove
        ├── reads SUI_MNEMONIC env var             ← Sui-specific, remove
        ├── calls loadKeystore(password)           ← chain-agnostic ✓
        ├── extracts keystoreData.keys['sui']      ← chain key lookup ✓
        └── creates Ed25519Keypair                 ← Sui SDK import ✗
```

`signer.ts` imports `Ed25519Keypair` from `@mysten/sui`. This is a Sui SDK dependency in the generic wallet module.

### 6.2 Target Architecture

```
src/wallet/
  ├── signer.ts           → loadChainKeyBytes(chain, password)
  │                         Chain-agnostic. No Sui imports.
  ├── session.ts           → unlock(), lock(), loadSession()
  │                         Session file management. AES-256-GCM re-encryption.
  └── keystore.ts          (unchanged)

src/chain/sui/
  ├── signer.ts           → buildSuiSigner(keyBytes): Signer
  │                         Sui-specific Ed25519Keypair construction.
  ├── adapter.ts           (unchanged)
  └── tokens.ts            (unchanged)

src/cli/commands/
  ├── unlock.ts            → fence unlock [--ttl <duration>]
  ├── lock.ts              → fence lock
  └── swap.ts              → uses loadSession() + buildSuiSigner()
```

### 6.3 New Interfaces

**`src/wallet/session.ts` (session management):**

```typescript
/** Session data stored in ~/.onlyfence/session */
interface SessionData {
  readonly version: number;
  readonly session_key: string;      // hex
  readonly encrypted_blob: string;   // hex
  readonly iv: string;               // hex
  readonly tag: string;              // hex
  readonly chain: string;
  readonly expires_at: string;       // ISO 8601
}

/**
 * Create a new session by decrypting the keystore and re-encrypting
 * the private key with a random session key.
 *
 * @param chain - Chain identifier (e.g., 'sui')
 * @param password - Keystore password (zeroed after use)
 * @param ttlSeconds - Session TTL in seconds (default: 14400 = 4h)
 */
export function createSession(chain: string, password: string, ttlSeconds?: number): void;

/**
 * Load the raw private key bytes from an active session.
 *
 * @param chain - Chain identifier
 * @returns Raw private key bytes
 * @throws Error if session missing, expired, or corrupted
 */
export function loadSessionKeyBytes(chain: string): Uint8Array;

/**
 * Destroy the active session. Overwrites file with zeros, then deletes.
 */
export function destroySession(): void;

/**
 * Check if a valid (non-expired) session exists.
 */
export function hasActiveSession(): boolean;
```

**`src/wallet/signer.ts` (chain-agnostic, simplified):**

```typescript
/**
 * Load the raw private key bytes for a specific chain from the encrypted keystore.
 *
 * @param chain - Chain identifier (e.g., 'sui')
 * @param password - Keystore password
 * @returns Raw private key bytes (Uint8Array)
 * @throws Error if keystore not found, wrong password, or chain key missing
 */
export function loadChainKeyBytes(chain: string, password: string): Uint8Array;
```

**`src/chain/sui/signer.ts` (Sui-specific):**

```typescript
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Signer } from '../../types/result.js';

/**
 * Build a Sui Signer from raw ed25519 private key bytes.
 *
 * Handles both 32-byte (seed) and 64-byte (tweetnacl format) keys.
 *
 * @param keyBytes - Raw private key bytes from keystore
 * @returns Signer with Sui address, public key, and sign method
 */
export function buildSuiSigner(keyBytes: Uint8Array): Signer;
```

### 6.4 Signer Resolution Flow

```
fence unlock
│
├─ Prompt password via TTY (echo disabled)
├─ loadChainKeyBytes('sui', password)  → raw private key
├─ createSession('sui', password)
│   ├─ Generate random 32-byte session key
│   ├─ AES-256-GCM encrypt raw key with session key
│   ├─ Write ~/.onlyfence/session (0600)
│   └─ Zero password + raw key from memory
└─ Print "✓ Session active (expires in 4h)"


fence swap SUI USDC 100
│
├─ loadSessionKeyBytes('sui')
│   ├─ Read ~/.onlyfence/session
│   ├─ Check expires_at > now
│   ├─ Decrypt blob with session key → raw private key
│   └─ return key bytes
│
├─ buildSuiSigner(keyBytes)           ← chain/sui/signer.ts
│   ├─ Ed25519Keypair.fromSecretKey(seed)
│   └─ return { address, publicKey, sign }
│
├─ executePipeline({ signer, ... })
└─ Zero key bytes from memory


fence lock
│
├─ destroySession()
│   ├─ Overwrite session file with zeros
│   └─ Delete file
└─ Print "✓ Session ended."
```

### 6.5 Updated `swap.ts` Usage

```typescript
// Before:
import { resolveSuiSigner } from '../../wallet/signer.js';
const signer = resolveSuiSigner(options.password);

// After:
import { loadSessionKeyBytes } from '../../wallet/session.js';
import { buildSuiSigner } from '../../chain/sui/signer.js';

const keyBytes = loadSessionKeyBytes(chain);
const signer = buildSuiSigner(keyBytes);
```

When new chains are added, they implement their own `buildEthSigner(keyBytes)` in `src/chain/ethereum/signer.ts`. The wallet and session modules never change.

---

## 7. User-Facing Changes

### 7.1 Setup Flow

During `fence setup` or `fence quickstart`, after the keystore is encrypted:

```
  ✓ Keystore encrypted

  Before trading, unlock your wallet:
    fence unlock

  This starts a 4-hour session. No password needed per-trade.
  Run `fence lock` to end the session early.
```

### 7.2 Swap Without Active Session

```
$ fence swap SUI USDC 100
Error: No active session.

  Unlock your wallet first:
    fence unlock

  Or start the daemon (no unlock needed):
    fence start
```

### 7.3 Swap With Expired Session

```
$ fence swap SUI USDC 100
Error: Session expired.

  Unlock again:
    fence unlock

  Or start the daemon for unattended operation:
    fence start
```

### 7.4 Agent Workflow

```bash
# Human unlocks before starting the agent
fence unlock --ttl 8h

# Agent runs for up to 8 hours
fence swap SUI USDC 100 --output json   # works
fence swap SUI USDT 50 --output json    # works

# Session expires → agent gets structured error
# {"status":"error","code":"SESSION_EXPIRED","hint":"Run fence unlock"}

# Human can re-unlock or promote to daemon mode
fence unlock        # another 8h session
# or
fence start         # daemon mode, no session needed
```

This creates **natural upgrade pressure to Tier 1** — if you need unattended 24/7 agent operation, the session model is inconvenient (expires, needs human to re-unlock). Daemon mode solves that.

---

## 8. New CLI Commands

### 8.1 `fence unlock`

```
fence unlock [--ttl <duration>]

Options:
  --ttl <duration>    Session duration (default: 4h)
                      Accepts: 1h, 4h, 8h, 12h, 24h

Prompts for keystore password (echo disabled).
Creates a session file at ~/.onlyfence/session.
```

### 8.2 `fence lock`

```
fence lock

Destroys the active session immediately.
Overwrites session file with zeros, then deletes it.
```

### 8.3 `fence status` Integration

```
$ fence status
OnlyFence v0.1.0

  Mode:        Standalone (Tier 0)
  Session:     active (expires in 3h 42m)
  Wallet:      0xabc123...def
  ...
```

```
$ fence status
OnlyFence v0.1.0

  Mode:        Standalone (Tier 0)
  Session:     expired
  ...

  Unlock: fence unlock
```

---

## 9. Files Changed

### New Files

| File | Purpose |
|------|---------|
| `src/wallet/session.ts` | Session file management: create, load, destroy, validate |
| `src/chain/sui/signer.ts` | `buildSuiSigner(keyBytes)` — Sui-specific Ed25519 signer construction |
| `src/cli/commands/unlock.ts` | `fence unlock` command |
| `src/cli/commands/lock.ts` | `fence lock` command |

### Modified Files

| File | Change |
|------|--------|
| `src/wallet/signer.ts` | Replace `resolveSuiSigner()` with `loadChainKeyBytes()`. Remove all `@mysten/sui` imports. Remove `SUI_PRIVATE_KEY`/`SUI_MNEMONIC` env var support. |
| `src/wallet/index.ts` | Update exports: `loadChainKeyBytes` instead of `resolveSuiSigner`. Add session exports. |
| `src/cli/commands/swap.ts` | Use `loadSessionKeyBytes()` + `buildSuiSigner()`. Remove `--password` flag entirely. |
| `src/chain/sui/index.ts` | Export `buildSuiSigner` |
| `src/__tests__/signer.test.ts` | Rewrite for new API. Add session tests. |

### Deleted

| What | Where | Reason |
|------|-------|--------|
| `resolveSuiSigner()` | `src/wallet/signer.ts` | Replaced by chain-agnostic `loadChainKeyBytes()` + chain-specific `buildSuiSigner()` |
| `SUI_PRIVATE_KEY` env var | `src/wallet/signer.ts` | Raw key in env is unacceptable |
| `SUI_MNEMONIC` env var | `src/wallet/signer.ts` | Raw mnemonic in env is unacceptable |
| `-p, --password` CLI flag | `src/cli/commands/swap.ts` | Visible in `ps` output. Session replaces it. |

---

## 10. Extensibility

Adding a new chain signer requires exactly one file:

```typescript
// src/chain/ethereum/signer.ts
import { Wallet } from 'ethers';
import type { Signer } from '../../types/result.js';

export function buildEthSigner(keyBytes: Uint8Array): Signer {
  const wallet = new Wallet(keyBytes);
  return {
    address: wallet.address,
    publicKey: /* ... */,
    sign: (data) => wallet.signMessage(data),
  };
}
```

The wallet module (`loadChainKeyBytes`), session module (`loadSessionKeyBytes`), and keystore module never change. The keystore already stores keys by chain ID. SOLID and DRY.

---

## 11. Security Summary

| What | Standalone (Session) | Daemon (Tier 1) | Docker (Tier 2) |
|------|---------------------|-----------------|-----------------|
| Password mechanism | `fence unlock` (TTY prompt, once) | `--password-file` or TTY at daemon start | Docker secret |
| Key in memory | During `fence swap` only (milliseconds) | Daemon process lifetime | Container process lifetime |
| Key on disk | Never (encrypted in session blob + keystore) | Never (daemon memory only) | Never (container memory only) |
| Password on disk | Never | Password file (0600, deployer-managed) | Docker secret (tmpfs) |
| Session concept | Yes (4h TTL, `fence lock` to revoke) | No (daemon is the session) | No (container is the session) |
| Agent can steal key? | During active session, via session file | Via daemon memory (blocked by `PR_SET_DUMPABLE`) | Blocked by container namespace |
