import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api";
import { previewSkill } from "@/lib/skills-directory";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const owner = request.nextUrl.searchParams.get("owner");
  const repo = request.nextUrl.searchParams.get("repo");
  const skill = request.nextUrl.searchParams.get("skill");

  if (!owner || !repo || !skill) {
    return NextResponse.json(
      { error: "Missing required query parameters: owner, repo, skill" },
      { status: 400 },
    );
  }

  const result = await previewSkill(owner, repo, skill);
  if (result.ok === true) {
    return NextResponse.json({ data: { content: result.data } });
  }

  const status = result.error === "not_found" ? 404 : 502;
  return NextResponse.json({ error: result.message }, { status });
});
