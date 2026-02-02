# Dead Code and YAGNI Violations

**Priority:** P3-MEDIUM
**Category:** simplicity
**Files:** Multiple
**Blocks:** none

## Description

Approximately 107 lines of unnecessary code identified across the codebase, including unused parameters, redundant checks, and over-abstraction.

## Items to Remove

### 1. Unused Parameters in Sandbox (src/lib/sandbox.ts)
```typescript
// Current
async function createSandbox(
  config: TenantConfig,    // Unused
  agentEnv: Record<string, string>,  // Unused
  env: Env
): Promise<SandboxSession>

// Fixed
async function createSandbox(env: Env): Promise<SandboxSession>
```

### 2. Redundant Expiration Check (src/lib/auth.ts:47-49)
```typescript
// jose.jwtVerify already validates expiration - this is redundant
if (payload.exp && Date.now() > payload.exp * 1000) {
  return { success: false, reason: 'expired' };
}
```
Remove this block.

### 3. Duplicate CacheMetadata Interface (src/lib/plugins.ts:18-21)
```typescript
// This duplicates R2ObjectMetadata structure
interface CacheMetadata {
  extracted_at: string;
  expires_at?: string;
}
```
Use R2's built-in metadata typing instead.

### 4. Over-abstracted AI Gateway Transforms
The request/response transform functions in ai-gateway.ts are overly generic. Simplify to direct implementations.

### 5. Unused Exports
Check for and remove any exports not used elsewhere:
```bash
# Find unused exports
grep -rn "export " src/lib/*.ts | while read line; do
  # Check if exported symbol is imported elsewhere
done
```

## Code Reduction Target

Remove ~107 lines (12% of codebase) while maintaining functionality.

## Approach

1. Remove unused function parameters
2. Delete redundant validation (already handled by dependencies)
3. Inline single-use abstractions
4. Remove placeholder implementations that just throw "not implemented"
