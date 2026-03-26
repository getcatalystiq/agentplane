import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api";
import { fetchSkillsDirectory, type SkillsTab } from "@/lib/skills-directory";

export const dynamic = "force-dynamic";

const VALID_TABS = new Set<SkillsTab>(["all", "trending", "hot"]);

export const GET = withErrorHandler(async (request: NextRequest) => {
  const tab = (request.nextUrl.searchParams.get("tab") ?? "all") as SkillsTab;
  if (!VALID_TABS.has(tab)) {
    return NextResponse.json({ error: "Invalid tab parameter. Must be: all, trending, or hot" }, { status: 400 });
  }

  const result = await fetchSkillsDirectory(tab);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ data: result.data });
});
