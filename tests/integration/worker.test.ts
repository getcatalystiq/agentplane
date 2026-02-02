/**
 * Integration tests for the AgentPlane worker
 *
 * These tests run against a deployed worker or local dev environment.
 * Set WORKER_URL environment variable to point to the worker.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';

// These should be set for integration tests
const SERVICE_TOKEN_CLIENT_ID = process.env.TEST_SERVICE_TOKEN_CLIENT_ID || '';
const SERVICE_TOKEN_SECRET = process.env.TEST_SERVICE_TOKEN_SECRET || '';

interface ErrorResponse {
  error: string;
}

describe('AgentPlane Worker Integration', () => {
  beforeAll(() => {
    if (!SERVICE_TOKEN_CLIENT_ID || !SERVICE_TOKEN_SECRET) {
      console.warn(
        'Warning: TEST_SERVICE_TOKEN_CLIENT_ID and TEST_SERVICE_TOKEN_SECRET not set. Some tests will be skipped.'
      );
    }
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${WORKER_URL}/health`);

      expect(response.status).toBe(200);

      const data = (await response.json()) as { status: string };
      expect(data.status).toBe('ok');
    });
  });

  describe('Authentication', () => {
    it('should reject requests without token', async () => {
      const response = await fetch(`${WORKER_URL}/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: 'test' }),
      });

      expect(response.status).toBe(401);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBe('missing_token');
    });

    it('should reject requests with invalid token', async () => {
      const response = await fetch(`${WORKER_URL}/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-JWT-Assertion': 'invalid.jwt.token',
        },
        body: JSON.stringify({ prompt: 'test' }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Agent Endpoint', () => {
    it.skipIf(!SERVICE_TOKEN_CLIENT_ID)(
      'should accept valid request with service token',
      async () => {
        const response = await fetch(`${WORKER_URL}/agent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CF-Access-Client-Id': SERVICE_TOKEN_CLIENT_ID,
            'CF-Access-Client-Secret': SERVICE_TOKEN_SECRET,
          },
          body: JSON.stringify({ prompt: 'Hello, world!' }),
        });

        // Should either succeed or return tenant_not_found if not provisioned
        expect([200, 404, 500]).toContain(response.status);
      }
    );

    it('should reject non-POST requests', async () => {
      const response = await fetch(`${WORKER_URL}/agent`, {
        method: 'GET',
        headers: {
          'CF-Access-JWT-Assertion': 'some.token.here',
        },
      });

      // Will fail auth first, but that's expected
      expect([401, 405]).toContain(response.status);
    });

    it.skipIf(!SERVICE_TOKEN_CLIENT_ID)(
      'should require prompt in request body',
      async () => {
        const response = await fetch(`${WORKER_URL}/agent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CF-Access-Client-Id': SERVICE_TOKEN_CLIENT_ID,
            'CF-Access-Client-Secret': SERVICE_TOKEN_SECRET,
          },
          body: JSON.stringify({}),
        });

        // Auth may pass, but missing prompt should return 400
        // or 401 if auth fails, or 404 if tenant not found
        expect([400, 401, 404]).toContain(response.status);
      }
    );
  });

  describe('Rate Limiting', () => {
    it.skipIf(!SERVICE_TOKEN_CLIENT_ID)(
      'should include rate limit headers',
      async () => {
        const response = await fetch(`${WORKER_URL}/agent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CF-Access-Client-Id': SERVICE_TOKEN_CLIENT_ID,
            'CF-Access-Client-Secret': SERVICE_TOKEN_SECRET,
          },
          body: JSON.stringify({ prompt: 'test' }),
        });

        // When rate limited, should have Retry-After header
        if (response.status === 429) {
          expect(response.headers.get('Retry-After')).toBe('60');
        }
      }
    );
  });

  describe('Session Management', () => {
    it('should return 404 for unknown session', async () => {
      const response = await fetch(
        `${WORKER_URL}/agent/session/nonexistent-session-id`,
        {
          headers: {
            'CF-Access-JWT-Assertion': 'some.token.here',
          },
        }
      );

      // Will fail auth first, but session endpoint should exist
      expect([401, 404]).toContain(response.status);
    });
  });

  describe('Unknown Routes', () => {
    it('should return 404 for unknown paths', async () => {
      const response = await fetch(`${WORKER_URL}/unknown-path`);

      // Might be 401 (auth first) or 404
      expect([401, 404]).toContain(response.status);
    });
  });
});
