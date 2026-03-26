import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api";
import { parseSkillsShUrl, importSkillContent } from "@/lib/skills-directory";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ImportBodySchema = z.union([
  z.object({ owner: z.string().min(1), repo: z.string().min(1), skill_name: z.string().min(1) }),
  z.object({ url: z.string().min(1) }),
]);

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = ImportBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Request body must include either { owner, repo, skill_name } or { url }" },
      { status: 400 },
    );
  }

  let owner: string;
  let repo: string;
  let skillName: string;

  if ("url" in parsed.data) {
    const urlParsed = parseSkillsShUrl(parsed.data.url);
    if (!urlParsed) {
      return NextResponse.json(
        { error: "Invalid skills.sh URL. Expected format: skills.sh/owner/repo/skill or owner/repo/skill" },
        { status: 400 },
      );
    }
    owner = urlParsed.owner;
    repo = urlParsed.repo;
    skillName = urlParsed.skill;
  } else {
    owner = parsed.data.owner;
    repo = parsed.data.repo;
    skillName = parsed.data.skill_name;
  }

  const result = await importSkillContent(owner, repo, skillName);
  if (result.ok === true) {
    return NextResponse.json({ data: result.data });
  }

  const status = result.error === "not_found" ? 404
    : result.error === "rate_limited" ? 429
    : 502;
  return NextResponse.json({ error: result.message }, { status });
});
