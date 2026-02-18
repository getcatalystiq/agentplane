import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute, query } from "@/db";
import { McpServerRow, UpdateMcpServerSchema } from "@/lib/validation";
import { withErrorHandler } from "@/lib/api";
import { NotFoundError, ConflictError } from "@/lib/errors";
import { clearServerCache } from "@/lib/mcp-connections";
import { z } from "zod";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ mcpServerId: string }> };

export const GET = withErrorHandler(async (_request: NextRequest, context) => {
  const { mcpServerId } = await (context as RouteContext).params;

  const server = await queryOne(
    McpServerRow,
    `SELECT id, name, slug, description, logo_url, base_url, mcp_endpoint_path,
            client_id, oauth_metadata, created_at, updated_at
     FROM mcp_servers WHERE id = $1`,
    [mcpServerId],
  );
  if (!server) throw new NotFoundError("MCP server not found");

  return NextResponse.json(server);
});

export const PATCH = withErrorHandler(async (request: NextRequest, context) => {
  const { mcpServerId } = await (context as RouteContext).params;
  const body = await request.json();
  const input = UpdateMcpServerSchema.parse(body);

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${idx++}`);
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push(`description = $${idx++}`);
    params.push(input.description);
  }
  if (input.logo_url !== undefined) {
    sets.push(`logo_url = $${idx++}`);
    params.push(input.logo_url);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  params.push(mcpServerId);
  await execute(`UPDATE mcp_servers SET ${sets.join(", ")} WHERE id = $${idx}`, params);
  clearServerCache(mcpServerId);

  const server = await queryOne(
    McpServerRow,
    `SELECT id, name, slug, description, logo_url, base_url, mcp_endpoint_path,
            client_id, oauth_metadata, created_at, updated_at
     FROM mcp_servers WHERE id = $1`,
    [mcpServerId],
  );
  if (!server) throw new NotFoundError("MCP server not found");

  return NextResponse.json(server);
});

const ActiveConnectionCount = z.object({ count: z.coerce.number() });

export const DELETE = withErrorHandler(async (_request: NextRequest, context) => {
  const { mcpServerId } = await (context as RouteContext).params;

  // Check for active connections before deleting
  const result = await queryOne(
    ActiveConnectionCount,
    "SELECT COUNT(*)::int AS count FROM mcp_connections WHERE mcp_server_id = $1 AND status = 'active'",
    [mcpServerId],
  );

  if (result && result.count > 0) {
    throw new ConflictError(
      `Cannot delete MCP server: ${result.count} active connection(s) exist. Disconnect agents first.`,
    );
  }

  const { rowCount } = await execute("DELETE FROM mcp_servers WHERE id = $1", [mcpServerId]);
  if (rowCount === 0) throw new NotFoundError("MCP server not found");

  clearServerCache(mcpServerId);

  return NextResponse.json({ deleted: true });
});
