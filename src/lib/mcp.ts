import { getOrCreateComposioMcpServer } from "./composio";
import { encrypt, decrypt } from "./crypto";
import { getEnv } from "./env";
import { execute } from "@/db";
import { logger } from "./logger";
import type { AgentInternal } from "./validation";

export interface McpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface McpBuildResult {
  servers: Record<string, McpServerConfig>;
  errors: string[];
}

export async function buildMcpConfig(
  agent: AgentInternal,
  tenantId: string,
): Promise<McpBuildResult> {
  const servers: Record<string, McpServerConfig> = {};
  const errors: string[] = [];

  if (agent.composio_toolkits.length === 0) {
    return { servers, errors };
  }

  try {
    const env = getEnv();
    let mcpUrl: string;
    let mcpApiKey: string;

    if (agent.composio_mcp_url && agent.composio_mcp_api_key_enc) {
      // Use fully cached URL + key
      mcpUrl = agent.composio_mcp_url;
      if (env.ENCRYPTION_KEY) {
        const encData = JSON.parse(agent.composio_mcp_api_key_enc);
        mcpApiKey = await decrypt(encData, env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS);
      } else {
        mcpApiKey = "";
      }
    } else {
      // Create or retrieve the Composio MCP server, then generate a URL.
      // Passing existingServerId avoids creating a duplicate server if we already
      // have one stored (but the URL/key wasn't cached yet).
      const mcpConfig = await getOrCreateComposioMcpServer(
        tenantId,
        agent.composio_toolkits,
        agent.composio_mcp_server_id,
      );
      if (!mcpConfig) return { servers, errors };

      mcpUrl = mcpConfig.url;
      mcpApiKey = mcpConfig.apiKey;

      // Persist server info and (if possible) the cached URL + encrypted key
      if (env.ENCRYPTION_KEY) {
        const encData = await encrypt(mcpApiKey, env.ENCRYPTION_KEY);
        await execute(
          `UPDATE agents
           SET composio_mcp_server_id   = $1,
               composio_mcp_server_name = $2,
               composio_mcp_url         = $3,
               composio_mcp_api_key_enc = $4
           WHERE id = $5`,
          [
            mcpConfig.serverId,
            mcpConfig.serverName,
            mcpUrl,
            JSON.stringify(encData),
            agent.id,
          ],
        );
      } else {
        // Still persist the non-sensitive server info even without encryption
        await execute(
          `UPDATE agents
           SET composio_mcp_server_id   = $1,
               composio_mcp_server_name = $2
           WHERE id = $3`,
          [mcpConfig.serverId, mcpConfig.serverName, agent.id],
        );
        logger.warn(
          "ENCRYPTION_KEY not set — Composio MCP API key will not be cached",
          { agent_id: agent.id },
        );
      }
    }

    // Reconstruct the full URL with the API key as a query parameter
    const finalUrl = mcpApiKey
      ? `${mcpUrl}${mcpUrl.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(mcpApiKey)}`
      : mcpUrl;

    servers.composio = { type: "http", url: finalUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    logger.warn(
      "Failed to build Composio MCP config, agent will run without Composio tools",
      { agent_id: agent.id, user_id: tenantId, error: msg },
    );
  }

  return { servers, errors };
}
