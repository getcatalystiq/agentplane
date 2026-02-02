/**
 * Core type definitions for AgentPlane
 */

// =============================================================================
// Cloudflare Bindings
// =============================================================================

export interface Env {
  // KV Namespaces
  TENANT_KV: KVNamespace;
  TENANT_TOKENS: KVNamespace;
  SECRETS_KV: KVNamespace;

  // R2 Buckets
  PLUGIN_CACHE: R2Bucket;
  TENANT_STORAGE: R2Bucket;

  // Sandbox SDK (when available)
  // Sandbox: unknown;

  // Environment variables
  CF_TEAM_DOMAIN: string;
  CF_POLICY_AUD: string;
  CF_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  ENCRYPTION_KEY: string;
  ENVIRONMENT: 'development' | 'staging' | 'production';

  // OAuth provider credentials (dynamic keys)
  [key: `${Uppercase<string>}_CLIENT_ID`]: string | undefined;
  [key: `${Uppercase<string>}_CLIENT_SECRET`]: string | undefined;
}

// =============================================================================
// Authentication
// =============================================================================

export type AuthResult =
  | { success: true; tenantId: string }
  | { success: false; reason: AuthFailureReason };

export type AuthFailureReason =
  | 'missing_token'
  | 'invalid_token'
  | 'expired'
  | 'unknown_service_token'
  | 'validation_error';

export interface AccessJWTPayload {
  email?: string;
  sub: string; // Service token client_id
  aud: string[];
  iat: number;
  exp: number;
  iss: string;
  common_name?: string;
  service_token_id?: string;
  custom?: {
    tenant_id?: string;
  };
}

// =============================================================================
// Agent Requests/Responses
// =============================================================================

export interface AgentRequest {
  prompt: string;
  sessionId?: string;
  skills?: string[];
  mcpServers?: Record<string, MCPServerConfig>;
}

export interface AgentResult {
  output: string;
  exitCode: number;
  sessionId?: string;
  error?: string;
}

// =============================================================================
// Request Validation
// =============================================================================

export function isValidAgentRequest(value: unknown): value is AgentRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.prompt !== 'string') {
    return false;
  }

  if (obj.sessionId !== undefined && typeof obj.sessionId !== 'string') {
    return false;
  }

  if (obj.skills !== undefined) {
    if (!Array.isArray(obj.skills) || !obj.skills.every((s) => typeof s === 'string')) {
      return false;
    }
  }

  if (obj.mcpServers !== undefined && typeof obj.mcpServers !== 'object') {
    return false;
  }

  return true;
}

// =============================================================================
// Tenant Configuration
// =============================================================================

export interface TenantConfig {
  tenant: {
    id: string;
    name: string;
    created_at: string;
  };
  zero_trust?: {
    service_tokens: Array<{
      client_id: string;
      name: string;
      permissions: string[];
    }>;
    require_mtls?: boolean;
  };
  resources: {
    sandbox: {
      sleep_after: string;
      max_concurrent_sessions: number;
    };
    storage: {
      bucket_prefix: string;
      quota_gb: number;
    };
  };
  plugins: PluginSource[];
  allowed_mcp_domains?: string[];
  allow_command_mcp_servers?: boolean;
  ai?: {
    provider: AIProvider;
    bedrock_region?: string;
    bedrock_model?: string;
  };
  rate_limits: {
    requests_per_minute: number;
    tokens_per_day: number;
  };
}

// =============================================================================
// Plugins
// =============================================================================

export interface PluginSource {
  repo: string;
  path?: string;
  ref?: string;
  github_token?: string;
  env?: Record<string, string>;
}

export interface ExtractedPlugin {
  name: string;
  skills: Array<{ name: string; content: string }>;
  commands: Array<{ name: string; content: string }>;
  mcpServers: Record<string, MCPServerConfig>;
}

export interface PluginBundle {
  skills: Array<{ name: string; content: string }>;
  commands: Array<{ name: string; content: string }>;
  mcpServers: Record<string, MCPServerConfig>;
}

export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
}

// =============================================================================
// MCP Server
// =============================================================================

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

// =============================================================================
// Credentials
// =============================================================================

export interface OAuthCredential {
  access_token: string;
  refresh_token: string | null;
  expires_at: number;
  token_type: string;
  scopes: string[];
}

export interface OAuthProviderConfig {
  tokenUrl: string;
  authUrl?: string;
  scopes?: string[];
}

// =============================================================================
// AI Gateway
// =============================================================================

export type AIProvider = 'anthropic' | 'bedrock';

export interface AIGatewayConfig {
  accountId: string;
  gatewayId: string;
  provider: AIProvider;
}
