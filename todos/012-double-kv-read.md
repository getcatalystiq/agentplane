# Double KV Read for Token Usage Recording

**Priority:** P2-HIGH
**Category:** performance
**File:** src/lib/config.ts
**Lines:** 180-196
**Blocks:** none

## Description

The `recordTokenUsage` function reads from KV just to increment a counter, even when `checkRateLimit` was just called (which already read the same key). This doubles KV reads for every request that records tokens.

## Current Code

```typescript
export async function recordTokenUsage(
  tenantId: string,
  tokens: number,
  env: Env
): Promise<void> {
  const key = `ratelimit:${tenantId}`;
  const stateData = await env.TENANT_KV.get(key);  // Redundant read

  if (!stateData) return;

  const state: RateLimitState = JSON.parse(stateData);
  state.tokens += tokens;

  await env.TENANT_KV.put(key, JSON.stringify(state), {...});
}
```

## Impact

- 2x KV read operations per request
- Increased latency (~2-5ms per extra read)
- Higher KV billing costs

## Fix

Return state from checkRateLimit and pass it to recordTokenUsage:

```typescript
interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  state: RateLimitState;  // Add this
}

export async function checkRateLimit(
  tenantId: string,
  config: TenantConfig,
  env: Env
): Promise<RateLimitResult> {
  // ... existing logic ...
  return { allowed, remaining, state };
}

export async function recordTokenUsage(
  tenantId: string,
  tokens: number,
  state: RateLimitState,  // Accept state directly
  env: Env
): Promise<void> {
  state.tokens += tokens;
  await env.TENANT_KV.put(
    `ratelimit:${tenantId}`,
    JSON.stringify(state),
    { expirationTtl: 86400 }
  );
}
```

## Alternative

Batch the update into a single atomic operation at request end.
