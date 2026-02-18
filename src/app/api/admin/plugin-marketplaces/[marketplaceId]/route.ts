import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/db";
import { PluginMarketplaceRow } from "@/lib/validation";
import { withErrorHandler } from "@/lib/api";
import { NotFoundError, ConflictError } from "@/lib/errors";
import { clearPluginCache } from "@/lib/plugins";
import { z } from "zod";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ marketplaceId: string }> };

export const GET = withErrorHandler(async (_request: NextRequest, context) => {
  const { marketplaceId } = await (context as RouteContext).params;

  const marketplace = await queryOne(
    PluginMarketplaceRow,
    "SELECT * FROM plugin_marketplaces WHERE id = $1",
    [marketplaceId],
  );
  if (!marketplace) throw new NotFoundError("Plugin marketplace not found");

  return NextResponse.json(marketplace);
});

const AgentRefCount = z.object({ count: z.coerce.number() });

export const DELETE = withErrorHandler(async (_request: NextRequest, context) => {
  const { marketplaceId } = await (context as RouteContext).params;

  // Check if any agents reference this marketplace in their plugins JSONB
  const refCount = await queryOne(
    AgentRefCount,
    `SELECT COUNT(*)::int AS count FROM agents WHERE plugins @> $1::jsonb`,
    [JSON.stringify([{ marketplace_id: marketplaceId }])],
  );

  if (refCount && refCount.count > 0) {
    throw new ConflictError(
      `Cannot delete marketplace: ${refCount.count} agent(s) use plugins from it. Remove plugins from agents first.`,
    );
  }

  const { rowCount } = await execute(
    "DELETE FROM plugin_marketplaces WHERE id = $1",
    [marketplaceId],
  );
  if (rowCount === 0) throw new NotFoundError("Plugin marketplace not found");

  clearPluginCache();

  return NextResponse.json({ deleted: true });
});
