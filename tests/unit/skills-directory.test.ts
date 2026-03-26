import { describe, it, expect } from "vitest";
import { parseSkillsShUrl, parseSkillsHtml, toFolderName } from "@/lib/skills-directory";

describe("parseSkillsShUrl", () => {
  it("parses full https URL", () => {
    expect(parseSkillsShUrl("https://skills.sh/tavily-ai/skills/search")).toEqual({
      owner: "tavily-ai",
      repo: "skills",
      skill: "search",
    });
  });

  it("parses URL without protocol", () => {
    expect(parseSkillsShUrl("skills.sh/anthropics/skills/frontend-design")).toEqual({
      owner: "anthropics",
      repo: "skills",
      skill: "frontend-design",
    });
  });

  it("parses URL with trailing slash", () => {
    expect(parseSkillsShUrl("https://skills.sh/vercel-labs/skills/find-skills/")).toEqual({
      owner: "vercel-labs",
      repo: "skills",
      skill: "find-skills",
    });
  });

  it("parses URL with www prefix", () => {
    expect(parseSkillsShUrl("https://www.skills.sh/owner/repo/skill")).toEqual({
      owner: "owner",
      repo: "repo",
      skill: "skill",
    });
  });

  it("parses http URL", () => {
    expect(parseSkillsShUrl("http://skills.sh/owner/repo/skill")).toEqual({
      owner: "owner",
      repo: "repo",
      skill: "skill",
    });
  });

  it("returns null for just skills.sh", () => {
    expect(parseSkillsShUrl("skills.sh")).toBeNull();
    expect(parseSkillsShUrl("https://skills.sh")).toBeNull();
    expect(parseSkillsShUrl("https://skills.sh/")).toBeNull();
  });

  it("returns null for incomplete paths", () => {
    expect(parseSkillsShUrl("skills.sh/owner")).toBeNull();
    expect(parseSkillsShUrl("skills.sh/owner/repo")).toBeNull();
  });

  it("returns null for too many segments", () => {
    expect(parseSkillsShUrl("skills.sh/a/b/c/d")).toBeNull();
  });

  it("returns null for empty segments", () => {
    expect(parseSkillsShUrl("skills.sh//repo/skill")).toBeNull();
    expect(parseSkillsShUrl("skills.sh/owner//skill")).toBeNull();
  });

  it("accepts bare owner/repo/skill without skills.sh prefix", () => {
    // Useful for pasting GitHub-style references directly
    expect(parseSkillsShUrl("owner/repo/skill")).toEqual({
      owner: "owner",
      repo: "repo",
      skill: "skill",
    });
  });
});

describe("parseSkillsHtml", () => {
  const makeEntry = (
    owner: string,
    repo: string,
    skill: string,
    name: string,
    installs: string,
    rank: number,
  ) => `
    <div class="h-[72px] lg:h-[52px]">
      <a class="group grid grid-cols-[auto_1fr_auto] lg:grid-cols-16 items-start lg:items-center gap-3 lg:gap-4 py-3 hover:bg-(--ds-gray-100)/30 border-b border-border h-full" href="/${owner}/${repo}/${skill}">
        <div class="lg:col-span-1 text-left">
          <span class="text-sm lg:text-base text-(--ds-gray-600) font-mono">${rank}</span>
        </div>
        <div class="lg:col-span-13 min-w-1 flex flex-col lg:flex-row lg:items-baseline lg:gap-2">
          <h3 class="font-semibold text-foreground truncate whitespace-nowrap">${name}</h3>
          <p class="text-sm text-(--ds-gray-600) truncate whitespace-nowrap">${owner}/${repo}</p>
        </div>
        <div class="lg:col-span-2 text-right">
          <span class="font-mono text-sm text-foreground">${installs}</span>
        </div>
      </a>
    </div>`;

  it("parses multiple skill entries", () => {
    const html = `
      <html><body>
        ${makeEntry("tavily-ai", "skills", "search", "search", "11.9K", 1)}
        ${makeEntry("anthropics", "skills", "frontend-design", "frontend-design", "202.0K", 2)}
      </body></html>`;

    const entries = parseSkillsHtml(html);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      name: "search",
      owner: "tavily-ai",
      repo: "skills",
      skill: "search",
      installs: "11.9K",
    });
    expect(entries[1]).toEqual({
      name: "frontend-design",
      owner: "anthropics",
      repo: "skills",
      skill: "frontend-design",
      installs: "202.0K",
    });
  });

  it("returns empty array for HTML with no skill entries", () => {
    expect(parseSkillsHtml("<html><body><h1>Hello</h1></body></html>")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseSkillsHtml("")).toEqual([]);
  });

  it("handles entries with surrounding content", () => {
    const html = `
      <div class="leaderboard">
        <div class="header">Skills Leaderboard</div>
        ${makeEntry("vercel-labs", "skills", "find-skills", "find-skills", "720.5K", 1)}
        <div class="footer">Powered by skills.sh</div>
      </div>`;

    const entries = parseSkillsHtml(html);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("find-skills");
  });
});

describe("toFolderName", () => {
  it("generates folder from owner/repo/skill", () => {
    expect(toFolderName("tavily-ai", "skills", "search")).toBe("tavily-ai-skills-search");
  });

  it("replaces dots with hyphens", () => {
    expect(toFolderName("owner.name", "repo.name", "skill.name")).toBe("owner-name-repo-name-skill-name");
  });

  it("preserves underscores", () => {
    expect(toFolderName("my_owner", "my_repo", "my_skill")).toBe("my_owner-my_repo-my_skill");
  });

  it("truncates at 255 chars", () => {
    const long = "a".repeat(200);
    const result = toFolderName(long, long, long);
    expect(result.length).toBeLessThanOrEqual(255);
  });
});
