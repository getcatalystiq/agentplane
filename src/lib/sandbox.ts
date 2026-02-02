/**
 * Sandbox lifecycle management for isolated agent execution
 *
 * This module interfaces with the Cloudflare Container runtime
 * to spawn isolated containers for each agent session.
 */

import type { Env, TenantConfig, AgentRequest, AgentResult, PluginBundle } from './types';

// =============================================================================
// Sandbox Session Management
// =============================================================================

export interface SandboxSession {
  id: string;
  tenantId: string;
  createdAt: number;
  status: 'running' | 'sleeping' | 'terminated';
}

export async function createSandboxSession(
  tenantId: string,
  config: TenantConfig,
  env: Env
): Promise<SandboxSession> {
  const sessionId = generateSessionId();

  const session: SandboxSession = {
    id: sessionId,
    tenantId,
    createdAt: Date.now(),
    status: 'running',
  };

  // Store session state with tenant-specific key prefix for easier cleanup
  await env.TENANT_KV.put(
    `session:${sessionId}`,
    JSON.stringify(session),
    { expirationTtl: parseDuration(config.resources.sandbox.sleep_after) || 3600 }
  );

  return session;
}

export async function getSandboxSession(
  sessionId: string,
  env: Env
): Promise<SandboxSession | null> {
  const data = await env.TENANT_KV.get(`session:${sessionId}`);
  if (!data) return null;

  try {
    return JSON.parse(data) as SandboxSession;
  } catch {
    return null;
  }
}

export async function terminateSandboxSession(
  sessionId: string,
  env: Env
): Promise<void> {
  const session = await getSandboxSession(sessionId, env);
  if (!session) return;

  session.status = 'terminated';
  await env.TENANT_KV.put(`session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: 300, // Keep for 5 min after termination
  });
}

// =============================================================================
// Agent Execution
// =============================================================================

export async function executeAgent(
  session: SandboxSession,
  request: AgentRequest,
  plugins: PluginBundle,
  config: TenantConfig,
  env: Env
): Promise<AgentResult> {
  // Build the agent execution environment
  const agentEnv = buildAgentEnvironment(plugins, config);

  // Execute via Cloudflare Container/Sandbox
  try {
    const result = await runInSandbox(session, request, agentEnv, env);
    return result;
  } catch (error) {
    return {
      output: '',
      exitCode: 1,
      sessionId: session.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

interface AgentEnvironment {
  skills: string;
  commands: string;
  mcpServers: string;
  bedrockRegion?: string;
  bedrockModel?: string;
}

function buildAgentEnvironment(
  plugins: PluginBundle,
  config: TenantConfig
): AgentEnvironment {
  // Serialize plugin content for injection into the sandbox
  const skillsContent = plugins.skills
    .map((s) => `# ${s.name}\n${s.content}`)
    .join('\n\n---\n\n');

  const commandsContent = plugins.commands
    .map((c) => `# ${c.name}\n${c.content}`)
    .join('\n\n---\n\n');

  const mcpServersJson = JSON.stringify(plugins.mcpServers);

  const agentEnv: AgentEnvironment = {
    skills: skillsContent,
    commands: commandsContent,
    mcpServers: mcpServersJson,
  };

  // Add AI provider configuration
  if (config.ai?.provider === 'bedrock') {
    agentEnv.bedrockRegion = config.ai.bedrock_region;
    agentEnv.bedrockModel = config.ai.bedrock_model;
  }

  return agentEnv;
}

async function runInSandbox(
  session: SandboxSession,
  request: AgentRequest,
  agentEnv: AgentEnvironment,
  env: Env
): Promise<AgentResult> {
  // This is where the Cloudflare Sandbox SDK would be used
  // For now, we simulate the expected behavior

  // In production, this would:
  // 1. Spawn a container with the Claude Agent SDK
  // 2. Inject the skills, commands, and MCP servers
  // 3. Execute the agent with the prompt
  // 4. Stream or return the result

  // Check if Sandbox SDK is available
  const sandboxAvailable = 'Sandbox' in env;

  if (!sandboxAvailable) {
    // Return a simulated response for development
    return {
      output: `[Sandbox not available] Would execute: ${request.prompt}`,
      exitCode: 0,
      sessionId: session.id,
    };
  }

  // When Sandbox SDK is available:
  // const sandbox = env.Sandbox as SandboxBinding;
  // const container = await sandbox.spawn({
  //   image: 'registry.cloudflare.com/agentplane/agent:latest',
  //   env: {
  //     AGENT_SKILLS: agentEnv.skills,
  //     AGENT_COMMANDS: agentEnv.commands,
  //     MCP_SERVERS: agentEnv.mcpServers,
  //     ...
  //   }
  // });
  // const result = await container.exec(['claude', '--prompt', request.prompt]);
  // return { output: result.stdout, exitCode: result.exitCode, sessionId: session.id };

  // Suppress unused variable warnings for now
  void agentEnv;

  return {
    output: `[Sandbox placeholder] Prompt: ${request.prompt}`,
    exitCode: 0,
    sessionId: session.id,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    default:
      return null;
  }
}
