# MCP Domain Allowlist Bypass for Command-Based Servers

**Priority:** P2-HIGH
**Category:** security
**File:** src/lib/config.ts
**Lines:** 47-51
**Blocks:** none

## Description

Command-based MCP servers bypass the domain allowlist entirely. This allows tenants to execute arbitrary local commands through the MCP interface.

## Current Code

```typescript
export function validateMcpDomain(
  serverConfig: MCPServerConfig,
  allowedDomains: string[]
): boolean {
  if (!serverConfig.url) return true; // Command-based servers always allowed
  // ...
}
```

## Impact

- Tenants can register local command MCP servers
- Could execute arbitrary commands within the sandbox
- Bypasses intended security controls

## Fix Options

### Option A: Separate allowlist for commands

```typescript
interface MCPAllowlist {
  domains: string[];
  commands: string[];  // e.g., ['npx', 'node']
}

export function validateMcpServer(
  serverConfig: MCPServerConfig,
  allowlist: MCPAllowlist
): boolean {
  if (serverConfig.url) {
    return validateDomain(serverConfig.url, allowlist.domains);
  }

  if (serverConfig.command) {
    const baseCommand = serverConfig.command.split(' ')[0];
    return allowlist.commands.includes(baseCommand);
  }

  return false;
}
```

### Option B: Disable command-based servers in multi-tenant

```typescript
export function validateMcpDomain(
  serverConfig: MCPServerConfig,
  allowedDomains: string[],
  allowCommandServers = false
): boolean {
  if (!serverConfig.url) {
    return allowCommandServers;  // Explicit opt-in
  }
  // ...
}
```

## Recommendation

Use Option A with a curated allowlist of safe MCP server commands.
