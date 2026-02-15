import { createComposioSession, generateComposioEntityId } from "./composio";
import { logger } from "./logger";
import type { Agent } from "./types";

export interface McpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export async function buildMcpConfig(
  agent: Agent,
  tenantSlug: string,
): Promise<Record<string, McpServerConfig>> {
  const servers: Record<string, McpServerConfig> = {};

  // Add Composio MCP server if agent has toolkits configured
  if (agent.composio_toolkits.length > 0) {
    const entityId =
      agent.composio_entity_id ||
      generateComposioEntityId(tenantSlug, agent.id);

    const session = await createComposioSession(entityId);
    if (session) {
      servers.composio = {
        type: "http",
        url: session.mcp.url,
        headers: session.mcp.headers,
      };
    } else {
      logger.warn("Failed to create Composio session, agent will run without Composio tools", {
        agent_id: agent.id,
        entity_id: entityId,
      });
    }
  }

  return servers;
}
