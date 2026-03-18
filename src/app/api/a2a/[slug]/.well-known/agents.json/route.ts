import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { RateLimitError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { a2aHeaders, sanitizeRequestId } from "@/lib/a2a";
import { getHttpClient } from "@/db";
import { getCallbackBaseUrl } from "@/lib/mcp-connections";
import { z } from "zod";

export const dynamic = "force-dynamic";

const TenantSlugRow = z.object({
  id: z.string(),
  name: z.string(),
});

const AgentIndexRow = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * GET /api/a2a/{tenantSlug}/.well-known/agents.json
 *
 * Returns a discovery index of all A2A-enabled agents for this tenant,
 * with links to their individual Agent Card URLs.
 */
export const GET = withErrorHandler(async (request: NextRequest, context) => {
  const { slug: tenantSlug } = await (context as RouteContext).params;

  // Rate limit: 60 req/min per IP (unauthenticated endpoint)
  const clientIp =
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const rl = checkRateLimit(`a2a-agents:${clientIp}`, 60, 60_000);
  if (!rl.allowed) {
    logger.warn("A2A agents.json rate limited", { ip: clientIp, tenantSlug });
    throw new RateLimitError(Math.ceil(rl.retryAfterMs / 1000));
  }

  const requestId = sanitizeRequestId(request.headers.get("a2a-request-id"));
  const baseUrl = getCallbackBaseUrl();
  const sql = getHttpClient();

  const tenantRows = await sql`
    SELECT id, name FROM tenants WHERE slug = ${tenantSlug} AND status = 'active'
  `;
  if (tenantRows.length === 0) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404, headers: a2aHeaders(requestId, { "Cache-Control": "public, max-age=60" }) },
    );
  }
  const tenant = TenantSlugRow.parse(tenantRows[0]);

  const agentRows = await sql`
    SELECT slug, name, description
    FROM agents
    WHERE tenant_id = ${tenant.id}
      AND a2a_enabled = true
    ORDER BY name
  `;

  if (agentRows.length === 0) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404, headers: a2aHeaders(requestId, { "Cache-Control": "public, max-age=60" }) },
    );
  }

  const agents = agentRows.map((row: unknown) => AgentIndexRow.parse(row));

  const index = {
    tenant: tenant.name,
    agents: agents.map((a) => ({
      name: a.name,
      description: a.description,
      agentCardUrl: `${baseUrl}/api/a2a/${tenantSlug}/${a.slug}/.well-known/agent-card.json`,
      jsonrpcUrl: `${baseUrl}/api/a2a/${tenantSlug}/${a.slug}/jsonrpc`,
    })),
  };

  return NextResponse.json(index, {
    status: 200,
    headers: a2aHeaders(requestId, { "Cache-Control": "public, max-age=60" }),
  });
});
