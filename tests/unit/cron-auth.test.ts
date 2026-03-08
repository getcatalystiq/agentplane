import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyCronSecret } from "@/lib/cron-auth";
import { resetEnvCache } from "@/lib/env";

describe("verifyCronSecret", () => {
  const REAL_SECRET = "test-cron-secret-12345";

  beforeEach(() => {
    resetEnvCache();
    // Set all required env vars
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
    vi.stubEnv("ADMIN_API_KEY", "test-admin-key");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
    vi.stubEnv("CRON_SECRET", REAL_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  function makeRequest(authHeader: string | null): Parameters<typeof verifyCronSecret>[0] {
    return {
      headers: {
        get: (name: string) => (name === "authorization" ? authHeader : null),
      },
    } as Parameters<typeof verifyCronSecret>[0];
  }

  it("passes with valid bearer token", () => {
    const req = makeRequest(`Bearer ${REAL_SECRET}`);
    expect(() => verifyCronSecret(req)).not.toThrow();
  });

  it("throws with wrong secret", () => {
    const req = makeRequest("Bearer wrong-secret");
    expect(() => verifyCronSecret(req)).toThrow("Invalid cron secret");
  });

  it("throws with missing authorization header", () => {
    const req = makeRequest(null);
    expect(() => verifyCronSecret(req)).toThrow("Invalid cron secret");
  });

  it("throws with empty authorization header", () => {
    const req = makeRequest("");
    expect(() => verifyCronSecret(req)).toThrow("Invalid cron secret");
  });
});
