# N+1 GitHub API Pattern in Directory Fetching

**Priority:** P1-CRITICAL
**Category:** performance
**File:** src/lib/github.ts
**Lines:** 110-141
**Blocks:** merge

## Description

The `fetchDirectoryRecursive` function makes sequential API calls for each subdirectory, creating an N+1 pattern. A plugin repo with 10 directories results in 11 API calls (1 root + 10 subdirs), each adding latency.

## Current Code

```typescript
async function fetchDirectoryRecursive(opts: FetchOpts): Promise<GitHubFile[]> {
  const files: GitHubFile[] = [];
  const contents = await fetchDirectory(opts);  // API call

  for (const item of contents) {
    if (item.type === 'dir') {
      const subFiles = await fetchDirectoryRecursive({...opts, path: item.path});  // Sequential!
      files.push(...subFiles);
    }
  }
  return files;
}
```

## Impact

- Each plugin load takes O(n) API calls where n = directory count
- GitHub API rate limits (5000/hour authenticated) can be exhausted quickly
- Cold start latency increases linearly with repo complexity

## Fix

Use GitHub Trees API to fetch entire directory structure in a single call:

```typescript
interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

export async function fetchDirectoryRecursive(opts: FetchOpts): Promise<GitHubFile[]> {
  const { repo, ref = 'main', token, path = '' } = opts;

  // Single API call to get entire tree
  const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`;
  const response = await fetch(treeUrl, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const tree: GitHubTreeResponse = await response.json();

  // Filter to requested path and fetch blob contents in parallel
  const blobs = tree.tree.filter(item =>
    item.type === 'blob' &&
    (path === '' || item.path.startsWith(path + '/') || item.path === path)
  );

  // Parallel content fetches
  const files = await Promise.all(
    blobs.map(async (blob) => {
      const content = await fetchBlobContent(repo, blob.sha, token);
      return {
        name: blob.path.split('/').pop() || '',
        path: blob.path,
        content,
      };
    })
  );

  return files;
}
```

## References

- GitHub Trees API: https://docs.github.com/en/rest/git/trees
