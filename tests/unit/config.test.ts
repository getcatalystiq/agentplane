/**
 * Unit tests for config.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getTenantConfig,
  setTenantConfig,
  validateMcpDomain,
  filterAllowedMcpServers,
  checkRateLimit,
} from '../../src/lib/config';
import type { Env, TenantConfig, MCPServerConfig } from '../../src/lib/types';

function createMockEnv(): Env {
  return {
    CF_TEAM_DOMAIN: 'test-team.cloudflareaccess.com',
    CF_POLICY_AUD: 'test-policy-aud',
    CF_ACCOUNT_ID: 'test-account',
    AI_GATEWAY_ID: 'test-gateway',
    ENCRYPTION_KEY: '0'.repeat(64),
    ENVIRONMENT: 'development',
    TENANT_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ keys: [] }),
    } as unknown as KVNamespace,
    TENANT_TOKENS: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ keys: [] }),
    } as unknown as KVNamespace,
    SECRETS_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ keys: [] }),
    } as unknown as KVNamespace,
    PLUGIN_CACHE: {} as R2Bucket,
    TENANT_STORAGE: {} as R2Bucket,
  };
}

describe('config', () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = createMockEnv();
  });

  describe('getTenantConfig', () => {
    it('should return null when tenant not found', async () => {
      (mockEnv.TENANT_KV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const result = await getTenantConfig('unknown-tenant', mockEnv);

      expect(result).toBeNull();
    });

    it('should return parsed config when tenant exists', async () => {
      const config: TenantConfig = {
        tenant: {
          id: 'test-tenant',
          name: 'Test Tenant',
          created_at: '2024-01-01T00:00:00Z',
        },
        resources: {
          sandbox: { sleep_after: '5m', max_concurrent_sessions: 5 },
          storage: { bucket_prefix: 'test', quota_gb: 10 },
        },
        plugins: [],
        rate_limits: { requests_per_minute: 60, tokens_per_day: 1000000 },
      };

      (mockEnv.TENANT_KV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify(config));

      const result = await getTenantConfig('test-tenant', mockEnv);

      // Check key fields (validation adds defaults for optional fields)
      expect(result?.tenant.id).toBe('test-tenant');
      expect(result?.tenant.name).toBe('Test Tenant');
      expect(result?.resources.sandbox.sleep_after).toBe('5m');
      expect(result?.rate_limits.requests_per_minute).toBe(60);
    });

    it('should return null on invalid JSON', async () => {
      (mockEnv.TENANT_KV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce('invalid json');

      const result = await getTenantConfig('test-tenant', mockEnv);

      expect(result).toBeNull();
    });
  });

  describe('setTenantConfig', () => {
    it('should store config with defaults applied', async () => {
      const config: TenantConfig = {
        tenant: { id: 'test', name: 'Test', created_at: '' },
        resources: {
          sandbox: { sleep_after: '', max_concurrent_sessions: 0 },
          storage: { bucket_prefix: '', quota_gb: 0 },
        },
        plugins: [],
        rate_limits: { requests_per_minute: 0, tokens_per_day: 0 },
      };

      await setTenantConfig('test', config, mockEnv);

      expect(mockEnv.TENANT_KV.put).toHaveBeenCalledWith(
        'test',
        expect.stringContaining('"sleep_after":"5m"')
      );
    });
  });

  describe('validateMcpDomain', () => {
    it('should reject command-based servers by default', () => {
      const server: MCPServerConfig = { command: 'node', args: ['server.js'] };
      expect(validateMcpDomain(server, ['example.com'])).toBe(false);
    });

    it('should allow command-based servers when explicitly enabled', () => {
      const server: MCPServerConfig = { command: 'node', args: ['server.js'] };
      expect(validateMcpDomain(server, ['example.com'], true)).toBe(true);
    });

    it('should reject unknown commands even when enabled', () => {
      const server: MCPServerConfig = { command: 'rm', args: ['-rf', '/'] };
      expect(validateMcpDomain(server, ['example.com'], true)).toBe(false);
    });

    it('should allow exact domain matches', () => {
      const server: MCPServerConfig = { url: 'https://api.example.com/mcp' };
      expect(validateMcpDomain(server, ['api.example.com'])).toBe(true);
    });

    it('should allow wildcard domain matches', () => {
      const server: MCPServerConfig = { url: 'https://mcp.example.com/api' };
      expect(validateMcpDomain(server, ['*.example.com'])).toBe(true);
    });

    it('should allow base domain with wildcard', () => {
      const server: MCPServerConfig = { url: 'https://example.com/mcp' };
      expect(validateMcpDomain(server, ['*.example.com'])).toBe(true);
    });

    it('should reject non-matching domains', () => {
      const server: MCPServerConfig = { url: 'https://malicious.com/mcp' };
      expect(validateMcpDomain(server, ['example.com'])).toBe(false);
    });

    it('should reject invalid URLs', () => {
      const server: MCPServerConfig = { url: 'not-a-url' };
      expect(validateMcpDomain(server, ['example.com'])).toBe(false);
    });
  });

  describe('filterAllowedMcpServers', () => {
    it('should return only URL-based servers when allowlist is empty', () => {
      const servers: Record<string, MCPServerConfig> = {
        server1: { url: 'https://any.com' },
        server2: { command: 'node' },
      };

      const result = filterAllowedMcpServers(servers, []);
      expect(result).toEqual({ server1: { url: 'https://any.com' } });
    });

    it('should include command servers when explicitly enabled', () => {
      const servers: Record<string, MCPServerConfig> = {
        server1: { url: 'https://any.com' },
        server2: { command: 'node' },
      };

      const result = filterAllowedMcpServers(servers, [], true);
      expect(result).toEqual(servers);
    });

    it('should filter out non-allowed domains', () => {
      const servers: Record<string, MCPServerConfig> = {
        allowed: { url: 'https://api.example.com' },
        blocked: { url: 'https://malicious.com' },
        command: { command: 'node' },
      };

      const result = filterAllowedMcpServers(servers, ['*.example.com']);
      expect(Object.keys(result)).toEqual(['allowed']);
    });

    it('should include command servers with domain filter when enabled', () => {
      const servers: Record<string, MCPServerConfig> = {
        allowed: { url: 'https://api.example.com' },
        blocked: { url: 'https://malicious.com' },
        command: { command: 'node' },
      };

      const result = filterAllowedMcpServers(servers, ['*.example.com'], true);
      expect(Object.keys(result)).toEqual(['allowed', 'command']);
    });
  });

  describe('checkRateLimit', () => {
    it('should allow request under limit', async () => {
      const config: TenantConfig = {
        tenant: { id: 'test', name: 'Test', created_at: '' },
        resources: {
          sandbox: { sleep_after: '5m', max_concurrent_sessions: 5 },
          storage: { bucket_prefix: 'test', quota_gb: 10 },
        },
        plugins: [],
        rate_limits: { requests_per_minute: 60, tokens_per_day: 1000000 },
      };

      (mockEnv.TENANT_KV.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await checkRateLimit('test', config, mockEnv);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(59);
    });

    it('should deny request over limit', async () => {
      const config: TenantConfig = {
        tenant: { id: 'test', name: 'Test', created_at: '' },
        resources: {
          sandbox: { sleep_after: '5m', max_concurrent_sessions: 5 },
          storage: { bucket_prefix: 'test', quota_gb: 10 },
        },
        plugins: [],
        rate_limits: { requests_per_minute: 60, tokens_per_day: 1000000 },
      };

      const state = {
        requests: 60,
        tokens: 0,
        window_start: Date.now(),
        day_start: Date.now(),
        version: 1,
      };

      (mockEnv.TENANT_KV.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));

      const result = await checkRateLimit('test', config, mockEnv);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should reset window after expiration', async () => {
      const config: TenantConfig = {
        tenant: { id: 'test', name: 'Test', created_at: '' },
        resources: {
          sandbox: { sleep_after: '5m', max_concurrent_sessions: 5 },
          storage: { bucket_prefix: 'test', quota_gb: 10 },
        },
        plugins: [],
        rate_limits: { requests_per_minute: 60, tokens_per_day: 1000000 },
      };

      const state = {
        requests: 60,
        tokens: 0,
        window_start: Date.now() - 120000, // 2 minutes ago
        day_start: Date.now(),
        version: 1,
      };

      (mockEnv.TENANT_KV.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));

      const result = await checkRateLimit('test', config, mockEnv);

      expect(result.allowed).toBe(true);
    });
  });
});
