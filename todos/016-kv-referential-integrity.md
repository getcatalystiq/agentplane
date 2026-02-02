# No Referential Integrity Between KV Namespaces

**Priority:** P3-MEDIUM
**Category:** data-integrity
**Files:** Multiple
**Blocks:** none

## Description

The system uses 3 separate KV namespaces (TENANT_KV, TENANT_TOKENS, SECRETS_KV) with no referential integrity enforcement. Orphaned records can accumulate.

## Current Architecture

```
TENANT_KV: {tenantId} -> TenantConfig
TENANT_TOKENS: {serviceTokenId} -> tenantId
SECRETS_KV: {tenantId}:{secretName} -> encrypted secret
```

## Integrity Risks

1. **Orphaned tokens**: Delete tenant but tokens still map to it
2. **Orphaned secrets**: Delete tenant but secrets remain encrypted
3. **Dangling references**: Token points to non-existent tenant

## Impact

- Storage waste from orphaned data
- Potential security issue if tenant ID is reused
- Confusion during debugging

## Fix Options

### Option A: Cascading Deletes

```typescript
export async function deleteTenant(tenantId: string, env: Env): Promise<void> {
  // 1. Delete tenant config
  await env.TENANT_KV.delete(tenantId);

  // 2. Find and delete all tokens for this tenant
  const tokenList = await env.TENANT_TOKENS.list();
  for (const key of tokenList.keys) {
    const mappedTenant = await env.TENANT_TOKENS.get(key.name);
    if (mappedTenant === tenantId) {
      await env.TENANT_TOKENS.delete(key.name);
    }
  }

  // 3. Delete all secrets with tenant prefix
  const secretList = await env.SECRETS_KV.list({ prefix: `${tenantId}:` });
  for (const key of secretList.keys) {
    await env.SECRETS_KV.delete(key.name);
  }
}
```

### Option B: Composite Keys

Use tenant ID as prefix for all related data:

```
TENANT_KV:
  tenant:{tenantId} -> TenantConfig
  tenant:{tenantId}:tokens:{tokenId} -> tokenData
  tenant:{tenantId}:secrets:{name} -> encrypted secret
```

This makes cascading deletes trivial: `list({ prefix: 'tenant:{id}:' })` + delete all.

## Recommendation

Option B (composite keys) is cleaner but requires migration. For MVP, implement Option A with cascading deletes.
