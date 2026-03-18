import { NextRequest, NextResponse } from "next/server";
import { a2aHeaders, sanitizeRequestId } from "@/lib/a2a";

export const dynamic = "force-dynamic";

// Tenant-level A2A endpoints have been removed.
// Per-agent endpoints: /api/a2a/{tenantSlug}/{agentSlug}/jsonrpc
export const POST = async (request: NextRequest) => {
  const requestId = sanitizeRequestId(request.headers.get("a2a-request-id"));
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Tenant-level A2A endpoint removed. Use /api/a2a/{tenantSlug}/{agentSlug}/jsonrpc",
      },
      id: null,
    },
    { status: 410, headers: a2aHeaders(requestId) },
  );
};
