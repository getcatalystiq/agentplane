import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/db";
import { CreatePluginMarketplaceSchema, PluginMarketplaceRow } from "@/lib/validation";
import { withErrorHandler } from "@/lib/api";
import { ConflictError } from "@/lib/errors";
import { fetchRepoTree } from "@/lib/github";
import { getEnv } from "@/lib/env";
import { encrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async () => {
  const marketplaces = await query(
    PluginMarketplaceRow,
    "SELECT * FROM plugin_marketplaces ORDER BY name",
    [],
  );
  return NextResponse.json({ data: marketplaces });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  const input = CreatePluginMarketplaceSchema.parse(body);

  // Check uniqueness
  const existing = await queryOne(
    PluginMarketplaceRow,
    "SELECT * FROM plugin_marketplaces WHERE github_repo = $1",
    [input.github_repo],
  );
  if (existing) {
    throw new ConflictError(`Marketplace already registered: ${input.github_repo}`);
  }

  // Use provided token, fall back to global env token
  const token = input.github_token ?? getEnv().GITHUB_TOKEN;

  // Validate repo exists by fetching its tree
  const [owner, repo] = input.github_repo.split("/");
  const treeResult = await fetchRepoTree(owner, repo, token);
  if (!treeResult.ok) {
    throw new ConflictError(`Cannot access GitHub repo: ${treeResult.message}`);
  }

  // If a token was provided, encrypt and store it
  let githubTokenEnc: string | null = null;
  if (input.github_token) {
    const env = getEnv();
    const encrypted = await encrypt(input.github_token, env.ENCRYPTION_KEY);
    githubTokenEnc = JSON.stringify(encrypted);
  }

  const marketplace = await queryOne(
    PluginMarketplaceRow,
    `INSERT INTO plugin_marketplaces (name, github_repo, github_token_enc) VALUES ($1, $2, $3) RETURNING *`,
    [input.name, input.github_repo, githubTokenEnc],
  );

  return NextResponse.json(marketplace, { status: 201 });
});
