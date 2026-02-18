interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

// In-memory sliding window rate limiter (upgrade to Vercel KV for production)
const windows = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Get or create window
  let timestamps = windows.get(key) || [];

  // Remove expired entries
  timestamps = timestamps.filter((t) => t > windowStart);

  const allowed = timestamps.length < config.maxRequests;

  if (allowed) {
    timestamps.push(now);
  }

  windows.set(key, timestamps);

  // Clean up old keys periodically
  if (windows.size > 10_000) {
    for (const [k, v] of windows) {
      if (v.length === 0 || v[v.length - 1] < windowStart) {
        windows.delete(k);
      }
    }
  }

  return {
    allowed,
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - timestamps.length),
    resetAt: timestamps.length > 0
      ? timestamps[0] + config.windowMs
      : now + config.windowMs,
  };
}

// Pre-configured limiters
export const RATE_LIMITS = {
  // 60 requests per minute per tenant for control plane
  controlPlane: { windowMs: 60_000, maxRequests: 60 },
  // 10 auth failures per minute per IP
  authFailure: { windowMs: 60_000, maxRequests: 10 },
} as const;

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    ...(result.allowed ? {} : { "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)) }),
  };
}
