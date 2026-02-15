import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/auth";
import { withErrorHandler, jsonResponse } from "@/lib/api";
import { UpdateAgentSchema, AgentRow } from "@/lib/validation";
import { queryOne, execute } from "@/db";
import { NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

async function getAgent(agentId: string, tenantId: string) {
  const agent = await queryOne(
    AgentRow,
    "SELECT * FROM agents WHERE id = $1 AND tenant_id = $2",
    [agentId, tenantId],
  );
  if (!agent) throw new NotFoundError("Agent not found");
  return agent;
}

export const GET = withErrorHandler(async (request: NextRequest, context) => {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  const { agentId } = await context!.params;
  const agent = await getAgent(agentId, auth.tenantId);
  return jsonResponse(agent);
});

export const PUT = withErrorHandler(async (request: NextRequest, context) => {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  const { agentId } = await context!.params;

  // Verify agent exists
  await getAgent(agentId, auth.tenantId);

  const body = await request.json();
  const input = UpdateAgentSchema.parse(body);

  // Build dynamic SET clause from provided fields
  const setClauses: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let paramIdx = 1;

  const fields: Record<string, unknown> = {
    name: input.name,
    description: input.description,
    git_repo_url: input.git_repo_url,
    git_branch: input.git_branch,
    composio_toolkits: input.composio_toolkits,
    model: input.model,
    allowed_tools: input.allowed_tools,
    permission_mode: input.permission_mode,
    max_turns: input.max_turns,
    max_budget_usd: input.max_budget_usd,
  };

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      setClauses.push(`${key} = $${paramIdx}`);
      params.push(value);
      paramIdx++;
    }
  }

  params.push(agentId, auth.tenantId);
  await execute(
    `UPDATE agents SET ${setClauses.join(", ")}
     WHERE id = $${paramIdx} AND tenant_id = $${paramIdx + 1}`,
    params,
  );

  const updated = await getAgent(agentId, auth.tenantId);
  logger.info("Agent updated", { tenant_id: auth.tenantId, agent_id: agentId });
  return jsonResponse(updated);
});

export const DELETE = withErrorHandler(async (request: NextRequest, context) => {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  const { agentId } = await context!.params;

  await getAgent(agentId, auth.tenantId);
  await execute(
    "DELETE FROM agents WHERE id = $1 AND tenant_id = $2",
    [agentId, auth.tenantId],
  );

  logger.info("Agent deleted", { tenant_id: auth.tenantId, agent_id: agentId });
  return jsonResponse({ deleted: true });
});
