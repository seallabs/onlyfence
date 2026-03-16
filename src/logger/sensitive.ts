/**
 * Centralized list of sensitive field names for log redaction.
 * Shared by pino redaction (Phase 1) and Sentry scrubbing (Phase 3).
 */
export const REDACT_PATHS: readonly string[] = [
  'mnemonic',
  'privateKey',
  'privateKeyHex',
  'password',
  'confirmPassword',
  'secret',
  'ciphertext',
  'keys.*.privateKey',
  'keys.*.mnemonic',
];

/**
 * Pre-computed set of sensitive key names for object-key matching.
 * Includes both top-level keys and leaf segments of wildcard paths
 * (e.g. `keys.*.privateKey` contributes both `keys` and `privateKey`).
 */
export const SENSITIVE_KEY_SET: ReadonlySet<string> = new Set(
  REDACT_PATHS.flatMap((p) => {
    const parts = p.split('.');
    const first = parts[0] ?? p;
    const last = parts[parts.length - 1] ?? p;
    return first === last ? [first] : [first, last];
  }),
);

/**
 * Regex pattern sources matching sensitive data in arbitrary strings.
 * Stored as source strings to avoid shared mutable `lastIndex` state.
 */
export const SENSITIVE_PATTERN_SOURCES: readonly string[] = [
  // Hex-encoded private keys (64 hex chars)
  '\\b[a-fA-F0-9]{64}\\b',
  // BIP-39 mnemonic phrases (12–24 words)
  '\\b(\\w+\\s){11,23}\\w+\\b',
];
