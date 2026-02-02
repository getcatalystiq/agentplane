# Insecure Tenant ID Derivation from Email Domain

**Priority:** P2-HIGH
**Category:** security
**File:** src/lib/auth.ts
**Lines:** 89-94
**Blocks:** none

## Description

For browser-based auth (cookies), tenant ID is derived from the email domain in the JWT. This allows anyone with an email from `@example.com` to access `example.com` tenant's resources.

## Current Code

```typescript
if (payload.custom?.tenant_id) {
  return { success: true, tenantId: payload.custom.tenant_id };
}

// Fallback: derive from email domain
const email = payload.email as string;
const domain = email.split('@')[1];
return { success: true, tenantId: domain };
```

## Impact

- Users from the same email domain share tenant access
- No explicit tenant assignment required
- Could leak data between organizations using shared email providers

## Fix

Remove email domain fallback. Require explicit tenant assignment:

```typescript
// Require explicit tenant_id claim
if (!payload.custom?.tenant_id) {
  return { success: false, reason: 'missing_tenant_claim' };
}

return { success: true, tenantId: payload.custom.tenant_id };
```

## Additional Changes

1. Update Cloudflare Access policies to include `tenant_id` in custom claims
2. Add tenant enrollment workflow for new users
3. Document required JWT claim structure
