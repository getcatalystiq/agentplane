import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/auth";
import { withErrorHandler, jsonResponse } from "@/lib/api";
import { queryOne } from "@/db";
import { PluginMarketplaceRow, PluginManifestSchema, PluginMcpJsonSchema, SafePluginFilename, validateFrontmatter } from "@/lib/validation";
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from "@/lib/errors";
import { fetchRepoTree, fetchRawContent, fetchFileContent, pushFiles, getDefaultBranch } from "@/lib/github";
import { clearPluginCache, cacheRecentPush } from "@/lib/plugins";
import { decrypt } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { z } from "zod";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ marketplaceId: string; pluginName: string[] }> };

/**
 * Extract name and description from YAML frontmatter in a markdown file.
 * Returns null values if frontmatter is missing or malformed.
 */
function extractFrontmatter(content: string): { name: string | null; description: string | null } {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return { name: null, description: null };

  const closingIndex = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closingIndex === -1) return { name: null, description: null };

  const frontmatterLines = lines.slice(1, closingIndex);
  let name: string | null = null;
  let description: string | null = null;

  for (const line of frontmatterLines) {
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, "");

    const descMatch = line.match(/^description:\s*(.+)/);
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, "");
  }

  return { name, description };
}

/**
 * GET /api/plugin-marketplaces/:marketplaceId/plugins/:pluginName
 * Read-only tenant endpoint returning plugin metadata (agent/skill names + descriptions).
 */
async function getMarketplaceToken(marketplace: z.infer<typeof PluginMarketplaceRow>): Promise<string | undefined> {
  if (!marketplace.github_token_enc) return undefined;
  try {
    const env = getEnv();
    return await decrypt(JSON.parse(marketplace.github_token_enc), env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS);
  } catch {
    return undefined;
  }
}

export const GET = withErrorHandler(async (request: NextRequest, context) => {
  await authenticateApiKey(request.headers.get("authorization"));
  const { marketplaceId, pluginName: pluginNameSegments } = await (context as RouteContext).params;
  const pluginName = pluginNameSegments.join("/");
  const mode = new URL(request.url).searchParams.get("mode");

  const marketplace = await queryOne(
    PluginMarketplaceRow,
    "SELECT * FROM plugin_marketplaces WHERE id = $1",
    [marketplaceId],
  );
  if (!marketplace) throw new NotFoundError("Plugin marketplace not found");

  const token = await getMarketplaceToken(marketplace);
  const [owner, repo] = marketplace.github_repo.split("/");
  const treeResult = await fetchRepoTree(owner, repo, token);
  if (!treeResult.ok) {
    return NextResponse.json({ error: `Failed to fetch repo tree: ${treeResult.message}` }, { status: 502 });
  }

  const tree = treeResult.data;

  // ── Editor mode: return full file contents ──
  if (mode === "edit") {
    const skillEntries = tree.filter(e => e.type === "blob" && e.path.startsWith(`${pluginName}/skills/`));
    const agentEntries = tree.filter(e => e.type === "blob" && e.path.startsWith(`${pluginName}/agents/`) && e.path.endsWith(".md"));
    const mcpJsonEntry = tree.find(e => e.type === "blob" && e.path === `${pluginName}/.mcp.json`);

    const [skillResults, agentResults, mcpJsonResult] = await Promise.all([
      Promise.all(skillEntries.map(async (entry) => {
        const r = await fetchFileContent(owner, repo, entry.path, token);
        return r.ok ? { path: entry.path.replace(`${pluginName}/skills/`, ""), content: r.data } : null;
      })),
      Promise.all(agentEntries.map(async (entry) => {
        const r = await fetchFileContent(owner, repo, entry.path, token);
        return r.ok ? { path: entry.path.replace(`${pluginName}/agents/`, ""), content: r.data } : null;
      })),
      mcpJsonEntry ? fetchFileContent(owner, repo, mcpJsonEntry.path, token).then(r => r.ok ? r.data : null) : Promise.resolve(null),
    ]);

    return jsonResponse({
      skills: skillResults.filter(Boolean),
      agents: agentResults.filter(Boolean),
      mcpJson: mcpJsonResult,
      isOwned: marketplace.github_token_enc !== null,
    });
  }

  // ── Default mode: return metadata only ──
  const hasManifest = tree.some(e => e.type === "blob" && e.path === `${pluginName}/.claude-plugin/plugin.json`);
  if (!hasManifest) throw new NotFoundError("Plugin not found");

  const manifestResult = await fetchRawContent(owner, repo, `${pluginName}/.claude-plugin/plugin.json`, token);
  let displayName = pluginName;
  let pluginDescription: string | null = null;
  let version: string | null = null;
  if (manifestResult.ok) {
    try {
      const manifest = PluginManifestSchema.parse(JSON.parse(manifestResult.data));
      displayName = manifest.name;
      pluginDescription = manifest.description ?? null;
      version = manifest.version ?? null;
    } catch { /* use defaults */ }
  }

  const agentEntries = tree.filter(e => e.type === "blob" && e.path.startsWith(`${pluginName}/agents/`) && e.path.endsWith(".md"));
  const skillEntries = tree.filter(e => e.type === "blob" && e.path.startsWith(`${pluginName}/skills/`));

  const agentMetadata = await Promise.all(
    agentEntries.map(async (entry) => {
      const filename = entry.path.split("/").pop() ?? "";
      const contentResult = await fetchRawContent(owner, repo, entry.path, token);
      if (!contentResult.ok) return null;
      const fm = extractFrontmatter(contentResult.data);
      return { filename, name: fm.name ?? filename.replace(/\.md$/, ""), description: fm.description };
    }),
  );

  const skillFolders = new Set<string>();
  for (const entry of skillEntries) {
    const relativePath = entry.path.replace(`${pluginName}/skills/`, "");
    const folder = relativePath.split("/")[0];
    if (folder) skillFolders.add(folder);
  }

  return jsonResponse({
    name: pluginName,
    displayName,
    description: pluginDescription,
    version,
    agents: agentMetadata.filter(Boolean),
    skills: [...skillFolders].sort(),
    hasMcpJson: tree.some(e => e.type === "blob" && e.path === `${pluginName}/.mcp.json`),
  });
});

