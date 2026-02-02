/**
 * Unit tests for plugins.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPluginsForTenant } from '../../src/lib/plugins';
import type { Env, PluginSource } from '../../src/lib/types';

// Mock github module
vi.mock('../../src/lib/github', () => ({
  fetchDirectoryRecursive: vi.fn(),
}));

import { fetchDirectoryRecursive } from '../../src/lib/github';

describe('plugins', () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEnv = {
      CF_TEAM_DOMAIN: 'test-team.cloudflareaccess.com',
      CF_POLICY_AUD: 'test-policy-aud',
      CF_ACCOUNT_ID: 'test-account',
      AI_GATEWAY_ID: 'test-gateway',
      ENCRYPTION_KEY: '0'.repeat(64),
      ENVIRONMENT: 'development',
      TENANT_KV: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      } as unknown as KVNamespace,
      TENANT_TOKENS: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      } as unknown as KVNamespace,
      SECRETS_KV: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      } as unknown as KVNamespace,
      PLUGIN_CACHE: {
        get: vi.fn(),
        put: vi.fn(),
      } as unknown as R2Bucket,
      TENANT_STORAGE: {} as R2Bucket,
    };
  });

  describe('loadPluginsForTenant', () => {
    it('should return empty bundle when no sources', async () => {
      const result = await loadPluginsForTenant([], mockEnv);

      expect(result).toEqual({
        skills: [],
        commands: [],
        mcpServers: {},
      });
    });

    it('should extract skills from GitHub repo', async () => {
      vi.mocked(mockEnv.PLUGIN_CACHE.get).mockResolvedValueOnce(null);
      vi.mocked(fetchDirectoryRecursive).mockResolvedValueOnce([
        {
          name: 'manifest.yaml',
          path: 'manifest.yaml',
          type: 'file',
          sha: 'abc',
          content: 'name: test-plugin\nversion: 1.0.0',
        },
        {
          name: 'coding.md',
          path: 'skills/coding.md',
          type: 'file',
          sha: 'def',
          content: '# Coding Skill\n\nHelp with coding tasks.',
        },
      ]);

      const sources: PluginSource[] = [{ repo: 'org/plugin-repo' }];
      const result = await loadPluginsForTenant(sources, mockEnv);

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe('coding');
      expect(result.skills[0].content).toContain('Coding Skill');
    });

    it('should extract commands from GitHub repo', async () => {
      vi.mocked(mockEnv.PLUGIN_CACHE.get).mockResolvedValueOnce(null);
      vi.mocked(fetchDirectoryRecursive).mockResolvedValueOnce([
        {
          name: 'deploy.md',
          path: 'commands/deploy.md',
          type: 'file',
          sha: 'abc',
          content: '# Deploy Command\n\nDeploy to production.',
        },
      ]);

      const sources: PluginSource[] = [{ repo: 'org/plugin-repo' }];
      const result = await loadPluginsForTenant(sources, mockEnv);

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].name).toBe('deploy');
    });

    it('should extract MCP servers from config', async () => {
      vi.mocked(mockEnv.PLUGIN_CACHE.get).mockResolvedValueOnce(null);
      vi.mocked(fetchDirectoryRecursive).mockResolvedValueOnce([
        {
          name: 'mcp.yaml',
          path: 'mcp.yaml',
          type: 'file',
          sha: 'abc',
          content: `
my-server:
  url: https://mcp.example.com
  env:
    API_KEY: default-key
`,
        },
      ]);

      const sources: PluginSource[] = [
        {
          repo: 'org/plugin-repo',
          env: { API_KEY: 'override-key' },
        },
      ];
      const result = await loadPluginsForTenant(sources, mockEnv);

      expect(result.mcpServers['my-server']).toBeDefined();
      expect(result.mcpServers['my-server'].url).toBe('https://mcp.example.com');
      expect(result.mcpServers['my-server'].env?.API_KEY).toBe('override-key');
    });

    it('should use cached plugin when available and fresh', async () => {
      const cachedPlugin = {
        name: 'cached-plugin',
        skills: [{ name: 'cached-skill', content: 'cached content' }],
        commands: [],
        mcpServers: {},
      };

      vi.mocked(mockEnv.PLUGIN_CACHE.get).mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(cachedPlugin)),
        customMetadata: {
          extracted_at: Date.now().toString(),
        },
      } as unknown as R2ObjectBody);

      const sources: PluginSource[] = [{ repo: 'org/plugin-repo' }];
      const result = await loadPluginsForTenant(sources, mockEnv);

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe('cached-skill');
      expect(fetchDirectoryRecursive).not.toHaveBeenCalled();
    });

    it('should refetch when cache is stale', async () => {
      const cachedPlugin = {
        name: 'stale-plugin',
        skills: [{ name: 'stale-skill', content: 'stale content' }],
        commands: [],
        mcpServers: {},
      };

      // Cache from 10 minutes ago (stale)
      vi.mocked(mockEnv.PLUGIN_CACHE.get).mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(cachedPlugin)),
        customMetadata: {
          extracted_at: (Date.now() - 600000).toString(),
        },
      } as unknown as R2ObjectBody);

      vi.mocked(fetchDirectoryRecursive).mockResolvedValueOnce([
        {
          name: 'fresh-skill.md',
          path: 'skills/fresh-skill.md',
          type: 'file',
          sha: 'abc',
          content: '# Fresh Skill',
        },
      ]);

      const sources: PluginSource[] = [{ repo: 'org/plugin-repo' }];
      const result = await loadPluginsForTenant(sources, mockEnv);

      expect(result.skills[0].name).toBe('fresh-skill');
      expect(fetchDirectoryRecursive).toHaveBeenCalled();
    });

    it('should merge multiple plugin sources', async () => {
      vi.mocked(mockEnv.PLUGIN_CACHE.get).mockResolvedValue(null);
      vi.mocked(fetchDirectoryRecursive)
        .mockResolvedValueOnce([
          {
            name: 'skill1.md',
            path: 'skills/skill1.md',
            type: 'file',
            sha: 'a',
            content: '# Skill 1',
          },
        ])
        .mockResolvedValueOnce([
          {
            name: 'skill2.md',
            path: 'skills/skill2.md',
            type: 'file',
            sha: 'b',
            content: '# Skill 2',
          },
        ]);

      const sources: PluginSource[] = [
        { repo: 'org/plugin1' },
        { repo: 'org/plugin2' },
      ];
      const result = await loadPluginsForTenant(sources, mockEnv);

      expect(result.skills).toHaveLength(2);
    });
  });
});
