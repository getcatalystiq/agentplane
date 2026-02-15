import { logger } from "./logger";

// In-memory idempotency store (upgrade to Vercel KV for production)
const store = new Map<string, { response: unknown; expiresAt: number }>();

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getIdempotentResponse(key: string): unknown | null {
  const entry = store.get(key);
  if (!entry) return null;

  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }

  logger.debug("Idempotency cache hit", { key });
  return entry.response;
}

export function setIdempotentResponse(key: string, response: unknown): void {
  store.set(key, {
    response,
    expiresAt: Date.now() + TTL_MS,
  });

  // Clean up expired entries periodically
  if (store.size > 10_000) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (v.expiresAt < now) {
        store.delete(k);
      }
    }
  }
}
