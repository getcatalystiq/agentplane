import { logger } from "./logger";

interface ComposioSession {
  mcp: {
    url: string;
    headers: Record<string, string>;
  };
}

// Composio entity ID convention: ap_{tenantSlug}_{agentId}
export function generateComposioEntityId(
  tenantSlug: string,
  agentId: string,
): string {
  return `ap_${tenantSlug}_${agentId}`;
}

export async function createComposioSession(
  entityId: string,
): Promise<ComposioSession | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    logger.warn("COMPOSIO_API_KEY not set, skipping Composio session creation");
    return null;
  }

  try {
    // Use Composio v3 API directly
    const response = await fetch(
      "https://backend.composio.dev/v3/sessions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          entity_id: entityId,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      logger.error("Composio session creation failed", {
        status: response.status,
        body: text.slice(0, 500),
      });
      return null;
    }

    const data = await response.json();

    logger.info("Composio session created", {
      entity_id: entityId,
      mcp_url: data.mcp?.url?.slice(0, 50) + "...",
    });

    return {
      mcp: {
        url: data.mcp.url,
        headers: data.mcp.headers || {},
      },
    };
  } catch (err) {
    logger.error("Composio session creation error", {
      entity_id: entityId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function initiateOAuthConnection(
  entityId: string,
  toolkit: string,
  callbackUrl: string,
): Promise<{ redirectUrl: string; connectionId: string } | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      "https://backend.composio.dev/v3/connected-accounts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          entity_id: entityId,
          integration_id: toolkit,
          redirect_url: callbackUrl,
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
      redirectUrl: data.redirect_url,
      connectionId: data.id,
    };
  } catch (err) {
    logger.error("Composio OAuth initiation error", {
      toolkit,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function getConnectionStatus(
  connectionId: string,
): Promise<{ status: string; toolkit: string } | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://backend.composio.dev/v3/connected-accounts/${connectionId}`,
      {
        headers: { "x-api-key": apiKey },
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    return {
      status: data.status,
      toolkit: data.integration_id,
    };
  } catch {
    return null;
  }
}
