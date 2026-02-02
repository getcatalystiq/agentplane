/**
 * Plugin extraction from GitHub repositories with R2 caching
 */

import { parse as parseYaml } from 'yaml';
import { fetchDirectoryRecursive, type GitHubFile } from './github';
import { log } from './logging';
import type {
  Env,
  PluginSource,
  ExtractedPlugin,
  PluginBundle,
  PluginManifest,
  MCPServerConfig,
} from './types';

const CACHE_TTL_SECONDS = 300; // 5 minutes

// Single-flight pattern to prevent cache stampede
const inFlightRequests = new Map<string, Promise<ExtractedPlugin>>();

export async function loadPluginsForTenant(
  sources: PluginSource[],
  env: Env
): Promise<PluginBundle> {
  // Parallel plugin loading with graceful error handling
  const results = await Promise.allSettled(
    sources.map((source) => extractPlugin(source, env))
  );

  const bundle: PluginBundle = {
    skills: [],
    commands: [],
    mcpServers: {},
  };

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      const plugin = result.value;
      bundle.skills.push(...plugin.skills);
      bundle.commands.push(...plugin.commands);
      Object.assign(bundle.mcpServers, plugin.mcpServers);
    } else {
      log.warn('Failed to load plugin', {
        source: sources[i].repo,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  return bundle;
}

async function extractPlugin(
  source: PluginSource,
  env: Env
): Promise<ExtractedPlugin> {
  const cacheKey = getCacheKey(source);

  // Check for in-flight request (single-flight pattern)
  const existing = inFlightRequests.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = extractPluginImpl(source, cacheKey, env).finally(() => {
    inFlightRequests.delete(cacheKey);
  });

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

async function extractPluginImpl(
  source: PluginSource,
  cacheKey: string,
  env: Env
): Promise<ExtractedPlugin> {
  // Check R2 cache first
  const cached = await getCachedPlugin(cacheKey, env);
  if (cached) {
    return cached;
  }

  // Fetch from GitHub
  const files = await fetchDirectoryRecursive({
    repo: source.repo,
    path: source.path,
    ref: source.ref,
    token: source.github_token,
  });

  const plugin = parsePluginFiles(files, source);

  // Cache in R2
  await cachePlugin(cacheKey, plugin, env);

  return plugin;
}

function getCacheKey(source: PluginSource): string {
  const parts = [source.repo, source.path || '', source.ref || 'main'];
  return `plugins/${parts.join('/').replace(/\//g, '_')}.json`;
}

async function getCachedPlugin(
  key: string,
  env: Env
): Promise<ExtractedPlugin | null> {
  try {
    const object = await env.PLUGIN_CACHE.get(key);
    if (!object) return null;

    const metadata = object.customMetadata as Record<string, string> | undefined;
    if (!metadata?.extracted_at) return null;

    // Check if cache is stale
    const extractedAt = parseInt(metadata.extracted_at, 10);
    if (Date.now() - extractedAt > CACHE_TTL_SECONDS * 1000) {
      return null;
    }

    const text = await object.text();
    return JSON.parse(text) as ExtractedPlugin;
  } catch (error) {
    log.warn('Failed to read plugin cache', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function cachePlugin(
  key: string,
  plugin: ExtractedPlugin,
  env: Env
): Promise<void> {
  const metadata: Record<string, string> = {
    extracted_at: Date.now().toString(),
    expires_at: (Date.now() + CACHE_TTL_SECONDS * 1000).toString(),
  };

  try {
    await env.PLUGIN_CACHE.put(key, JSON.stringify(plugin), {
      customMetadata: metadata,
    });
  } catch (error) {
    log.warn('Failed to cache plugin', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function parsePluginFiles(
  files: GitHubFile[],
  source: PluginSource
): ExtractedPlugin {
  const plugin: ExtractedPlugin = {
    name: source.repo.split('/').pop() || 'unknown',
    skills: [],
    commands: [],
    mcpServers: {},
  };

  // Find and parse manifest
  const manifestFile = files.find(
    (f) => f.name === 'manifest.yaml' || f.name === 'manifest.yml'
  );
  if (manifestFile?.content) {
    try {
      const manifest = parseYaml(manifestFile.content) as PluginManifest;
      plugin.name = manifest.name || plugin.name;
    } catch (error) {
      log.warn('Failed to parse plugin manifest', {
        source: source.repo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Extract skills (*.md files in skills/ directory)
  for (const file of files) {
    const isInSkillsDir =
      file.path.includes('/skills/') || file.path.startsWith('skills/');
    if (isInSkillsDir && file.name.endsWith('.md')) {
      plugin.skills.push({
        name: file.name.replace('.md', ''),
        content: file.content || '',
      });
    }
  }

  // Extract commands (*.md files in commands/ directory)
  for (const file of files) {
    const isInCommandsDir =
      file.path.includes('/commands/') || file.path.startsWith('commands/');
    if (isInCommandsDir && file.name.endsWith('.md')) {
      plugin.commands.push({
        name: file.name.replace('.md', ''),
        content: file.content || '',
      });
    }
  }

  // Parse MCP server configurations
  const mcpConfigFile = files.find(
    (f) => f.name === 'mcp.yaml' || f.name === 'mcp.yml'
  );
  if (mcpConfigFile?.content) {
    try {
      const mcpConfig = parseYaml(mcpConfigFile.content) as Record<
        string,
        MCPServerConfig
      >;
      plugin.mcpServers = processMcpConfig(mcpConfig, source.env || {});
    } catch (error) {
      log.warn('Failed to parse MCP config', {
        source: source.repo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return plugin;
}

function processMcpConfig(
  config: Record<string, MCPServerConfig>,
  envOverrides: Record<string, string>
): Record<string, MCPServerConfig> {
  const processed: Record<string, MCPServerConfig> = {};

  for (const [name, server] of Object.entries(config)) {
    processed[name] = {
      ...server,
      env: {
        ...server.env,
        ...envOverrides,
      },
    };
  }

  return processed;
}
