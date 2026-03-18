import { NextRequest, NextResponse } from "next/server";
import { a2aHeaders, sanitizeRequestId } from "@/lib/a2a";

export const dynamic = "force-dynamic";

// Tenant-level A2A endpoints have been removed.
// Per-agent endpoints: /api/a2a/{tenantSlug}/{agentSlug}/.well-known/agent-card.json
export const GET = async (request: NextRequest) => {
  const requestId = sanitizeRequestId(request.headers.get("a2a-request-id"));
  return NextResponse.json(
    {
      error: {
        code: "gone",
        message: "Tenant-level A2A endpoint removed. Use /api/a2a/{tenantSlug}/{agentSlug}/.well-known/agent-card.json",
      },
    },
    { status: 410, headers: a2aHeaders(requestId) },
  );
};
