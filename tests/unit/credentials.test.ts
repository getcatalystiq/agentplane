/**
 * Unit tests for credentials.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSecret,
  setSecret,
  deleteSecret,
  getOAuthCredential,
  setOAuthCredential,
} from '../../src/lib/credentials';
import type { Env, OAuthCredential } from '../../src/lib/types';

function createMockEnv(): Env {
  return {
    CF_TEAM_DOMAIN: 'test-team.cloudflareaccess.com',
    CF_POLICY_AUD: 'test-policy-aud',
    CF_ACCOUNT_ID: 'test-account',
    AI_GATEWAY_ID: 'test-gateway',
    ENCRYPTION_KEY: 'a'.repeat(64), // 32-byte key in hex
    ENVIRONMENT: 'development',
    TENANT_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
    TENANT_TOKENS: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
    SECRETS_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
    PLUGIN_CACHE: {} as R2Bucket,
    TENANT_STORAGE: {} as R2Bucket,
  };
}

describe('credentials', () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = createMockEnv();
  });

  describe('secret management', () => {
    it('should return null for non-existent secret', async () => {
      (mockEnv.SECRETS_KV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const result = await getSecret('tenant1', 'api-key', mockEnv);

      expect(result).toBeNull();
      expect(mockEnv.SECRETS_KV.get).toHaveBeenCalledWith('tenant1:api-key');
    });

    it('should encrypt and store secret', async () => {
      await setSecret('tenant1', 'api-key', 'secret-value', mockEnv);

      expect(mockEnv.SECRETS_KV.put).toHaveBeenCalledWith(
        'tenant1:api-key',
        expect.any(String)
      );

      // Verify the stored value is base64 encoded (encrypted)
      const storedValue = (mockEnv.SECRETS_KV.put as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(() => atob(storedValue)).not.toThrow();
    });

    it('should decrypt stored secret', async () => {
      // First store a secret
      await setSecret('tenant1', 'test-key', 'test-secret', mockEnv);

      // Get the encrypted value that was stored
      const encryptedValue = (mockEnv.SECRETS_KV.put as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;

      // Mock getting the encrypted value back
      (mockEnv.SECRETS_KV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(encryptedValue);

      const result = await getSecret('tenant1', 'test-key', mockEnv);

      expect(result).toBe('test-secret');
    });

    it('should delete secret', async () => {
      await deleteSecret('tenant1', 'api-key', mockEnv);

      expect(mockEnv.SECRETS_KV.delete).toHaveBeenCalledWith('tenant1:api-key');
    });
  });

  describe('OAuth credential management', () => {
    it('should return null for non-existent credential', async () => {
      (mockEnv.SECRETS_KV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const result = await getOAuthCredential('tenant1', 'google', mockEnv);

      expect(result).toBeNull();
    });

    it('should store OAuth credential encrypted', async () => {
      const credential: OAuthCredential = {
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-456',
        expires_at: Date.now() + 3600000,
        token_type: 'Bearer',
        scopes: ['read', 'write'],
      };

      await setOAuthCredential('tenant1', 'google', credential, mockEnv);

      expect(mockEnv.SECRETS_KV.put).toHaveBeenCalledWith(
        'tenant1:oauth:google',
        expect.any(String)
      );
    });

    it('should retrieve and parse OAuth credential', async () => {
      const credential: OAuthCredential = {
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-456',
        expires_at: Date.now() + 3600000,
        token_type: 'Bearer',
        scopes: ['read', 'write'],
      };

      // Store the credential
      await setOAuthCredential('tenant1', 'google', credential, mockEnv);

      // Get the encrypted value
      const encryptedValue = (mockEnv.SECRETS_KV.put as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;

      // Mock getting it back
      (mockEnv.SECRETS_KV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(encryptedValue);

      const result = await getOAuthCredential('tenant1', 'google', mockEnv);

      expect(result).toEqual(credential);
    });
  });
});
