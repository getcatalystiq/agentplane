# Command Injection in Provisioning Script

**Priority:** P1-CRITICAL
**Category:** security
**File:** scripts/provision-tenant.ts
**Lines:** 133-136
**Blocks:** merge

## Description

The provisioning script uses shell string interpolation without sanitization, allowing command injection via malicious tenant names or config values.

## Current Code

```typescript
execSync(`wrangler kv:key put --binding=TENANT_KV "${tenantId}" '${JSON.stringify(config)}'`);
```

## Impact

An attacker who can control tenant provisioning input could execute arbitrary shell commands on the deployment machine.

## Fix

Use child_process spawn with array arguments instead of shell interpolation:

```typescript
import { spawnSync } from 'child_process';

spawnSync('wrangler', [
  'kv:key', 'put',
  '--binding=TENANT_KV',
  tenantId,
  JSON.stringify(config)
], { stdio: 'inherit' });
```

## References

- OWASP Command Injection: https://owasp.org/www-community/attacks/Command_Injection
