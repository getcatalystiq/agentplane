import { NextRequest } from "next/server";
import { withErrorHandler, jsonResponse } from "@/lib/api";
import { getConnectionStatus } from "@/lib/composio";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (request: NextRequest, context) => {
  const { agentId } = await context!.params;
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connected_account_id");

  if (!connectionId) {
    return jsonResponse(
      { error: { code: "missing_param", message: "Missing connected_account_id" } },
      400,
    );
  }

  const status = await getConnectionStatus(connectionId);

  logger.info("OAuth callback received", {
    agent_id: agentId,
    connection_id: connectionId,
    status: status?.status,
  });

  return jsonResponse({
    agent_id: agentId,
    connection_id: connectionId,
    status: status?.status ?? "unknown",
    toolkit: status?.toolkit,
  });
});
