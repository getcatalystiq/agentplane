import { createComposioMcpUrl } from "./composio";
import { logger } from "./logger";

export interface McpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export async function buildMcpConfig(
  agent: { id: string; composio_toolkits: string[] },
  tenantId: string,
): Promise<Record<string, McpServerConfig>> {
  const servers: Record<string, McpServerConfig> = {};

  // Add Composio MCP server if agent has toolkits configured
  if (agent.composio_toolkits.length > 0) {
    const mcpConfig = await createComposioMcpUrl(tenantId, agent.composio_toolkits);
    if (mcpConfig) {
      servers.composio = {
        type: "http",
        url: mcpConfig.url,
      };
    } else {
      logger.warn("Failed to create Composio MCP URL, agent will run without Composio tools", {
        agent_id: agent.id,
        user_id: tenantId,
      });
    }
  }

  return servers;
}
