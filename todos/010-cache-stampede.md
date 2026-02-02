# Cache Stampede Vulnerability

**Priority:** P2-HIGH
**Category:** performance, data-integrity
**File:** src/lib/plugins.ts
**Lines:** 43-69
**Blocks:** none

## Description

When the plugin cache expires, multiple concurrent requests will all miss the cache and fetch from GitHub simultaneously, creating a "thundering herd" or cache stampede.

## Current Code

```typescript
async function extractPlugin(source: PluginSource, env: Env): Promise<ExtractedPlugin> {
  const cached = await getCachedPlugin(cacheKey, env);
  if (cached) return cached;  // All concurrent requests miss here

  const files = await fetchDirectoryRecursive({...});  // All fetch from GitHub
  await cachePlugin(cacheKey, plugin, env);  // All write to cache
  return plugin;
}
```

## Impact

- Spike in GitHub API calls on cache expiry
- Potential rate limiting from GitHub
- Increased latency during stampede
- Wasted compute and bandwidth

## Fix

Implement probabilistic early expiration (PER) or lock-based refresh:

### Option A: Probabilistic Early Expiration

```typescript
function shouldRefreshEarly(extractedAt: number, ttl: number): boolean {
  const age = Date.now() - extractedAt;
  const remaining = ttl - age;

  if (remaining <= 0) return true;

  // Probabilistic refresh in last 20% of TTL
  const threshold = ttl * 0.8;
  if (age > threshold) {
    const probability = (age - threshold) / (ttl - threshold);
    return Math.random() < probability;
  }

  return false;
}
```

### Option B: Single-flight pattern

```typescript
const inFlight = new Map<string, Promise<ExtractedPlugin>>();

async function extractPlugin(source: PluginSource, env: Env): Promise<ExtractedPlugin> {
  const cacheKey = getCacheKey(source);

  // Check if already in flight
  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = extractPluginImpl(source, env).finally(() => {
    inFlight.delete(cacheKey);
  });

  inFlight.set(cacheKey, promise);
  return promise;
}
```

## Recommendation

Use Option B (single-flight) for simplicity and effectiveness in Workers environment.
