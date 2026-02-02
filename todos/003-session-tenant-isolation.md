# Missing Tenant Isolation in Session Access

**Priority:** P1-CRITICAL
**Category:** security
**File:** src/index.ts
**Lines:** 160-173
**Blocks:** merge

## Description

Session retrieval does not validate that the requesting tenant owns the session. A tenant could potentially access another tenant's sessions by guessing session IDs.

## Current Code

```typescript
const session = await getSession(sessionId, env);
if (!session) {
  return new Response('Session not found', { status: 404 });
}
```

## Impact

Cross-tenant data leakage. One tenant could read, modify, or delete another tenant's agent sessions.

## Fix

Add tenant ownership validation:

```typescript
const session = await getSession(sessionId, env);
if (!session) {
  return new Response('Session not found', { status: 404 });
}

// Validate tenant ownership
if (session.tenantId !== authResult.tenantId) {
  return new Response('Forbidden', { status: 403 });
}
```

## Additional Changes

1. Ensure session objects store `tenantId`
2. Add integration tests for cross-tenant access attempts
3. Consider prefixing session IDs with tenant ID: `{tenantId}:{sessionId}`
