# Unsafe Type Assertions Without Validation

**Priority:** P2-HIGH
**Category:** type-safety
**Files:** Multiple
**Blocks:** none

## Description

Multiple locations use `as` type assertions or non-null assertions without runtime validation, which can lead to runtime errors if the data doesn't match expectations.

## Locations

### 1. src/index.ts:126
```typescript
const body = await request.json() as AgentRequest;  // Unsafe
```

### 2. src/lib/credentials.ts:196
```typescript
const key = await crypto.subtle.importKey(...);
return key!;  // Non-null assertion
```

### 3. src/lib/config.ts:20
```typescript
const config = JSON.parse(data) as TenantConfig;  // Unsafe
```

### 4. src/lib/plugins.ts:94
```typescript
return JSON.parse(text) as ExtractedPlugin;  // Unsafe
```

## Impact

- Runtime crashes on malformed data
- Security issues if attackers can control parsed data
- Difficult to debug production issues

## Fix

Add runtime validation using Zod or manual checks:

### With Zod

```typescript
import { z } from 'zod';

const AgentRequestSchema = z.object({
  action: z.enum(['start', 'stop', 'message']),
  sessionId: z.string().optional(),
  message: z.string().optional(),
});

type AgentRequest = z.infer<typeof AgentRequestSchema>;

// Usage
const body = await request.json();
const parsed = AgentRequestSchema.safeParse(body);
if (!parsed.success) {
  return new Response('Invalid request body', { status: 400 });
}
const request: AgentRequest = parsed.data;
```

### Manual validation

```typescript
function isAgentRequest(obj: unknown): obj is AgentRequest {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'action' in obj &&
    typeof (obj as Record<string, unknown>).action === 'string'
  );
}

const body = await request.json();
if (!isAgentRequest(body)) {
  return new Response('Invalid request body', { status: 400 });
}
```

## Recommendation

Add Zod as a dependency and create schemas for all external data boundaries.
