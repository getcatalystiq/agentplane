/**
 * AgentPlane - Multi-tenant Claude Agent SDK hosting on Cloudflare
 *
 * Main dispatch worker that handles authentication, routing, and agent execution.
 */

import type { Env, TenantConfig } from './lib/types';
import { isValidAgentRequest } from './lib/types';
import { validateRequestAndGetTenant } from './lib/auth';
import { getTenantConfig, checkRateLimit, filterAllowedMcpServers } from './lib/config';
import { loadPluginsForTenant } from './lib/plugins';
import { createSandboxSession, executeAgent, getSandboxSession } from './lib/sandbox';
import { proxyToAIGateway } from './lib/ai-gateway';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Authenticate request
    const authResult = await validateRequestAndGetTenant(request, env);
    if (!authResult.success) {
      return new Response(
        JSON.stringify({ error: authResult.reason }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const tenantId = authResult.tenantId;

    // Load tenant configuration
    const config = await getTenantConfig(tenantId, env);
    if (!config) {
      return new Response(
        JSON.stringify({ error: 'tenant_not_found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check rate limits
    const rateLimit = await checkRateLimit(tenantId, config, env);
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: 'rate_limit_exceeded' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Remaining': '0',
            'Retry-After': '60',
          },
        }
      );
    }

    // Route based on path
    try {
      if (url.pathname === '/agent' || url.pathname === '/agent/run') {
        return await handleAgentRun(request, tenantId, config, env);
      }

      if (url.pathname.startsWith('/agent/session/')) {
        return await handleSessionStatus(url.pathname, tenantId, env);
      }

      if (url.pathname.startsWith('/api/anthropic')) {
        return await proxyToAIGateway(request, config, env);
      }

      return new Response(
        JSON.stringify({ error: 'not_found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error('Request error:', error);
      return new Response(
        JSON.stringify({
          error: 'internal_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },
};

// =============================================================================
// Route Handlers
// =============================================================================

async function handleAgentRun(
  request: Request,
  tenantId: string,
  config: TenantConfig,
  env: Env
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_json' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Validate request body
  if (!isValidAgentRequest(body)) {
    return new Response(
      JSON.stringify({ error: 'invalid_request_body' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const agentRequest = body;

  if (!agentRequest.prompt) {
    return new Response(
      JSON.stringify({ error: 'missing_prompt' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Load plugins for tenant
  const plugins = await loadPluginsForTenant(config.plugins, env);

  // Merge in request-specific MCP servers if allowed
  if (agentRequest.mcpServers) {
    const allowedServers = filterAllowedMcpServers(
      agentRequest.mcpServers,
      config.allowed_mcp_domains || [],
      config.allow_command_mcp_servers || false
    );
    Object.assign(plugins.mcpServers, allowedServers);
  }

  // Create or resume session
  let session;
  if (agentRequest.sessionId) {
    session = await getSandboxSession(agentRequest.sessionId, env);
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'session_not_found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate tenant ownership of session
    if (session.tenantId !== tenantId) {
      return new Response(
        JSON.stringify({ error: 'forbidden' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  } else {
    session = await createSandboxSession(tenantId, config, env);
  }

  // Execute agent
  const result = await executeAgent(session, agentRequest, plugins, config, env);

  return new Response(JSON.stringify(result), {
    status: result.exitCode === 0 ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleSessionStatus(
  pathname: string,
  tenantId: string,
  env: Env
): Promise<Response> {
  const sessionId = pathname.replace('/agent/session/', '');

  const session = await getSandboxSession(sessionId, env);
  if (!session) {
    return new Response(
      JSON.stringify({ error: 'session_not_found' }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Validate tenant ownership of session
  if (session.tenantId !== tenantId) {
    return new Response(
      JSON.stringify({ error: 'forbidden' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  return new Response(
    JSON.stringify({
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
