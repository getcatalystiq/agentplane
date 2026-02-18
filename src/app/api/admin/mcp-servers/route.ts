import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api";
import { CreateMcpServerSchema } from "@/lib/validation";
import { listMcpServers, registerMcpServer } from "@/lib/mcp-connections";
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

  // Determine callback base URL
  const callbackBaseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000");

  const server = await registerMcpServer(
    {
      name: input.name,
      slug: input.slug,
      description: input.description,
      logoUrl: input.logo_url,
      baseUrl: input.base_url,
      mcpEndpointPath: input.mcp_endpoint_path,
    },
    callbackBaseUrl,
  );

  return NextResponse.json(server, { status: 201 });
});
