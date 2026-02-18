import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api";
import { CreateMcpServerSchema } from "@/lib/validation";
import { listMcpServers, registerMcpServer, getCallbackBaseUrl } from "@/lib/mcp-connections";
import { validatePublicUrl } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async () => {
  const servers = await listMcpServers();
  return NextResponse.json({ data: servers });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  const input = CreateMcpServerSchema.parse(body);

  // SSRF validation on base_url
  await validatePublicUrl(input.base_url);

  const server = await registerMcpServer(
    {
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
