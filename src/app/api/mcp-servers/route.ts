import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api";
import { authenticateApiKey } from "@/lib/auth";
import { listMcpServers, registerMcpServer, getCallbackBaseUrl } from "@/lib/mcp-connections";
import { CreateMcpServerSchema } from "@/lib/validation";
import { validatePublicUrl } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

// Tenant route: list available MCP servers from the registry
export const GET = withErrorHandler(async () => {
  const servers = await listMcpServers();
  return NextResponse.json({ data: servers });
});

// Tenant route: register a new MCP server
export const POST = withErrorHandler(async (request: NextRequest) => {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  const body = await request.json();
  const input = CreateMcpServerSchema.parse({ ...body, tenant_id: auth.tenantId });

  await validatePublicUrl(input.base_url);

  const server = await registerMcpServer(
    {
      tenantId: auth.tenantId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      logoUrl: input.logo_url,
      baseUrl: input.base_url,
      mcpEndpointPath: input.mcp_endpoint_path,
    },
    getCallbackBaseUrl(),
  );

  return NextResponse.json(server, { status: 201 });
});
