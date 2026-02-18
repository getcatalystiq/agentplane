import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api";
import { queryOne } from "@/db";
import { AgentRow } from "@/lib/validation";
import { NotFoundError } from "@/lib/errors";
import { initiateOAuth } from "@/lib/mcp-connections";
import type { AgentId, McpServerId, TenantId } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentId: string; mcpServerId: string }> };

export const POST = withErrorHandler(async (_request: NextRequest, context) => {
  const { agentId, mcpServerId } = await (context as RouteContext).params;

  const agent = await queryOne(AgentRow, "SELECT * FROM agents WHERE id = $1", [agentId]);
  if (!agent) throw new NotFoundError("Agent not found");

  const callbackBaseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000");

  const result = await initiateOAuth({
    mcpServerId: mcpServerId as McpServerId,
    agentId: agentId as AgentId,
    tenantId: agent.tenant_id as TenantId,
    callbackBaseUrl,
  });

  return NextResponse.json(result);
});
