import { UpdateSourceError, GITHUB_REPO } from './source.js';
import type { UpdateSource } from './source.js';
import { toErrorMessage } from '../utils/index.js';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Fetches the latest version from GitHub Releases API.
 *
 * Uses Node's built-in fetch (available since Node 18, project requires >= 25).
 * The User-Agent header is required by the GitHub API.
 */
export class GitHubReleasesSource implements UpdateSource {
  async fetchLatestVersion(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(GITHUB_API_URL, {
        headers: {
          'User-Agent': 'onlyfence-updater',
          Accept: 'application/vnd.github.v3+json',
        },
      });
    } catch (err: unknown) {
      throw new UpdateSourceError(`Failed to reach GitHub API: ${toErrorMessage(err)}`);
    }

    if (!response.ok) {
      throw new UpdateSourceError(
        `GitHub API returned ${response.status}: ${response.statusText}`,
        response.status,
      );
    }

    const data: unknown = await response.json();

    if (typeof data !== 'object' || data === null || !('tag_name' in data)) {
      throw new UpdateSourceError('Unexpected GitHub API response: missing tag_name');
    }

    const tagName = (data as { tag_name: unknown }).tag_name;
    if (typeof tagName !== 'string') {
      throw new UpdateSourceError('Unexpected GitHub API response: tag_name is not a string');
    }

    if (!VERSION_PATTERN.test(tagName)) {
      throw new UpdateSourceError(`Invalid version format in tag_name: "${tagName}"`);
    }

    return tagName;
  }
}
