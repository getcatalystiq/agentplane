# Rate Limit Bypass via Race Condition

**Priority:** P1-CRITICAL
**Category:** security, data-integrity
**File:** src/lib/config.ts
**Lines:** 135-178
**Blocks:** merge

## Description

The `checkRateLimit` function has a TOCTOU (Time-of-Check-Time-of-Use) race condition. Multiple concurrent requests can read the same counter value before any increments are written back, allowing rate limit bypass.

## Current Code

```typescript
const stateData = await env.TENANT_KV.get(key);  // Read
let state = stateData ? JSON.parse(stateData) : {...};

const allowed = state.requests < config.rate_limits.requests_per_minute;

if (allowed) {
  state.requests++;
  await env.TENANT_KV.put(key, JSON.stringify(state));  // Write
}
```

## Impact

Attackers can send many concurrent requests to bypass rate limits. With 60 RPM limit, 100 concurrent requests could all pass before any counter updates.

## Fix Options

### Option A: Use Durable Objects (Recommended)

Durable Objects provide single-threaded execution guarantees:

```typescript
export class RateLimiter {
  private state: DurableObjectState;
  private requests = 0;
  private windowStart = 0;

  async fetch(request: Request): Promise<Response> {
    const now = Date.now();
    if (now - this.windowStart > 60000) {
      this.requests = 0;
      this.windowStart = now;
    }

    if (this.requests >= this.limit) {
      return new Response('Rate limited', { status: 429 });
    }

    this.requests++;
    return new Response('OK');
  }
}
```

### Option B: Atomic Counter Pattern

Use a separate atomic counter with optimistic locking:

```typescript
async function atomicIncrement(key: string, env: Env): Promise<number> {
  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    const current = await env.TENANT_KV.get(key);
    const value = current ? parseInt(current, 10) : 0;
    const newValue = value + 1;

    // Use conditional put with metadata version
    try {
      await env.TENANT_KV.put(key, String(newValue), {
        metadata: { version: newValue }
      });
      return newValue;
    } catch {
      // Retry on conflict
      continue;
    }
  }
  throw new Error('Failed to increment counter');
}
```

## References

- Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/
- TOCTOU vulnerabilities: https://cwe.mitre.org/data/definitions/367.html
