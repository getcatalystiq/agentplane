import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getEnv, resetEnvCache } from "@/lib/env";

const VALID_ENV = {
  DATABASE_URL: "postgresql://localhost/test",
  ENCRYPTION_KEY: "0".repeat(64),
  ADMIN_API_KEY: "admin-key-123",
  AI_GATEWAY_API_KEY: "gateway-key-456",
  CRON_SECRET: "test-cron-secret",
  NODE_ENV: "test",
};

describe("getEnv", () => {
  beforeEach(() => {
    resetEnvCache();
    for (const [key, value] of Object.entries(VALID_ENV)) {
      vi.stubEnv(key, value);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("returns parsed Env for valid environment", () => {
    const env = getEnv();
    expect(env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(env.ENCRYPTION_KEY).toBe(VALID_ENV.ENCRYPTION_KEY);
    expect(env.ADMIN_API_KEY).toBe(VALID_ENV.ADMIN_API_KEY);
    expect(env.AI_GATEWAY_API_KEY).toBe(VALID_ENV.AI_GATEWAY_API_KEY);
    expect(env.CRON_SECRET).toBe(VALID_ENV.CRON_SECRET);
    expect(env.NODE_ENV).toBe("test");
  });

  it("throws when DATABASE_URL is missing", () => {
    vi.stubEnv("DATABASE_URL", "");
    resetEnvCache();
    expect(() => getEnv()).toThrow("Environment validation failed");
  });

  it("throws when ENCRYPTION_KEY is wrong length (32 chars)", () => {
    vi.stubEnv("ENCRYPTION_KEY", "0".repeat(32));
    resetEnvCache();
    expect(() => getEnv()).toThrow("Environment validation failed");
  });

  it("throws when ADMIN_API_KEY is missing", () => {
    vi.stubEnv("ADMIN_API_KEY", "");
    resetEnvCache();
    expect(() => getEnv()).toThrow("Environment validation failed");
  });

  it("throws when AI_GATEWAY_API_KEY is missing", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    resetEnvCache();
    expect(() => getEnv()).toThrow("Environment validation failed");
  });

  it("throws when CRON_SECRET is missing", () => {
    vi.stubEnv("CRON_SECRET", "");
    resetEnvCache();
    expect(() => getEnv()).toThrow("Environment validation failed");
  });

  it("defaults NODE_ENV to development when not set", () => {
    vi.stubEnv("NODE_ENV", undefined as unknown as string);
    resetEnvCache();
    const env = getEnv();
    expect(env.NODE_ENV).toBe("development");
  });

  it("returns cached object on multiple calls", () => {
    const a = getEnv();
    const b = getEnv();
    expect(a).toBe(b);
  });

  it("re-reads env after resetEnvCache()", () => {
    const a = getEnv();
    resetEnvCache();
    const b = getEnv();
    expect(a).not.toBe(b);
  });
});
