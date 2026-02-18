import ComposioClient from "@composio/client";
import { logger } from "./logger";

let _client: InstanceType<typeof ComposioClient> | null = null;

function getClient(): InstanceType<typeof ComposioClient> | null {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    logger.warn("COMPOSIO_API_KEY not set");
    return null;
  }
  if (!_client) {
    _client = new ComposioClient({ apiKey });
  }
  return _client;
}

export interface ComposioMcpConfig {
  url: string;
  apiKey: string;
  serverId: string;
  serverName: string;
}

/**
 * Get or create a Composio MCP server for the given toolkits.
 * If existingServerId is provided, retrieves the existing server and generates
 * a user-specific URL instead of creating a new one.
 */
export async function getOrCreateComposioMcpServer(
  userId: string,
  toolkits: string[],
  existingServerId?: string | null,
): Promise<ComposioMcpConfig | null> {
  const client = getClient();
  if (!client) return null;

  try {
    let serverId: string;
    let serverName: string;

    if (existingServerId) {
      // Verify the server still exists
      const server = await client.mcp.retrieve(existingServerId);
      serverId = server.id;
      serverName = server.name;
      logger.info("Composio MCP server retrieved", { user_id: userId, server_id: serverId });
    } else {
      // Create a new MCP server with a stable name derived from the user ID.
      // Using a fixed name (no timestamp suffix) so that if the DB write fails
      // and we retry, we won't keep creating duplicates.
      const name = `ap-${userId.slice(0, 16)}`;
      const server = await client.mcp.create({
        name,
        auth_config_ids: [],
        managed_auth_via_composio: true,
        no_auth_apps: toolkits.map((t) => t.toLowerCase()),
      });
      serverId = server.id;
      serverName = server.name;
      logger.info("Composio MCP server created", {
        user_id: userId,
        toolkits,
        server_id: serverId,
        name: serverName,
      });
    }

    // Generate a user-specific URL for this server
    const urlResponse = await client.mcp.generate.url({
      mcp_server_id: serverId,
      user_ids: [userId],
    });

    const fullUrl = urlResponse.user_ids_url?.[0] || urlResponse.mcp_url;

    // Split the URL into base URL + API key so the key can be stored encrypted.
    // Composio embeds the API key as the `apiKey` query parameter.
    const urlObj = new URL(fullUrl);
    const apiKey = urlObj.searchParams.get("apiKey") ?? "";
    urlObj.searchParams.delete("apiKey");
    const cleanUrl = urlObj.toString();

    logger.info("Composio MCP URL generated", {
      user_id: userId,
      server_id: serverId,
      url: cleanUrl.slice(0, 60) + "...",
    });

    return { url: cleanUrl, apiKey, serverId, serverName };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack?.slice(0, 500) : undefined;
    logger.error("Composio MCP server setup failed", {
      user_id: userId,
      toolkits,
      existing_server_id: existingServerId,
      error: errorMsg,
      stack: errorStack,
    });
    throw new Error(`Composio MCP setup failed: ${errorMsg}`);
  }
}

/**
 * Initiate an OAuth connection for a toolkit via Composio REST API.
 */
export async function initiateOAuthConnection(
  userId: string,
  toolkit: string,
  callbackUrl: string,
): Promise<{ redirectUrl: string; connectionId: string } | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      "https://backend.composio.dev/api/v1/connectedAccounts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          entityId: userId,
          appName: toolkit.toLowerCase(),
          redirectUri: callbackUrl,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      logger.error("Composio OAuth initiation failed", {
        status: response.status,
        body: text.slice(0, 500),
        toolkit,
      });
      return null;
    }

    const data = await response.json();
    return {
      redirectUrl: data.redirectUrl,
      connectionId: data.connectedAccountId,
    };
  } catch (err) {
    logger.error("Composio OAuth initiation error", {
      toolkit,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Check the status of a connected account.
 */
export async function getConnectionStatus(
  connectionId: string,
): Promise<{ status: string; toolkit: string } | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://backend.composio.dev/api/v1/connectedAccounts/${connectionId}`,
      {
        headers: { "x-api-key": apiKey },
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    return {
      status: data.status,
      toolkit: data.appUniqueId,
    };
  } catch {
    return null;
  }
}