// ── PUT: Save edited plugin files ──

const PluginFileSchema = z.object({ path: z.string().min(1).max(500), content: z.string().max(100_000) });
const SavePluginSchema = z.object({ skills: z.array(PluginFileSchema), agents: z.array(PluginFileSchema), mcpJson: z.string().nullable() });

export const PUT = withErrorHandler(async (request: NextRequest, context) => {
  await authenticateApiKey(request.headers.get("authorization"));
  const { marketplaceId, pluginName: pluginNameSegments } = await (context as RouteContext).params;
  const pluginName = pluginNameSegments.join("/");

  const marketplace = await queryOne(PluginMarketplaceRow, "SELECT * FROM plugin_marketplaces WHERE id = $1", [marketplaceId]);
  if (!marketplace) throw new NotFoundError("Plugin marketplace not found");
  if (!marketplace.github_token_enc) throw new ForbiddenError("Marketplace is read-only (no GitHub token configured)");

  const body = await request.json();
  const input = SavePluginSchema.parse(body);

  for (const file of [...input.skills, ...input.agents]) {
    const filename = file.path.split("/").pop() ?? file.path;
    const validation = SafePluginFilename.safeParse(filename);
    if (!validation.success) throw new ValidationError(`Unsafe filename: ${filename}`);
  }
  for (const file of input.skills) {
    if (file.path.endsWith("/SKILL.md") || file.path === "SKILL.md") {
      const error = validateFrontmatter(file.content, `SKILL.md '${file.path}'`);
      if (error) throw new ValidationError(error);
    }
  }
  for (const file of input.agents) {
    if (file.path.endsWith(".md")) {
      const error = validateFrontmatter(file.content, `agent '${file.path}'`);
      if (error) throw new ValidationError(error);
    }
  }
  if (input.mcpJson !== null) {
    try { PluginMcpJsonSchema.parse(JSON.parse(input.mcpJson)); }
    catch (e) { throw new ValidationError(e instanceof SyntaxError ? "Invalid JSON in .mcp.json" : `.mcp.json validation failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  const env = getEnv();
  const encrypted = JSON.parse(marketplace.github_token_enc);
  const ghToken = await decrypt(encrypted, env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS);
  const [owner, repo] = marketplace.github_repo.split("/");

  const branchResult = await getDefaultBranch(owner, repo, ghToken);
  if (!branchResult.ok) return NextResponse.json({ error: `Failed to get default branch: ${branchResult.message}` }, { status: 502 });

  const files = [
    ...input.skills.map(f => ({ path: `${pluginName}/skills/${f.path}`, content: f.content })),
    ...input.agents.map(f => ({ path: `${pluginName}/agents/${f.path}`, content: f.content })),
  ];
  if (input.mcpJson !== null) files.push({ path: `${pluginName}/.mcp.json`, content: input.mcpJson });
  if (files.length === 0) throw new ValidationError("No files to save");

  const result = await pushFiles(owner, repo, ghToken, branchResult.data, files, `Update ${pluginName} via AgentPlane`);
  if (!result.ok) {
    if (result.error === "conflict") throw new ConflictError("Plugin was modified externally. Please refresh and try again.");
    return NextResponse.json({ error: `Failed to push: ${result.message}` }, { status: 502 });
  }

  clearPluginCache(marketplace.github_repo);
  cacheRecentPush(marketplace.github_repo, files);
  return jsonResponse({ commitSha: result.data.commitSha });
});
