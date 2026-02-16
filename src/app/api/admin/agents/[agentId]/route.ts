import { NextRequest, NextResponse } from "next/server";
import { queryOne, query, execute } from "@/db";
import { AgentRow, RunRow, UpdateAgentSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { agentId } = await context.params;

  const agent = await queryOne(AgentRow, "SELECT * FROM agents WHERE id = $1", [agentId]);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const recentRuns = await query(
    RunRow,
    "SELECT * FROM runs WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 20",
    [agentId],
  );

  return NextResponse.json({ agent, recent_runs: recentRuns });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { agentId } = await context.params;
  const body = await request.json();
  const input = UpdateAgentSchema.parse(body);

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${idx++}`);
    params.push(input.name);
  }
  if (input.model !== undefined) {
    sets.push(`model = $${idx++}`);
    params.push(input.model);
  }
  if (input.permission_mode !== undefined) {
    sets.push(`permission_mode = $${idx++}`);
    params.push(input.permission_mode);
  }
  if (input.max_turns !== undefined) {
    sets.push(`max_turns = $${idx++}`);
    params.push(input.max_turns);
  }
  if (input.max_budget_usd !== undefined) {
    sets.push(`max_budget_usd = $${idx++}`);
    params.push(input.max_budget_usd);
  }
  if (input.skills !== undefined) {
    sets.push(`skills = $${idx++}`);
    params.push(JSON.stringify(input.skills));
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  sets.push(`updated_at = NOW()`);
  params.push(agentId);
  await execute(`UPDATE agents SET ${sets.join(", ")} WHERE id = $${idx}`, params);

  const agent = await queryOne(AgentRow, "SELECT * FROM agents WHERE id = $1", [agentId]);
  return NextResponse.json(agent);
}
