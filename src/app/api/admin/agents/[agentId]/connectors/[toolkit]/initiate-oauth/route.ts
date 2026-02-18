import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/db";
import { AgentRow } from "@/lib/validation";
import { initiateOAuthConnector } from "@/lib/composio";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentId: string; toolkit: string }> };

// POST /api/admin/agents/:agentId/connectors/:toolkit/initiate-oauth
// Returns { redirect_url } as JSON instead of doing a redirect.
// Used by Envoy admin UI to open OAuth in a popup.
export async function POST(request: NextRequest, context: RouteContext) {
  const { agentId, toolkit } = await context.params;
  const agent = await queryOne(AgentRow, "SELECT * FROM agents WHERE id = $1", [agentId]);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  // Build callback URL with popup mode flag
  const callbackUrl = new URL(
    `/api/admin/agents/${agentId}/connectors/${toolkit}/callback?mode=popup`,
    request.url,
  ).toString();

  const result = await initiateOAuthConnector(agent.tenant_id, toolkit, callbackUrl);
  if (!result) {
    return NextResponse.json({ error: "Failed to initiate OAuth" }, { status: 502 });
  }

  return NextResponse.json({ redirect_url: result.redirectUrl });
}
