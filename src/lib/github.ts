/**
 * GitHub API helpers for fetching repository contents
 */

import { log } from './logging';

export interface GitHubFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  content?: string;
  sha: string;
}

export interface FetchRepoOptions {
  repo: string;
  path?: string;
  ref?: string;
  token?: string;
}

const GITHUB_API = 'https://api.github.com';

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

/**
 * Fetch all files in a directory recursively using the Git Trees API.
 * This uses a single API call to get the tree, then parallel fetches for content.
 */
export async function fetchDirectoryRecursive(
  options: FetchRepoOptions
): Promise<GitHubFile[]> {
  const { repo, ref = 'main', token, path = '' } = options;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'AgentPlane/1.0',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Single API call to get entire tree
  const treeUrl = `${GITHUB_API}/repos/${repo}/git/trees/${ref}?recursive=1`;
  const response = await fetch(treeUrl, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubError(`Repository not found: ${repo}`, 404);
    }
    if (response.status === 403) {
      throw new GitHubError('Rate limited or access denied', 403);
    }
    throw new GitHubError(`GitHub API error: ${response.status}`, response.status);
  }

  const tree = (await response.json()) as GitHubTreeResponse;

  if (tree.truncated) {
    log.warn('GitHub tree response truncated', { repo, ref });
  }

  // Filter to requested path (blobs only)
  const blobs = tree.tree.filter((item) => {
    if (item.type !== 'blob') return false;
    if (path === '') return true;
    return item.path.startsWith(path + '/') || item.path === path;
  });

  // Parallel content fetches with concurrency limit
  const CONCURRENCY = 10;
  const files: GitHubFile[] = [];

  for (let i = 0; i < blobs.length; i += CONCURRENCY) {
    const batch = blobs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (blob) => {
        try {
          const content = await fetchBlobContent(repo, blob.sha, token);
          return {
            name: blob.path.split('/').pop() || '',
            path: blob.path,
            type: 'file' as const,
            sha: blob.sha,
            content,
          };
        } catch (error) {
          log.warn('Failed to fetch blob content', {
            repo,
            path: blob.path,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      })
    );

    for (const result of batchResults) {
      if (result !== null) {
        files.push(result);
      }
    }
  }

  return files;
}

async function fetchBlobContent(
  repo: string,
  sha: string,
  token?: string
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3.raw',
    'User-Agent': 'AgentPlane/1.0',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `${GITHUB_API}/repos/${repo}/git/blobs/${sha}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new GitHubError(`Failed to fetch blob: ${response.status}`, response.status);
  }

  return response.text();
}

export async function fetchRepoContents(
  options: FetchRepoOptions
): Promise<GitHubFile[]> {
  const { repo, path = '', ref = 'main', token } = options;

  const url = `${GITHUB_API}/repos/${repo}/contents/${path}${ref ? `?ref=${ref}` : ''}`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'AgentPlane/1.0',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubError(`Repository or path not found: ${repo}/${path}`, 404);
    }
    if (response.status === 403) {
      throw new GitHubError('Rate limited or access denied', 403);
    }
    throw new GitHubError(`GitHub API error: ${response.status}`, response.status);
  }

  const data = (await response.json()) as GitHubApiFile | GitHubApiFile[];

  // Single file returns object, directory returns array
  if (!Array.isArray(data)) {
    return [parseGitHubFile(data)];
  }

  return data.map(parseGitHubFile);
}

interface GitHubApiFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
  content?: string;
  encoding?: string;
}

export async function fetchFileContent(
  options: FetchRepoOptions & { path: string }
): Promise<string> {
  const { repo, path, ref = 'main', token } = options;

  const url = `${GITHUB_API}/repos/${repo}/contents/${path}${ref ? `?ref=${ref}` : ''}`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'AgentPlane/1.0',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubError(`File not found: ${repo}/${path}`, 404);
    }
    throw new GitHubError(`GitHub API error: ${response.status}`, response.status);
  }

  const data = (await response.json()) as GitHubApiFile;

  if (data.type !== 'file') {
    throw new GitHubError(`Path is not a file: ${path}`, 400);
  }

  // Content is base64 encoded
  if (data.encoding === 'base64' && data.content) {
    return atob(data.content.replace(/\n/g, ''));
  }

  throw new GitHubError('Unexpected file encoding', 500);
}

function parseGitHubFile(data: GitHubApiFile): GitHubFile {
  return {
    name: data.name,
    path: data.path,
    type: data.type,
    sha: data.sha,
  };
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}
