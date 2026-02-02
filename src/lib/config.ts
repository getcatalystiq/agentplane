/**
 * Tenant configuration loading and validation
 */

import type { Env, TenantConfig, MCPServerConfig } from './types';
import { log } from './logging';

// =============================================================================
// Tenant Configuration
// =============================================================================

export async function getTenantConfig(
  tenantId: string,
  env: Env
): Promise<TenantConfig | null> {
  const data = await env.TENANT_KV.get(tenantId);

  if (!data) return null;

  try {
    const config = JSON.parse(data) as TenantConfig;
    return validateTenantConfig(config);
  } catch (error) {
    log.warn('Failed to parse tenant config', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function setTenantConfig(
  tenantId: string,
  config: TenantConfig,
  env: Env
): Promise<void> {
  const validated = validateTenantConfig(config);
  await env.TENANT_KV.put(tenantId, JSON.stringify(validated));
}

export async function deleteTenantConfig(
  tenantId: string,
  env: Env
): Promise<void> {
  // Cascading delete: remove tenant config, tokens, secrets, and rate limit state
  await Promise.all([
    env.TENANT_KV.delete(tenantId),
    env.TENANT_KV.delete(`ratelimit:${tenantId}`),
    deleteAllTenantTokens(tenantId, env),
    deleteAllTenantSecrets(tenantId, env),
  ]);
}

async function deleteAllTenantTokens(tenantId: string, env: Env): Promise<void> {
  const list = await env.TENANT_TOKENS.list();
  const deletePromises: Promise<void>[] = [];

  for (const key of list.keys) {
    const mappedTenant = await env.TENANT_TOKENS.get(key.name);
    if (mappedTenant === tenantId) {
      deletePromises.push(env.TENANT_TOKENS.delete(key.name));
    }
  }

  await Promise.all(deletePromises);
}

async function deleteAllTenantSecrets(tenantId: string, env: Env): Promise<void> {
  const list = await env.SECRETS_KV.list({ prefix: `${tenantId}:` });
  await Promise.all(list.keys.map((key) => env.SECRETS_KV.delete(key.name)));
}

// =============================================================================
// MCP Domain Validation
// =============================================================================

// Allowed MCP commands (whitelist of safe commands)
const ALLOWED_MCP_COMMANDS = new Set([
  'npx',
  'node',
  'python',
  'python3',
  'uvx',
]);

export function validateMcpDomain(
  serverConfig: MCPServerConfig,
  allowedDomains: string[],
  allowCommandServers = false
): boolean {
  // Command-based servers require explicit opt-in
  if (!serverConfig.url) {
    if (!allowCommandServers) {
      return false;
    }
    // Validate command is in allowlist
    if (serverConfig.command) {
      const baseCommand = serverConfig.command.split(/\s+/)[0];
      return ALLOWED_MCP_COMMANDS.has(baseCommand);
    }
    return false;
  }

  try {
    const url = new URL(serverConfig.url);
    const hostname = url.hostname;

    return allowedDomains.some((domain) => {
      if (domain.startsWith('*.')) {
        // Wildcard domain matching
        const baseDomain = domain.slice(2);
        return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);
      }
      return hostname === domain;
    });
  } catch {
    return false;
  }
}

export function filterAllowedMcpServers(
  servers: Record<string, MCPServerConfig>,
  allowedDomains: string[],
  allowCommandServers = false
): Record<string, MCPServerConfig> {
  const filtered: Record<string, MCPServerConfig> = {};

  for (const [name, config] of Object.entries(servers)) {
    // URL-based servers
    if (config.url) {
      // Empty allowlist means allow all URL-based servers
      if (allowedDomains.length === 0) {
        filtered[name] = config;
      } else if (validateMcpDomain(config, allowedDomains, false)) {
        filtered[name] = config;
      }
    }
    // Command-based servers
    else if (config.command && allowCommandServers) {
      if (validateMcpDomain(config, allowedDomains, true)) {
        filtered[name] = config;
      }
    }
  }

  return filtered;
}

// =============================================================================
// Validation
// =============================================================================

function validateTenantConfig(config: TenantConfig): TenantConfig {
  // Ensure required fields exist with defaults
  return {
    tenant: {
      id: config.tenant.id,
      name: config.tenant.name,
      created_at: config.tenant.created_at || new Date().toISOString(),
    },
    zero_trust: config.zero_trust,
    resources: {
      sandbox: {
        sleep_after: config.resources?.sandbox?.sleep_after || '5m',
        max_concurrent_sessions:
          config.resources?.sandbox?.max_concurrent_sessions || 5,
      },
      storage: {
        bucket_prefix: config.resources?.storage?.bucket_prefix || config.tenant.id,
        quota_gb: config.resources?.storage?.quota_gb || 10,
      },
    },
    plugins: config.plugins || [],
    allowed_mcp_domains: config.allowed_mcp_domains || [],
    allow_command_mcp_servers: config.allow_command_mcp_servers || false,
    ai: config.ai || { provider: 'anthropic' },
    rate_limits: {
      requests_per_minute: config.rate_limits?.requests_per_minute || 60,
      tokens_per_day: config.rate_limits?.tokens_per_day || 1000000,
    },
  };
}

// =============================================================================
// Rate Limiting (with optimistic concurrency control)
// =============================================================================

interface RateLimitState {
  requests: number;
  tokens: number;
  window_start: number;
  day_start: number;
  version: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  state: RateLimitState;
}

export async function checkRateLimit(
  tenantId: string,
  config: TenantConfig,
  env: Env
): Promise<RateLimitResult> {
  const key = `ratelimit:${tenantId}`;
  const now = Date.now();
  const minuteWindow = 60 * 1000;
  const dayWindow = 24 * 60 * 60 * 1000;
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const stateData = await env.TENANT_KV.get(key);
    let state: RateLimitState = stateData
      ? JSON.parse(stateData)
      : { requests: 0, tokens: 0, window_start: now, day_start: now, version: 0 };

    const originalVersion = state.version;

    // Reset minute window if expired
    if (now - state.window_start > minuteWindow) {
      state.requests = 0;
      state.window_start = now;
    }

    // Reset day window if expired
    if (now - state.day_start > dayWindow) {
      state.tokens = 0;
      state.day_start = now;
    }

    const allowed = state.requests < config.rate_limits.requests_per_minute;

    if (allowed) {
      state.requests++;
      state.version++;

      // Optimistic write with version check
      const success = await tryUpdateRateLimitState(key, state, originalVersion, env);
      if (success) {
        const remaining = Math.max(
          0,
          config.rate_limits.requests_per_minute - state.requests
        );
        return { allowed: true, remaining, state };
      }
      // Retry on conflict
      continue;
    }

    // Rate limited - no need to update state
    return { allowed: false, remaining: 0, state };
  }

  // After max retries, fail closed (deny the request)
  log.warn('Rate limit check failed after max retries', { tenantId });
  return {
    allowed: false,
    remaining: 0,
    state: { requests: 0, tokens: 0, window_start: now, day_start: now, version: 0 },
  };
}

async function tryUpdateRateLimitState(
  key: string,
  state: RateLimitState,
  expectedVersion: number,
  env: Env
): Promise<boolean> {
  // Read current state to check version
  const currentData = await env.TENANT_KV.get(key);
  if (currentData) {
    const current = JSON.parse(currentData) as RateLimitState;
    if (current.version !== expectedVersion) {
      return false; // Conflict detected
    }
  }

  await env.TENANT_KV.put(key, JSON.stringify(state), {
    expirationTtl: 86400, // 1 day TTL
  });
  return true;
}

export async function recordTokenUsage(
  tenantId: string,
  tokens: number,
  state: RateLimitState,
  env: Env
): Promise<void> {
  const key = `ratelimit:${tenantId}`;

  state.tokens += tokens;
  state.version++;

  await env.TENANT_KV.put(key, JSON.stringify(state), {
    expirationTtl: 86400,
  });
}
