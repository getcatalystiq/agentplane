# Race Condition in OAuth Token Refresh

**Priority:** P2-HIGH
**Category:** security, data-integrity
**File:** src/lib/credentials.ts
**Lines:** 67-90
**Blocks:** none

## Description

The OAuth token refresh logic has a TOCTOU race condition. Multiple concurrent requests can detect expired tokens simultaneously and all attempt to refresh, potentially invalidating each other's tokens.

## Current Code

```typescript
if (isExpired(credential.expires_at)) {
  const refreshed = await refreshOAuthToken(credential);  // Race!
  await storeCredential(tenantId, name, refreshed, env);
  return refreshed;
}
```

## Impact

- Multiple refresh attempts may conflict
- Some requests may get invalid/old tokens
- Excessive token refresh API calls
- Potential token invalidation

## Fix

Use a locking pattern with Durable Objects or atomic operations:

```typescript
async function getCredentialWithRefresh(
  tenantId: string,
  name: string,
  env: Env
): Promise<Credential | null> {
  const lockKey = `lock:oauth:${tenantId}:${name}`;
  const credential = await getStoredCredential(tenantId, name, env);

  if (!credential) return null;
  if (!isExpired(credential.expires_at)) return credential;

  // Try to acquire refresh lock
  const lockAcquired = await tryAcquireLock(lockKey, env, 30);
  if (!lockAcquired) {
    // Another process is refreshing, wait and retry
    await sleep(100);
    return getCredentialWithRefresh(tenantId, name, env);
  }

  try {
    // Re-check after acquiring lock (double-check pattern)
    const current = await getStoredCredential(tenantId, name, env);
    if (current && !isExpired(current.expires_at)) {
      return current;  // Already refreshed by another process
    }

    const refreshed = await refreshOAuthToken(credential);
    await storeCredential(tenantId, name, refreshed, env);
    return refreshed;
  } finally {
    await releaseLock(lockKey, env);
  }
}
```

## References

- Double-checked locking: https://en.wikipedia.org/wiki/Double-checked_locking
