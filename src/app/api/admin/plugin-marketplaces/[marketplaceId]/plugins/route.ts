import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/db";
import { PluginMarketplaceRow } from "@/lib/validation";
import { withErrorHandler } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { listPlugins } from "@/lib/plugins";
import { decrypt } from "@/lib/crypto";
import { getEnv } from "@/lib/env";

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

  let token: string | undefined;
  if (marketplace.github_token_enc) {
    try {
      const env = getEnv();
      token = await decrypt(JSON.parse(marketplace.github_token_enc), env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS);
    } catch { /* fall through to global token */ }
  }

  const result = await listPlugins(marketplace.github_repo, token);
  if (!result.ok) {
    return NextResponse.json(
      { error: `Failed to fetch plugins: ${result.message}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ data: result.data });
});
