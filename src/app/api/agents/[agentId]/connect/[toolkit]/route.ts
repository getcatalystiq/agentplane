import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/auth";
import { withErrorHandler, jsonResponse } from "@/lib/api";
import { queryOne } from "@/db";
import { AgentRow } from "@/lib/validation";
import { NotFoundError } from "@/lib/errors";
import { initiateOAuthConnection, generateComposioEntityId } from "@/lib/composio";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (request: NextRequest, context) => {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  const { agentId, toolkit } = await context!.params;

  const agent = await queryOne(
    AgentRow,
    "SELECT * FROM agents WHERE id = $1 AND tenant_id = $2",
    [agentId, auth.tenantId],
  );
  if (!agent) throw new NotFoundError("Agent not found");

  const entityId =
    agent.composio_entity_id ||
    generateComposioEntityId("tenant", agentId);

  const callbackUrl = new URL(
    `/api/agents/${agentId}/connect/callback`,
    request.url,
  ).toString();

  const connection = await initiateOAuthConnection(
    entityId,
    toolkit,
    callbackUrl,
  );

  if (!connection) {
    return jsonResponse(
      { error: { code: "composio_error", message: "Failed to initiate OAuth connection" } },
      502,
    );
  }

  logger.info("OAuth connection initiated", {
    agent_id: agentId,
    toolkit,
    connection_id: connection.connectionId,
  });

  return NextResponse.redirect(connection.redirectUrl);
});
