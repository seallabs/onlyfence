import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ONLYFENCE_DIR } from '../config/loader.js';
import { SENSITIVE_FILES } from './file-permissions.js';

/**
 * A security warning detected during startup.
 */
export interface StartupWarning {
  readonly level: 'warn' | 'error';
  readonly code: string;
  readonly message: string;
  readonly fix: string;
}

/**
 * Run security checks at CLI startup and return any warnings.
 *
 * Checks are non-blocking — they produce warnings for the user but
 * never prevent the CLI from running (axiom: "warn, don't block").
 *
 * @param dataDir - The OnlyFence data directory (defaults to ONLYFENCE_DIR)
 * @returns Array of warnings (empty if everything looks good)
 */
export function runStartupChecks(dataDir: string = ONLYFENCE_DIR): StartupWarning[] {
  const warnings: StartupWarning[] = [];

  // Check 1: Running as root
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    warnings.push({
      level: 'warn',
      code: 'RUNNING_AS_ROOT',
      message: 'OnlyFence is running as root. This is unnecessary and increases attack surface.',
      fix: 'Run as a regular user instead.',
    });
  }

  // Check 2: Data directory permissions (should not be group/world accessible)
  if (existsSync(dataDir)) {
    const dirMode = statSync(dataDir).mode & 0o777;
    if ((dirMode & 0o077) !== 0) {
      warnings.push({
        level: 'warn',
        code: 'DATA_DIR_PERMISSIONS',
        message: `Data directory "${dataDir}" is accessible by group/others (mode: ${dirMode.toString(8)}).`,
        fix: `Run: chmod 700 "${dataDir}"`,
      });
    }
  }

  // Check 3: Sensitive files should be 0o600
  for (const filename of SENSITIVE_FILES) {
    const filePath = join(dataDir, filename);
    if (existsSync(filePath)) {
      const fileMode = statSync(filePath).mode & 0o777;
      if (fileMode !== 0o600) {
        warnings.push({
          level: 'warn',
          code: 'FILE_PERMISSIONS',
          message: `"${filename}" has mode ${fileMode.toString(8)} (expected 600).`,
          fix: `Run: chmod 600 "${filePath}"`,
        });
      }
    }
  }

  // Check 4: Install directory writable by current user
  // (if the binary is in a user-writable location, an attacker could replace it)
  const execDir = process.execPath.length > 0 ? join(process.execPath, '..') : null;
  if (execDir !== null && existsSync(execDir)) {
    try {
      const dirStat = statSync(execDir);
      const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
      // Warn if the install dir is owned by the current user (not root)
      // AND the binary is not in a system path
      if (
        uid !== 0 &&
        dirStat.uid === uid &&
        !execDir.startsWith('/usr/') &&
        !execDir.startsWith('/opt/')
      ) {
        warnings.push({
          level: 'warn',
          code: 'WRITABLE_INSTALL_DIR',
          message: 'Installation directory is writable by the current user.',
          fix: 'For production, install to a root-owned path (e.g., /usr/local/bin).',
        });
      }
    } catch {
      // stat failed — skip this check
    }
  }

  return warnings;
}
