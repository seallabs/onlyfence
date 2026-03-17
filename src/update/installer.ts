import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ONLYFENCE_DIR } from '../config/loader.js';
import { GITHUB_REPO } from './source.js';
import { toErrorMessage } from '../utils/index.js';
const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh`;

/**
 * Error thrown when an update installation fails.
 */
export class InstallError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'InstallError';
    this.exitCode = exitCode;
  }
}

/**
 * Interface for installing a specific version of OnlyFence.
 */
export interface UpdateInstaller {
  /**
   * Download and install the given version.
   *
   * Re-runs install.sh logic: GitHub tarball first, npm fallback.
   * Progress is written to stdout/stderr.
   *
   * @param version - Version to install (e.g. "0.2.0")
   * @throws InstallError on failure
   */
  install(version: string): Promise<void>;
}

/**
 * Installs updates by downloading and executing install.sh from GitHub.
 *
 * This reuses 100% of the existing installation logic:
 * - Platform detection (OS + architecture)
 * - GitHub release tarball download (preferred) with npm fallback
 * - PATH setup and wrapper script creation
 *
 * The ONLYFENCE_VERSION env var tells install.sh which version to install.
 */
export class ShellUpdateInstaller implements UpdateInstaller {
  async install(version: string): Promise<void> {
    const scriptPath = await this.downloadInstallScript();

    try {
      mkdirSync(ONLYFENCE_DIR, { recursive: true });

      const result = spawnSync('sh', [scriptPath], {
        env: {
          ...process.env,
          ONLYFENCE_VERSION: version,
          ONLYFENCE_INSTALL_DIR: ONLYFENCE_DIR,
        },
        stdio: 'inherit',
        timeout: 120_000,
      });

      if (result.error !== undefined) {
        throw new InstallError(
          `Failed to execute install script: ${result.error.message}`,
          result.status ?? 1,
        );
      }

      if (result.status !== 0) {
        throw new InstallError(
          `Install script exited with code ${result.status}`,
          result.status ?? 1,
        );
      }
    } finally {
      try {
        unlinkSync(scriptPath);
      } catch {
        // Best-effort cleanup of temp file
      }
    }
  }

  /**
   * Download install.sh to a temporary file.
   */
  private async downloadInstallScript(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(INSTALL_SCRIPT_URL);
    } catch (err: unknown) {
      throw new InstallError(`Failed to download install script: ${toErrorMessage(err)}`, 1);
    }

    if (!response.ok) {
      throw new InstallError(`Failed to download install script: HTTP ${response.status}`, 1);
    }

    const script = await response.text();
    const scriptPath = join(tmpdir(), `onlyfence-install-${Date.now()}.sh`);
    writeFileSync(scriptPath, script, { encoding: 'utf-8', mode: 0o755 });

    return scriptPath;
  }
}
