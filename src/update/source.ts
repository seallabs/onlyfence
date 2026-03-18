/**
 * Error thrown when an update source cannot be reached or returns unexpected data.
 */
export class UpdateSourceError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'UpdateSourceError';
    this.statusCode = statusCode;
  }
}

/**
 * GitHub repository slug, shared by GitHubReleasesSource and ShellUpdateInstaller.
 */
export const GITHUB_REPO = 'seallabs/onlyfence';

/**
 * Interface for fetching the latest available version from a remote source.
 *
 * MVP uses GitHub Releases. Post-MVP may add npm registry or other sources.
 */
export interface UpdateSource {
  /**
   * Fetch the latest available version string.
   *
   * @returns Version string without "v" prefix (e.g. "0.2.0")
   * @throws UpdateSourceError if the source is unreachable or returns invalid data
   */
  fetchLatestVersion(): Promise<string>;
}
