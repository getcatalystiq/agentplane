/**
 * Unit tests for auth.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../../src/lib/types';

// Mock jose module with inline class definitions
vi.mock('jose', () => {
  class JWTExpired extends Error {
    constructor(message = 'token expired') {
      super(message);
      this.name = 'JWTExpired';
    }
  }
  class JWTClaimValidationFailed extends Error {
    constructor(message = 'claim validation failed') {
      super(message);
      this.name = 'JWTClaimValidationFailed';
    }
  }
  class JWSSignatureVerificationFailed extends Error {
    constructor(message = 'signature verification failed') {
      super(message);
      this.name = 'JWSSignatureVerificationFailed';
    }
  }
  return {
    createRemoteJWKSet: vi.fn(() => vi.fn()),
    jwtVerify: vi.fn(),
    errors: {
      JWTExpired,
      JWTClaimValidationFailed,
      JWSSignatureVerificationFailed,
    },
  };
});

import { validateRequestAndGetTenant } from '../../src/lib/auth';
import * as jose from 'jose';

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

describe('auth', () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = createMockEnv();
  });

  describe('validateRequestAndGetTenant', () => {
    it('should return missing_token when no token is present', async () => {
      const request = new Request('https://example.com', {
        headers: {},
      });

      const result = await validateRequestAndGetTenant(request, mockEnv);

      expect(result).toEqual({ success: false, reason: 'missing_token' });
    });

    it('should extract token from CF-Access-JWT-Assertion header', async () => {
      const mockPayload = {
        sub: 'test-client-id',
        aud: ['test-policy-aud'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'https://test-team.cloudflareaccess.com',
        service_token_id: 'test-service-token',
      };

      vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as never);

      (mockEnv.TENANT_TOKENS.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce('test-tenant');

      const request = new Request('https://example.com', {
        headers: {
          'CF-Access-JWT-Assertion': 'valid.jwt.token',
        },
      });

      const result = await validateRequestAndGetTenant(request, mockEnv);

      expect(result).toEqual({ success: true, tenantId: 'test-tenant' });
    });

    it('should extract token from cookie with tenant_id claim', async () => {
      const mockPayload = {
        sub: 'test-client-id',
        aud: ['test-policy-aud'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'https://test-team.cloudflareaccess.com',
        custom: { tenant_id: 'cookie-tenant' },
      };

      vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as never);

      const request = new Request('https://example.com', {
        headers: {
          Cookie: 'CF_Authorization=valid.jwt.token; other=value',
        },
      });

      const result = await validateRequestAndGetTenant(request, mockEnv);

      expect(result).toEqual({ success: true, tenantId: 'cookie-tenant' });
    });

    it('should handle cookie values containing equals signs', async () => {
      const mockPayload = {
        sub: 'test-client-id',
        aud: ['test-policy-aud'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'https://test-team.cloudflareaccess.com',
        custom: { tenant_id: 'cookie-tenant' },
      };

      vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as never);

      // JWT tokens often contain base64 with = padding
      const request = new Request('https://example.com', {
        headers: {
          Cookie: 'CF_Authorization=eyJhbGc=.eyJzdWI=.sig==; other=value',
        },
      });

      const result = await validateRequestAndGetTenant(request, mockEnv);

      expect(result).toEqual({ success: true, tenantId: 'cookie-tenant' });
    });

    it('should reject user tokens without tenant_id claim', async () => {
      const mockPayload = {
        sub: 'test-user',
        aud: ['test-policy-aud'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'https://test-team.cloudflareaccess.com',
        email: 'user@example.com',
        // No custom.tenant_id, no service_token_id
      };

      vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as never);

      const request = new Request('https://example.com', {
        headers: {
          'CF-Access-JWT-Assertion': 'valid.jwt.token',
        },
      });

      const result = await validateRequestAndGetTenant(request, mockEnv);

      // Should fail because user tokens without explicit tenant_id are rejected
      expect(result).toEqual({ success: false, reason: 'unknown_service_token' });
    });

    it('should return invalid_token on signature verification failure', async () => {
      vi.mocked(jose.jwtVerify).mockRejectedValueOnce(
        new jose.errors.JWSSignatureVerificationFailed('invalid')
      );

      const request = new Request('https://example.com', {
        headers: {
          'CF-Access-JWT-Assertion': 'invalid.jwt.token',
        },
      });

      const result = await validateRequestAndGetTenant(request, mockEnv);

      expect(result).toEqual({ success: false, reason: 'invalid_token' });
    });

    it('should return expired on token expiration', async () => {
      // Use type assertion to avoid jose type checking on mocked constructor
      const JWTExpiredClass = jose.errors.JWTExpired as unknown as new () => Error;
      vi.mocked(jose.jwtVerify).mockRejectedValueOnce(new JWTExpiredClass());

      const request = new Request('https://example.com', {
        headers: {
          'CF-Access-JWT-Assertion': 'expired.jwt.token',
        },
      });

      const result = await validateRequestAndGetTenant(request, mockEnv);

      expect(result).toEqual({ success: false, reason: 'expired' });
    });

    it('should return unknown_service_token when tenant mapping not found', async () => {
      const mockPayload = {
        sub: 'unknown-client-id',
        aud: ['test-policy-aud'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'https://test-team.cloudflareaccess.com',
        service_token_id: 'unknown-token',
      };

      vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as never);

      (mockEnv.TENANT_TOKENS.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const request = new Request('https://example.com', {
        headers: {
          'CF-Access-JWT-Assertion': 'valid.jwt.token',
        },
      });

      const result = await validateRequestAndGetTenant(request, mockEnv);

      expect(result).toEqual({ success: false, reason: 'unknown_service_token' });
    });
  });
});
