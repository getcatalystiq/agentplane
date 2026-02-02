/**
 * Unit tests for ai-gateway.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAIGatewayUrl,
  getProviderFromConfig,
  proxyToAIGateway,
} from '../../src/lib/ai-gateway';
import type { Env, TenantConfig } from '../../src/lib/types';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function createMockEnv(): Env {
  return {
    CF_TEAM_DOMAIN: 'test-team.cloudflareaccess.com',
    CF_POLICY_AUD: 'test-policy-aud',
    CF_ACCOUNT_ID: 'test-account-id',
    AI_GATEWAY_ID: 'test-gateway-id',
    ENCRYPTION_KEY: '0'.repeat(64),
    ENVIRONMENT: 'development',
    TENANT_KV: {} as KVNamespace,
    TENANT_TOKENS: {} as KVNamespace,
    SECRETS_KV: {} as KVNamespace,
    PLUGIN_CACHE: {} as R2Bucket,
    TENANT_STORAGE: {} as R2Bucket,
  };
}

describe('ai-gateway', () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = createMockEnv();
  });

  describe('getAIGatewayUrl', () => {
    it('should return Anthropic gateway URL', () => {
      const url = getAIGatewayUrl(mockEnv, { provider: 'anthropic' });

      expect(url).toBe(
        'https://gateway.ai.cloudflare.com/v1/test-account-id/test-gateway-id/anthropic'
      );
    });

    it('should return Bedrock gateway URL with default region', () => {
      const url = getAIGatewayUrl(mockEnv, { provider: 'bedrock' });

      expect(url).toBe(
        'https://gateway.ai.cloudflare.com/v1/test-account-id/test-gateway-id/aws-bedrock/bedrock-runtime/us-east-1'
      );
    });

    it('should return Bedrock gateway URL with custom region', () => {
      const url = getAIGatewayUrl(mockEnv, {
        provider: 'bedrock',
        region: 'us-west-2',
      });

      expect(url).toBe(
        'https://gateway.ai.cloudflare.com/v1/test-account-id/test-gateway-id/aws-bedrock/bedrock-runtime/us-west-2'
      );
    });
  });

  describe('getProviderFromConfig', () => {
    it('should default to anthropic when ai not configured', () => {
      const config: TenantConfig = {
        tenant: { id: 'test', name: 'Test', created_at: '' },
        resources: {
          sandbox: { sleep_after: '5m', max_concurrent_sessions: 5 },
          storage: { bucket_prefix: 'test', quota_gb: 10 },
        },
        plugins: [],
        rate_limits: { requests_per_minute: 60, tokens_per_day: 1000000 },
      };

      const options = getProviderFromConfig(config);

      expect(options.provider).toBe('anthropic');
    });

    it('should extract bedrock config', () => {
      const config: TenantConfig = {
        tenant: { id: 'test', name: 'Test', created_at: '' },
        resources: {
          sandbox: { sleep_after: '5m', max_concurrent_sessions: 5 },
          storage: { bucket_prefix: 'test', quota_gb: 10 },
        },
        plugins: [],
        ai: {
          provider: 'bedrock',
          bedrock_region: 'eu-west-1',
          bedrock_model: 'anthropic.claude-3-opus',
        },
        rate_limits: { requests_per_minute: 60, tokens_per_day: 1000000 },
      };

      const options = getProviderFromConfig(config);

      expect(options.provider).toBe('bedrock');
      expect(options.region).toBe('eu-west-1');
      expect(options.model).toBe('anthropic.claude-3-opus');
    });
  });

  describe('proxyToAIGateway', () => {
    it('should proxy Anthropic requests', async () => {
      const config: TenantConfig = {
        tenant: { id: 'test', name: 'Test', created_at: '' },
        resources: {
          sandbox: { sleep_after: '5m', max_concurrent_sessions: 5 },
          storage: { bucket_prefix: 'test', quota_gb: 10 },
        },
        plugins: [],
        ai: { provider: 'anthropic' },
        rate_limits: { requests_per_minute: 60, tokens_per_day: 1000000 },
      };

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello!' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const request = new Request('https://example.com/api/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      const response = await proxyToAIGateway(request, config, mockEnv);

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/anthropic'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should transform Bedrock requests and responses', async () => {
      const config: TenantConfig = {
        tenant: { id: 'test', name: 'Test', created_at: '' },
        resources: {
          sandbox: { sleep_after: '5m', max_concurrent_sessions: 5 },
          storage: { bucket_prefix: 'test', quota_gb: 10 },
        },
        plugins: [],
        ai: {
          provider: 'bedrock',
          bedrock_region: 'us-east-1',
          bedrock_model: 'anthropic.claude-3-sonnet-20240229-v1:0',
        },
        rate_limits: { requests_per_minute: 60, tokens_per_day: 1000000 },
      };

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'Hello from Bedrock!' }],
            model: 'claude-3-sonnet',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const request = new Request('https://example.com/api/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      const response = await proxyToAIGateway(request, config, mockEnv);
      const data = (await response.json()) as { content: Array<{ text: string }>; type: string };

      expect(response.status).toBe(200);
      expect(data.content[0].text).toBe('Hello from Bedrock!');
      expect(data.type).toBe('message');
    });

    it('should handle gateway errors', async () => {
      const config: TenantConfig = {
        tenant: { id: 'test', name: 'Test', created_at: '' },
        resources: {
          sandbox: { sleep_after: '5m', max_concurrent_sessions: 5 },
          storage: { bucket_prefix: 'test', quota_gb: 10 },
        },
        plugins: [],
        ai: { provider: 'anthropic' },
        rate_limits: { requests_per_minute: 60, tokens_per_day: 1000000 },
      };

      mockFetch.mockRejectedValueOnce(new Error('Gateway timeout'));

      const request = new Request('https://example.com/api/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-3-sonnet',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      const response = await proxyToAIGateway(request, config, mockEnv);
      const data = (await response.json()) as { error: { type: string } };

      expect(response.status).toBe(500);
      expect(data.error.type).toBe('api_error');
    });
  });
});
