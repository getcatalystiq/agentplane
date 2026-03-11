import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { RateLimitError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  a2aHeaders,
  buildAgentCard,
  getCachedAgentCard,
  setCachedAgentCard,
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

export const GET = withErrorHandler(async (
  request: NextRequest,
  context,
) => {
  const { slug } = await context!.params;

  // Rate limit: 60 req/min per IP (unauthenticated endpoint)
  const clientIp = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = checkRateLimit(`a2a-card:${clientIp}`, 60, 60_000);
  if (!rl.allowed) {
    logger.warn("A2A Agent Card rate limited", { ip: clientIp, slug });
    throw new RateLimitError(Math.ceil(rl.retryAfterMs / 1000));
  }

  const requestId = sanitizeRequestId(request.headers.get("a2a-request-id"));

  // Check process-level cache
  // We cache by slug since tenantId isn't known yet
  const cached = getCachedAgentCard(slug);
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: a2aHeaders(requestId, { "Cache-Control": "public, max-age=300" }),
    });
  }

  // Resolve tenant by slug via HTTP driver (not pool)
  const sql = getHttpClient();
  const tenantRows = await sql`
    SELECT id, name FROM tenants WHERE slug = ${slug} AND status = 'active'
  `;

  if (tenantRows.length === 0) {
    // Uniform 404 for non-existent tenants (prevents enumeration)
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      {
        status: 404,
        headers: a2aHeaders(requestId, { "Cache-Control": "public, max-age=300" }),
      },
    );
  }

  const tenant = TenantSlugRow.parse(tenantRows[0]);

  // Use trusted baseUrl from env (not request headers — prevents cache poisoning)
  const baseUrl = getCallbackBaseUrl();

  const card = await buildAgentCard(tenant.id, slug, tenant.name, baseUrl);

  if (!card) {
    // Uniform 404 for tenants with zero a2a_enabled agents
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      {
        status: 404,
        headers: a2aHeaders(requestId, { "Cache-Control": "public, max-age=300" }),
      },
    );
  }

  // Cache the card
  setCachedAgentCard(slug, card);

  return NextResponse.json(card, {
    status: 200,
    headers: a2aHeaders(requestId, { "Cache-Control": "public, max-age=300" }),
  });
});
