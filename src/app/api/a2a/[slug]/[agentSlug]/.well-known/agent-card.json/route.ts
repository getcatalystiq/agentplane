import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { RateLimitError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  a2aHeaders,
  buildAgentCard,
  getOrBuildAgentCard,
  sanitizeRequestId,
} from "@/lib/a2a";
import { getHttpClient } from "@/db";
import { getCallbackBaseUrl } from "@/lib/mcp-connections";
import { z } from "zod";

export const dynamic = "force-dynamic";

const TenantSlugRow = z.object({
  id: z.string(),
  name: z.string(),
});

const AgentSlugRow = z.object({
  id: z.string(),
});

type RouteContext = { params: Promise<{ slug: string; agentSlug: string }> };

export const GET = withErrorHandler(async (request: NextRequest, context) => {
  const { slug: tenantSlug, agentSlug } = await (context as RouteContext).params;

  // Rate limit: 60 req/min per IP (unauthenticated endpoint)
  const clientIp =
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const rl = checkRateLimit(`a2a-card:${clientIp}`, 60, 60_000);
  if (!rl.allowed) {
    logger.warn("A2A Agent Card rate limited", { ip: clientIp, tenantSlug, agentSlug });
    throw new RateLimitError(Math.ceil(rl.retryAfterMs / 1000));
  }

  const requestId = sanitizeRequestId(request.headers.get("a2a-request-id"));
  const cacheKey = `${tenantSlug}:${agentSlug}`;
  const baseUrl = getCallbackBaseUrl();

  const card = await getOrBuildAgentCard(cacheKey, async () => {
    const sql = getHttpClient();

    const tenantRows = await sql`
      SELECT id, name FROM tenants WHERE slug = ${tenantSlug} AND status = 'active'
    `;
    if (tenantRows.length === 0) return null;
    const tenant = TenantSlugRow.parse(tenantRows[0]);

    const agentRows = await sql`
      SELECT id FROM agents
      WHERE tenant_id = ${tenant.id}
        AND slug = ${agentSlug}
        AND a2a_enabled = true
    `;
    if (agentRows.length === 0) return null;
    const agent = AgentSlugRow.parse(agentRows[0]);

    return buildAgentCard({
      agentId: agent.id,
      agentSlug,
      tenantSlug,
      tenantName: tenant.name,
      baseUrl,
    });
  });

  if (!card) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      {
        status: 404,
        headers: a2aHeaders(requestId, { "Cache-Control": "public, max-age=300" }),
      },
    );
  }

  return NextResponse.json(card, {
    status: 200,
    headers: a2aHeaders(requestId, { "Cache-Control": "public, max-age=300" }),
  });
});
