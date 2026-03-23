/**
 * Architecture invariant tests.
 *
 * These tests scan the codebase for security anti-patterns. They catch
 * violations at test time rather than relying on code review:
 *
 * - Passwords must never appear in fork/spawn/exec arguments
 * - Sensitive files must use enforceFilePermissions, not raw chmod
 * - mkdirSync for data dirs must use SECURE_DIR_MODE
 * - Pipeline must always include policy checks (not bypassable)
 * - Process hardening must only run in daemon, not CLI hot path
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'node:fs';

const SRC_DIR = join(import.meta.dirname, '..', '..');

const EXCLUDE_PATTERNS = ['__tests__', 'node_modules', 'dist'];

function isExcluded(path: string): boolean {
  return EXCLUDE_PATTERNS.some((p) => path.includes(p));
}

/** Read all TypeScript source files (excluding tests and node_modules). */
function readSourceFiles(): Array<{ path: string; content: string }> {
  const entries = globSync(join(SRC_DIR, '**', '*.ts'));
  return entries
    .filter((p) => !isExcluded(p))
    .map((p) => ({ path: p, content: readFileSync(p, 'utf-8') }));
}

/** Read TS source files matching a glob relative to src/. */
function readFilesMatching(pattern: string): Array<{ path: string; content: string }> {
  const entries = globSync(join(SRC_DIR, pattern));
  return entries
    .filter((p) => !isExcluded(p))
    .map((p) => ({ path: p, content: readFileSync(p, 'utf-8') }));
}

describe('Security invariants', () => {
  describe('password never in process arguments', () => {
    it('fork/spawn/exec calls must not include password in args array', () => {
      // Scan non-test source files for process spawning with --password in the args array.
      // This catches the exact pattern: fork(file, ['start', '--password', pwd, ...])
      const files = readSourceFiles();
      const violations: string[] = [];

      for (const { path, content } of files) {
        // Match: fork(anything, [... '--password' ...]) — the actual dangerous pattern
        // The regex looks for fork/spawn/exec followed by an array literal containing '--password'
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (/(?:fork|spawn|execFile)\s*\(/.test(line) && /'--password'|"--password"/.test(line)) {
            violations.push(`${path}:${String(i + 1)}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('sensitive file permissions', () => {
    it('mkdirSync for data directory must use SECURE_DIR_MODE', () => {
      // Files that create the data directory should import and use the constant
      const files = readFilesMatching('{cli,config,db,wallet,update,daemon}/**/*.ts');
      const violations: string[] = [];

      for (const { path, content } of files) {
        // Find mkdirSync calls with hardcoded 0o700 instead of SECURE_DIR_MODE
        if (/mkdirSync\([^)]*mode:\s*0o700/.test(content)) {
          violations.push(`${path}: uses hardcoded 0o700 instead of SECURE_DIR_MODE`);
        }
      }

      expect(violations).toEqual([]);
    });

    it('writeFileSync for sensitive files should be followed by enforceFilePermissions', () => {
      // Check that keystore and config writes call enforceFilePermissions
      const keystoreFile = readFilesMatching('wallet/keystore.ts');
      for (const { content } of keystoreFile) {
        expect(content).toContain('enforceFilePermissions');
      }

      const configFile = readFilesMatching('config/loader.ts');
      for (const { content } of configFile) {
        expect(content).toContain('enforceFilePermissions');
      }
    });
  });

  describe('pipeline policy enforcement', () => {
    it('executePipeline must always evaluate policy checks', () => {
      const files = readFilesMatching('core/transaction-pipeline.ts');
      for (const { content } of files) {
        // The pipeline must call policyRegistry.evaluateAll
        expect(content).toContain('policyRegistry.evaluateAll');
        // There must be no early return before policy check (no bypass)
        const policyLine = content.indexOf('evaluateAll');
        const firstReturn = content.indexOf('return {');
        // First return should be AFTER the policy check
        expect(policyLine).toBeLessThan(firstReturn);
      }
    });
  });

  describe('error reporting', () => {
    it('pipeline catch block must call captureException', () => {
      const files = readFilesMatching('core/transaction-pipeline.ts');
      for (const { content } of files) {
        expect(content).toContain('captureException');
      }
    });
  });

  describe('process hardening', () => {
    it('trySetNondumpable/tryDenyAttach must not be called from CLI preAction hook', () => {
      const files = readFilesMatching('cli/index.ts');
      for (const { content } of files) {
        // These should only run in daemon startup, not every CLI command
        expect(content).not.toContain('trySetNondumpable');
        expect(content).not.toContain('tryDenyAttach');
      }
    });
  });

  describe('branded password types', () => {
    it('DaemonOptions.password must use SecurePassword type', () => {
      const files = readFilesMatching('daemon/index.ts');
      for (const { content } of files) {
        expect(content).toContain('SecurePassword');
      }
    });
  });
});
