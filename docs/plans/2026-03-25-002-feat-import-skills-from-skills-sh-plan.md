---
title: "feat: Import skills from skills.sh directory"
type: feat
status: completed
date: 2026-03-25
deepened: 2026-03-25
---

# feat: Import skills from skills.sh directory

## Overview

Add the ability to browse, search, and import skills from the [skills.sh](https://skills.sh/) open skills directory directly into an agent's skills tab. Since skills.sh has no public API (it's a Next.js frontend indexing GitHub repos), we'll build a server-side proxy that fetches and parses the skills.sh HTML leaderboard pages, and import skill content from GitHub using our existing GitHub API client.

## Problem Frame

Users currently create skills manually via the FileTreeEditor or install them from plugin marketplaces. The [skills.sh](https://skills.sh/) ecosystem has 90,000+ skill installs across 200+ skills from repos like `anthropics/skills`, `tavily-ai/skills`, `vercel-labs/skills`, etc. There's no way to discover or import these community skills into AgentPlane agents.

## Requirements Trace

- R1. Users can browse the skills.sh directory (All Time, Trending, Hot) from within the admin UI Skills tab
- R2. Users can search/filter skills by name within the browse modal
- R3. Users can preview a skill's SKILL.md content before importing
- R4. Users can import a skill (SKILL.md + associated files) into an agent with one click
- R5. Users can also paste a skills.sh URL directly (e.g. `skills.sh/tavily-ai/skills/search`) to import
- R6. Imported skills are stored in the existing `skills` JSONB format and injected into sandboxes as normal

## Scope Boundaries

- No skills.sh account integration or install tracking — we're a consumer of their directory only
- No periodic sync or auto-update of imported skills — one-time import only
- No changes to the existing skill CRUD API or sandbox injection — imported skills use the same format
- No changes to the SDK — admin-only feature
- No caching of skills.sh directory data in DB — process-level cache with short TTL only

## Context & Research

### Relevant Code and Patterns

- `src/lib/github.ts` — `fetchRepoTree()`, `fetchRawContent()` for GitHub API access (used by plugin marketplace)
- `src/lib/plugins.ts` — Plugin file fetching with process-level TTL cache (pattern to follow)
- `src/app/admin/(dashboard)/agents/[agentId]/skills-editor.tsx` — Current skills UI (FileTreeEditor)
- `src/app/admin/(dashboard)/agents/[agentId]/import-soul-dialog.tsx` — Existing import dialog pattern (ClawSouls import)
- `src/lib/validation.ts` — `AgentSkillSchema`, `SafeFolderName`, `SafeRelativePath` validation
- `src/app/api/admin/agents/[agentId]/route.ts` — Admin PATCH for skills (existing save path)
- `src/components/file-tree-editor.tsx` — `FlatFile` interface, `FileTreeEditor` component

### skills.sh Architecture

- **No public API** — Next.js app on Vercel, client-side search
- **URL patterns**: `/` (All Time), `/trending` (24h), `/hot` — all return full leaderboard HTML
- **Skill detail**: `/{owner}/{repo}/{skill-name}` — shows SKILL.md content + summary
- **Skill format**: SKILL.md with YAML frontmatter (`name`, `description`, `license`, `allowed-tools`) + optional `scripts/`, `references/`, `assets/` dirs
- **Source**: All skills live in public GitHub repos — we fetch content via GitHub raw CDN
- **HTML structure**: Each skill entry is a link to `/{owner}/{repo}/{skill}` with skill name, `owner/repo`, and install count

### Institutional Learnings

- Process-level caching with TTL is the standard pattern (MCP servers 5 min, plugin trees 5 min)
- `fetchRawContent()` uses raw.githubusercontent.com CDN (not rate-limited) — ideal for skill content
- Existing import patterns: ClawSouls import dialog uses a modal with preview + confirm flow

## Key Technical Decisions

- **Server-side HTML parsing (validated feasible)**: Parse skills.sh leaderboard HTML on our backend to extract skill entries. **Validated**: fetching `https://skills.sh/` returns SSR-rendered HTML containing skill names, owner/repo, and install counts — not a client-rendered empty shell. Alternatives considered and rejected:
  - _Next.js `_next/data` routes_: Include a build ID in the path that changes on every deployment — more fragile than HTML parsing, not less
  - _Direct GitHub repo indexing_ (hardcode known repos like `anthropics/skills`): Loses discovery, ranking, and install-count metadata. Worth noting as a **fallback** if HTML parsing breaks
  - _Contacting skills.sh maintainers for an API_: Ideal long-term path; HTML parser is a bridge until that exists
- **Two-tier fetch: lightweight preview vs full import**: Preview fetches only `SKILL.md` via `fetchRawContent()` (single CDN call, not rate-limited, fast). Import fetches the full repo tree + all skill files. This mirrors the plugin system pattern where `listPlugins()` is lightweight discovery and `fetchPluginContent()` is the heavy fetch-all-files call.
- **GitHub raw CDN for content**: Use `fetchRawContent()` (raw.githubusercontent.com) instead of GitHub API for skill file content — no rate limits, fast CDN delivery. Note: `fetchRawContent()` already rejects binary content and enforces 100KB per file.
- **Three-tier cache for directory data**: Cache parsed skills.sh results using the `model-catalog.ts` pattern: `cachedModels` (fresh, 15-min TTL) → `lastKnownGood` (stale fallback on fetch failure) → typed error. Includes 5-second `AbortController` timeout. Repo tree calls also cached (5-min TTL, same as `plugins.ts` `treeCache`).
- **Zod-validate parsed HTML output**: If parsing yields zero results or fails validation, return a typed error rather than an empty list — same pattern as `GatewayResponseSchema` in `model-catalog.ts`.
- **Folder naming convention**: Imported skills use `{owner}-{repo}-{skill-name}` as the folder name (e.g. `tavily-ai-skills-search`). This prevents collisions and makes the source clear. Must match `SafeFolderName` regex (`^[a-zA-Z0-9_-]+$`, max 255 chars).
- **Client-side search**: Since the full leaderboard is ~200 entries, load all and filter client-side (same as skills.sh itself does). No need for server-side search.
- **Client-side validation before save**: Imported skills must respect existing constraints: 50-skill cap (cumulative with existing), 5MB total budget, 100KB per file, unique folder names. The import dialog should validate and warn before the user saves.

## Open Questions

### Resolved During Planning

- **Q: How to handle skills with scripts/ dirs?** Resolution: Fetch all files in the skill's subdirectory from GitHub (tree API to discover, raw CDN to fetch content). Map to our `{ folder, files }` format.
- **Q: What about private repos?** Resolution: Out of scope — skills.sh only indexes public repos. `fetchRawContent()` works without auth for public repos.
- **Q: How to parse skills.sh HTML reliably?** Resolution: Use regex/string parsing on the leaderboard HTML. Each skill entry follows a consistent link pattern `/{owner}/{repo}/{skill-name}` with visible text for name and install count. No heavy HTML parser needed.

### Deferred to Implementation

- **Exact HTML parsing regex**: Depends on inspecting the actual rendered HTML structure at implementation time
- **Error UX for GitHub rate limits**: Unlikely with raw CDN, but fallback messaging TBD during implementation

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
User clicks "Import from skills.sh" on Skills tab
          │
          ▼
┌─────────────────────────┐
│  Import Skills Dialog    │
│                          │
│  [All Time] [Trending]   │
│  [Hot]                   │
│  ┌────────────────────┐  │
│  │ Search skills...   │  │
│  └────────────────────┘  │
│                          │
│  #  Skill     Repo  Installs│
│  1  search    tavily  11.9K │ ← click to preview
│  2  find-sk.. vercel  720K  │
│  ...                        │
│                          │
│  ┌─ Preview ──────────┐  │
│  │ SKILL.md content   │  │
│  │ + file list        │  │
│  │         [Import]   │  │
│  └────────────────────┘  │
│                          │
│  ── OR ──                │
│  Paste skills.sh URL:    │
│  [________________________]│
│              [Import URL] │
└─────────────────────────┘
          │
          ▼
Admin API: POST /api/admin/skills-directory/import
  → Parse owner/repo/skill from URL or selection
  → fetchRepoTree(owner, repo) to find skill files
  → fetchRawContent() for each file
  → Return { folder, files } structure
          │
          ▼
Client merges into existing skills → PATCH /api/admin/agents/:agentId
```

## Implementation Units

- [ ] **Unit 1: Skills directory parser + cache (`src/lib/skills-directory.ts`)**

  **Goal:** Server-side module that fetches skills.sh pages, parses skill entries from HTML, caches results, and fetches individual skill content from GitHub. Separate lightweight preview from full import.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** None

  **Files:**
  - Create: `src/lib/skills-directory.ts`
  - Test: `tests/unit/skills-directory.test.ts`

  **Approach:**
  - `fetchSkillsDirectory(tab: 'all' | 'trending' | 'hot')` — fetches `skills.sh/` or `/trending` or `/hot`, parses HTML to extract skill entries: `{ name, owner, repo, installs, url }`. Zod-validate the parsed output; return typed error if zero results or validation fails.
  - Three-tier cache following `model-catalog.ts` pattern (lines 82-86, 133-174): `cachedEntries` (fresh, 15-min TTL) → `lastKnownGood` (stale fallback on fetch failure) → typed error. Include 5-second `AbortController` timeout on fetch.
  - `previewSkill(owner, repo, skillName)` — **lightweight**: fetches only `SKILL.md` via single `fetchRawContent()` CDN call. Returns markdown string for preview display. Cache with 5-min TTL.
  - `importSkillContent(owner, repo, skillName)` — **full import**: uses `fetchRepoTree()` to get entire repo tree, then filters by `entry.path.startsWith(\`${skillName}/\`)` prefix (same pattern as `plugins.ts` lines 287-294). Fetches each file via `fetchRawContent()`. Cache repo tree with 5-min TTL (same as `plugins.ts` `treeCache`).
  - Returns `{ folder: string; files: { path: string; content: string }[] }` matching existing schema. Skipped files (binary, >100KB) reported as warnings array.
  - `parseSkillsShUrl(url)` — extracts `{ owner, repo, skillName }` from various URL formats: `skills.sh/owner/repo/skill`, `https://skills.sh/owner/repo/skill`
  - HTML parsing: extract link patterns with skill name, owner/repo, and install count. Keep parser isolated to one function for easy replacement if HTML structure changes.
  - Cap imported files at 20 per skill to prevent oversized imports.

  **Patterns to follow:**
  - `src/lib/model-catalog.ts` (lines 82-86, 133-174) — three-tier cache with `lastKnownGood` stale fallback, AbortController timeout, Zod validation
  - `src/lib/plugins.ts` (lines 287-294) — GitHub tree `startsWith` prefix filtering; `treeCache` Map with 5-min TTL
  - `src/lib/github.ts` — `fetchRepoTree()`, `fetchRawContent()` (already rejects binary + 100KB limit)

  **Test scenarios:**
  - Parse valid skills.sh HTML with multiple skill entries
  - Parse returns typed error when HTML yields zero results (Zod validation)
  - Parse various URL formats (with/without https, with/without trailing slash)
  - Handle skills.sh fetch failure gracefully (return `lastKnownGood` or typed error)
  - Cache returns stale data on fetch failure, refreshes on TTL expiry
  - Preview fetches only SKILL.md (single CDN call, no tree fetch)
  - Full import fetches tree + filters by skill subdirectory prefix
  - Binary/oversized files skipped with warnings array
  - Handle missing SKILL.md in repo gracefully
  - Folder name generation: `tavily-ai-skills-search` from `tavily-ai/skills/search`
  - File count cap enforced at 20 files

  **Verification:**
  - Unit tests pass for parsing, URL extraction, preview, and import
  - Module exports clean types matching existing skill schema
  - Preview and import are clearly separate code paths with different performance profiles

- [ ] **Unit 2: Admin API routes for skills directory**

  **Goal:** Three API routes — listing skills, previewing a skill, and importing a skill's full content.

  **Requirements:** R1, R2, R3, R4, R5

  **Dependencies:** Unit 1

  **Files:**
  - Create: `src/app/api/admin/skills-directory/route.ts` (GET — list)
  - Create: `src/app/api/admin/skills-directory/preview/route.ts` (GET — lightweight SKILL.md preview)
  - Create: `src/app/api/admin/skills-directory/import/route.ts` (POST — full skill content fetch)

  **Approach:**
  - `GET /api/admin/skills-directory?tab=all|trending|hot` — returns cached parsed skill entries as JSON array. Admin JWT auth required.
  - `GET /api/admin/skills-directory/preview?owner=X&repo=Y&skill=Z` — fetches only SKILL.md via `previewSkill()` (single CDN call). Returns `{ content: string }`. Lightweight endpoint for browse-and-preview flow.
  - `POST /api/admin/skills-directory/import` — body: `{ owner, repo, skill_name }` OR `{ url }` (skills.sh URL). Calls `importSkillContent()` for full tree + files fetch. Returns `{ folder, files, warnings }` matching `AgentSkillSchema` plus a warnings array for skipped files. Does NOT save to agent — client handles merge + PATCH.
  - All routes use `withErrorHandler()` wrapper, admin auth
  - Import route validates `SafeFolderName` on generated folder name

  **Patterns to follow:**
  - `src/app/api/admin/composio/route.ts` — admin-only discovery endpoint pattern
  - `src/app/api/admin/agents/[agentId]/route.ts` — existing admin PATCH pattern for skills save

  **Test scenarios:**
  - GET list returns skill entries with correct shape
  - GET list respects tab parameter
  - GET preview returns SKILL.md content for valid skill
  - GET preview returns 404 for non-existent SKILL.md
  - POST import with URL parses and returns full skill content
  - POST import with owner/repo/skill_name returns skill content + warnings for skipped files
  - POST import returns 404 for non-existent skill
  - POST import returns 400 for invalid URL format
  - All routes require admin auth

  **Verification:**
  - Routes respond correctly with mock data
  - Preview is demonstrably lighter than import (single CDN call vs tree + multi-file fetch)
  - Integration with skills-directory module works end-to-end

- [ ] **Unit 3: Import Skills Dialog component**

  **Goal:** Modal dialog for browsing, searching, previewing, and importing skills from skills.sh.

  **Requirements:** R1, R2, R3, R4, R5

  **Dependencies:** Unit 2

  **Files:**
  - Create: `src/app/admin/(dashboard)/agents/[agentId]/import-skill-dialog.tsx`

  **Approach:**
  - Dialog triggered by "Import from skills.sh" button (added in Unit 4)
  - Three tabs: All Time / Trending / Hot — each fetches from `/api/admin/skills-directory?tab=...`
  - Search input filters results client-side by skill name
  - Skill list shows: rank, name, owner/repo, install count
  - Click a skill → preview pane shows SKILL.md content (fetched via lightweight preview endpoint — single CDN call, not full import)
  - "Import" button calls the full import endpoint, returns `{ folder, files, warnings }` to parent via callback
  - Display warnings for skipped files (binary, oversized) if any
  - URL paste input at bottom: paste a skills.sh URL → import directly
  - Loading states, error handling, empty states
  - Dark mode styling consistent with admin UI

  **Patterns to follow:**
  - `src/app/admin/(dashboard)/agents/[agentId]/import-soul-dialog.tsx` — modal dialog pattern with preview
  - `src/components/ui/dialog.tsx` — base dialog component
  - `src/components/ui/tabs.tsx` — line-style tabs
  - `src/app/admin/(dashboard)/agents/[agentId]/tools-modal.tsx` — list + detail pattern

  **Test scenarios:**
  - Dialog opens and loads skill list
  - Tab switching fetches correct data
  - Search filters skills by name
  - Clicking skill shows preview with SKILL.md content
  - Import button calls callback with correct skill data
  - URL paste imports skill correctly
  - Error states display for failed fetches
  - Warnings displayed for skipped files (binary, oversized)
  - Duplicate skill detection (warn if folder name already exists)
  - Validation warnings: skill count cap (50 total), size budget (5MB total), per-file limit (100KB)

  **Verification:**
  - Dialog renders correctly in dark mode
  - Full flow: browse → preview → import works end-to-end
  - URL import flow works end-to-end

- [ ] **Unit 4: Integrate import dialog into Skills tab**

  **Goal:** Add the "Import from skills.sh" button to the existing SkillsEditor and handle merging imported skills into the current skill set.

  **Requirements:** R4, R5, R6

  **Dependencies:** Unit 3

  **Files:**
  - Modify: `src/app/admin/(dashboard)/agents/[agentId]/skills-editor.tsx`

  **Approach:**
  - Add "Import from skills.sh" button next to the existing FileTreeEditor (in the header area, similar to how identity tab has action buttons)
  - On import callback: receive `{ folder, files }` from dialog, merge into parent's state array that feeds `initialFiles` prop. FileTreeEditor reacts to `initialFiles` changes via `useEffect` (uses `JSON.stringify` for change detection) — parent must produce a new array reference with different content to trigger re-sync.
  - Duplicate detection: if folder name already exists, show warning and offer to overwrite or skip
  - Pre-save validation: check 50-skill cap (cumulative with existing), 5MB total budget, unique folder names before allowing save
  - User saves via existing "Save Skills" button (no auto-save on import)
  - The imported skill appears immediately in the FileTreeEditor for review/editing before save

  **Patterns to follow:**
  - `src/app/admin/(dashboard)/agents/[agentId]/identity-tab.tsx` — action buttons in tab header pattern
  - `src/app/admin/(dashboard)/agents/[agentId]/skills-editor.tsx` — existing save flow

  **Test scenarios:**
  - Import button opens the dialog
  - Imported skill appears in FileTreeEditor
  - Duplicate folder name shows warning
  - User can edit imported skill before saving
  - Save persists imported skill via existing PATCH endpoint

  **Verification:**
  - Full flow works: Import → preview in editor → save → skill appears in agent
  - Imported skills inject into sandbox correctly (no changes needed — same format)

## System-Wide Impact

- **Interaction graph:** No callbacks or middleware affected. Import is a client-side operation that flows through existing PATCH endpoint.
- **Error propagation:** GitHub fetch errors surface in the import dialog. skills.sh parse errors return empty results with cache fallback.
- **State lifecycle risks:** None — import is stateless. No new DB tables or columns.
- **API surface parity:** Admin-only feature. No tenant API or SDK changes needed.
- **Integration coverage:** Imported skills use identical format to manually created skills — sandbox injection works unchanged.

## Risks & Dependencies

- **skills.sh HTML structure changes**: If skills.sh redesigns their page, our parser breaks. Mitigation: isolate parsing to one function, Zod-validate parsed output (zero results = typed error, not empty list), fail gracefully to `lastKnownGood` cache, log parse errors for monitoring. **Fallback**: direct GitHub repo indexing of known repos (loses ranking/installs but preserves import flow).
- **GitHub API rate limits for tree fetches**: `fetchRepoTree()` uses GitHub API (60 req/hr unauthenticated). Preview uses `fetchRawContent()` (CDN, not rate-limited — safe). Mitigation: cache repo trees with 5-min TTL (same as `plugins.ts` `treeCache`). One tree call per import is minimal. For future consideration: optional GitHub token at tenant level (similar to `github_token_enc` on `plugin_marketplaces`).
- **Full repo tree for large repos**: `fetchRepoTree()` fetches the entire repo tree (e.g. `anthropics/skills` with many skills returns thousands of entries). Mitigation: filter tree entries client-side by `startsWith` prefix (same pattern as `plugins.ts` lines 287-294), cache aggressively.
- **Binary files in skill directories**: `fetchRawContent()` already rejects binary content and enforces 100KB per file. Risk is that legitimate files (e.g. shell scripts with unusual characters) may be silently skipped. Mitigation: return skipped files in a `warnings` array so the import dialog can display them to the user.
- **Large skills with many files**: Some skills have scripts/ + references/ dirs. Mitigation: cap at 20 files per skill and warn user.
- **skills.sh availability**: If skills.sh is down, the browse UI shows an error but existing imported skills continue to work normally. No hard runtime dependency — skills.sh is only used for discovery, not execution.
- **Validation constraint violations on import**: Imported skills must fit within existing limits (50 skills/agent, 5MB total, 100KB/file, unique folders). Mitigation: client-side pre-save validation with clear warnings before attempting PATCH.

## Sources & References

- skills.sh homepage: https://skills.sh/
- Agent Skills standard: https://agentskills.io/
- Skill format: SKILL.md with YAML frontmatter
- Example skill repos: `anthropics/skills`, `tavily-ai/skills`, `vercel-labs/skills`
- Related code: `src/lib/github.ts`, `src/lib/plugins.ts`, `src/lib/model-catalog.ts`
