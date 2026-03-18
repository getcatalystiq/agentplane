---
title: Refactor A2A to Per-Agent Endpoints
type: refactor
status: active
date: 2026-03-17
deepened: 2026-03-17
---

# Refactor A2A to Per-Agent Endpoints

## Enhancement Summary

**Deepened on:** 2026-03-17
**Research agents used:** architecture-strategist, security-sentinel, data-migration-expert, performance-oracle, data-integrity-guardian, agent-native-reviewer, best-practices-researcher, kieran-typescript-reviewer

### Key Improvements Discovered
1. **Migration is BLOCKING without collision-safe SQL** — the naive `REGEXP_REPLACE` backfill will fail at `ADD CONSTRAINT` if any two agents in the same tenant produce the same slug. A suffix-based deduplication pass is required.
2. **`CREATE INDEX CONCURRENTLY` must run outside a transaction** — Postgres forbids it inside a transaction block. The migration must be split or the runner must disable auto-transaction for that step.
3. **Old routes must return `410 Gone`** — silent deletion risks confusing existing callers. Return `410 Gone` with a migration message for at least one deploy cycle.
4. **Add tenant-level discovery endpoint** — without `GET /api/a2a/{tenantSlug}/.well-known/agents.json`, external agents must know slugs out-of-band, breaking agent-native discoverability.
5. **`buildAgentCard` should take an options object** — 5 positional string params creates silent swap bugs; refactor to named options.
6. **Cache max 100 is too small for per-agent keys** — increase to 1000 and switch to LRU eviction.

### New Considerations Discovered
- Slug must be immutable once `a2a_enabled = true` (broken URLs for A2A clients)
- `AgentCard.authentication` field is missing and required by the A2A spec
- Resolve agent to `AgentId` in the route before constructing `SandboxAgentExecutor`, don't re-fetch by slug inside the executor
- In-flight promise deduplication needed to prevent cache stampede on cold starts
- Add `AgentSlug` branded type for compile-time safety (consistent with existing `TenantId`, `AgentId`)

---

## Overview

The current A2A implementation exposes a single endpoint per **tenant**, listing all a2a-enabled agents as `skills` in one Agent Card. This is architecturally wrong: each agent is a distinct autonomous entity and should have its own identity, endpoint, and Agent Card. The `skills` field in the A2A spec is meant for sub-capabilities *of one agent* — not separate agents.

**Before:**
```
GET  /api/a2a/{tenantSlug}/.well-known/agent-card.json   ← one card for all agents
POST /api/a2a/{tenantSlug}/jsonrpc                        ← one RPC for all agents
```

**After:**
```
GET  /api/a2a/{tenantSlug}/{agentSlug}/.well-known/agent-card.json   ← one card per agent
POST /api/a2a/{tenantSlug}/{agentSlug}/jsonrpc                        ← one RPC per agent
GET  /api/a2a/{tenantSlug}/.well-known/agents.json                    ← NEW: tenant discovery index
```

## Problem Statement

- External A2A clients can't discover or connect to a specific agent — they get a blob of all tenant agents
- `AgentCard.skills[]` is misused (separate agents listed as sub-capabilities)
- `SandboxAgentExecutor` has a "Phase 1 single agent" guard that will throw if more than one a2a-enabled agent exists per tenant
- The `AgentCard.url` points to a shared tenant endpoint, making agent identity ambiguous
- Agent skills (from `agent.skills`) are never surfaced in the card — the `skills` field should actually represent those
- `AgentCard.authentication` field is missing — A2A spec requires it; clients don't know auth scheme

## Technical Approach

### Architecture

Each agent gets its own A2A surface:
- Its own Agent Card at `/{tenantSlug}/{agentSlug}/.well-known/agent-card.json`
- Its own JSON-RPC endpoint at `/{tenantSlug}/{agentSlug}/jsonrpc`
- Its `skills` in the Agent Card populated from `agent.skills` (the actual installed skills, not other agents)
- Tags from `agent.a2a_tags` (already stored per-agent)
- A tenant-level discovery index at `/{tenantSlug}/.well-known/agents.json` lists all a2a-enabled agents with their slugs and card URLs

Auth remains **tenant-scoped** (API key → tenant). The `agentSlug` is a routing param resolved after auth. The agent row is resolved in the route handler and passed into `SandboxAgentExecutor` as an `AgentId` — the executor does not re-fetch by slug internally.

### Agent Slug

Agents currently have no `slug` column. We add one:
- `slug VARCHAR(100) NOT NULL` with `UNIQUE(tenant_id, slug)` and `CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$')`
- Auto-derived from `name` on insert: lowercase, trim, spaces → hyphens, strip non-alphanumeric except hyphens, trim leading/trailing hyphens
- Slug is **immutable once `a2a_enabled = true`** — changing it breaks all external A2A clients
- If name is entirely special characters and produces an empty slug, fallback: `'agent-' || id::TEXT`
- Slug collisions (on insert/rename): append `-2`, `-3`, etc.; catch Postgres `23505` and return 409
- Reserved words blocked at validation: `well-known`, `api`, `admin`, `health`, `jsonrpc`

### AgentCard Enhancements

```json
{
  "name": "agent-name",
  "description": "agent description",
  "url": "https://agentplane.vercel.app/api/a2a/{tenantSlug}/{agentSlug}/jsonrpc",
  "protocolVersion": "0.3.0",
  "version": "1.0.0",
  "authentication": { "schemes": ["bearer"] },
  "capabilities": { "streaming": true, "pushNotifications": false, "stateTransitionHistory": false },
  "skills": [/* from agent.skills JSONB */],
  "extensions": {
    "agent-plane:model": "claude-sonnet-4-6",
    "agent-plane:maxRuntimeSeconds": 600,
    "agent-plane:maxTurns": 10
  }
}
```

### Implementation Phases

#### Phase 1: DB — Add `slug` to agents

**Pre-migration audit (run against production before deploying):**
```sql
-- Identify collision candidates before running migration
SELECT tenant_id,
       LOWER(TRIM(BOTH '-' FROM REGEXP_REPLACE(
           REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9\s-]', '', 'g'),
           '\s+', '-', 'g'
       ))) AS candidate_slug,
       COUNT(*) AS n
FROM agents
GROUP BY tenant_id, candidate_slug
HAVING COUNT(*) > 1;
```

If any rows return, resolve the collisions manually (rename agents) before deploying.

**Migration `019_add_agent_slug.sql`:**

> **Critical:** `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. The migration runner must execute this file outside a transaction block (or split into two files — one transactional, one not).

```sql
-- Step 1: Add nullable column (brief ACCESS EXCLUSIVE lock, fast with no default)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS slug VARCHAR(100);

-- Step 2: Collision-safe backfill with row-number suffix
UPDATE agents a
SET slug = final_slug
FROM (
    SELECT
        id,
        CASE
            WHEN ROW_NUMBER() OVER (PARTITION BY tenant_id, base_slug ORDER BY created_at) = 1
                THEN base_slug
            ELSE base_slug || '-' || ROW_NUMBER() OVER (PARTITION BY tenant_id, base_slug ORDER BY created_at)::TEXT
        END AS final_slug
    FROM (
        SELECT id, tenant_id, created_at,
            NULLIF(
                TRIM(BOTH '-' FROM LOWER(
                    REGEXP_REPLACE(
                        REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9\s-]', '', 'g'),
                        '\s+', '-', 'g'
                    )
                )),
                ''
            ) AS base_slug
        FROM agents
    ) named
) computed
WHERE a.id = computed.id;

-- Step 3: Fallback for empty slugs (names that were all special chars)
UPDATE agents
SET slug = 'agent-' || id::TEXT
WHERE slug IS NULL;

-- Step 4: Enforce NOT NULL (metadata-only in PG12+ when no NULLs remain)
ALTER TABLE agents ALTER COLUMN slug SET NOT NULL;

-- Step 5: Format CHECK constraint
ALTER TABLE agents
    ADD CONSTRAINT agents_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$');

-- Step 6: Zero-downtime unique index (CONCURRENTLY — must run outside a transaction)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_agents_tenant_slug_unique
    ON agents(tenant_id, slug);

-- Step 7: Attach unique constraint to existing index (no extra scan)
ALTER TABLE agents
    ADD CONSTRAINT agents_tenant_slug_unique
    UNIQUE USING INDEX idx_agents_tenant_slug_unique;

-- Step 8: Partial index for A2A routing (CONCURRENTLY — must run outside a transaction)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agents_a2a_slug
    ON agents(tenant_id, slug)
    WHERE a2a_enabled = true;
```

Files to change:
- `src/db/migrations/019_add_agent_slug.sql` — new file (split CONCURRENTLY steps if runner requires)
- `src/lib/validation.ts` — add `slug` to `AgentRow`, `CreateAgentSchema`, `UpdateAgentSchema`; add `AgentSlug` branded type to `src/lib/types.ts`
- `src/app/api/admin/agents/route.ts` — include `slug` in INSERT, auto-derive if not provided; catch `23505` → 409
- `src/app/api/admin/agents/[agentId]/route.ts` — allow `slug` update in PATCH fieldMap **only if `a2a_enabled = false`**; invalidate AgentCard cache on slug change

#### Phase 2: Core A2A Logic (`src/lib/a2a.ts`)

**`AgentSlug` branded type** (add to `src/lib/types.ts`):
```ts
export type AgentSlug = string & { readonly __brand: "AgentSlug" };
```

**`A2aAgentRow`** — add `slug` and `skills` fields:
```ts
const A2aAgentRow = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().nullable(),
  max_runtime_seconds: z.coerce.number(),
  max_turns: z.coerce.number(),
  model: z.string(),
  a2a_tags: z.array(z.string()).default([]),
  skills: z.array(AgentSkillSchema).default([]).catch([]),
});
```

**`buildAgentCard`** — refactor to options object, per-agent:
```ts
interface BuildAgentCardOptions {
  tenantId: string;
  tenantSlug: string;
  agentSlug: AgentSlug;
  tenantName: string;
  baseUrl: string;
}

export async function buildAgentCard(opts: BuildAgentCardOptions): Promise<AgentCard | null>
```
- Query: `WHERE tenant_id = $1 AND slug = $2 AND a2a_enabled = true` → single row
- `AgentCard.url` → `${baseUrl}/api/a2a/${tenantSlug}/${agentSlug}/jsonrpc`
- `AgentCard.name` → agent name (not tenant name)
- `AgentCard.description` → agent description (strip `max_runtime_seconds` from fallback string)
- `AgentCard.authentication` → `{ schemes: ["bearer"] }`
- `AgentCard.skills[]` → populated from `agent.skills` JSONB
- `AgentCard.extensions` → `{ "agent-plane:model": agent.model, "agent-plane:maxRuntimeSeconds": agent.max_runtime_seconds, "agent-plane:maxTurns": agent.max_turns }`
- Cache key: `${tenantSlug}:${agentSlug}`

**Cache improvements:**
- Increase `AGENT_CARD_CACHE_MAX` from 100 → 1000
- Switch eviction from FIFO (oldest inserted) to LRU (least recently used)
- Add in-flight deduplication: `Map<string, Promise<AgentCard | null>>` — collapses parallel cold-start queries

**`SandboxAgentExecutor`:**
- `ExecutorDeps` uses `agentId: AgentId` (resolved before construction in the route, not by slug inside executor)
- Remove `loadA2aAgents()` method and Phase 1 one-agent guard entirely
- The agent row is passed in from the route handler — no re-fetch inside the executor

**`RunBackedTaskStore`:** no change — already tenant-scoped.

#### Phase 3: Route Files

**Old routes — convert to `410 Gone` (do NOT silently delete):**
```ts
// src/app/api/a2a/[slug]/.well-known/agent-card.json/route.ts
export const GET = () => new Response(
  JSON.stringify({ error: "This endpoint has moved. Use /api/a2a/{tenantSlug}/{agentSlug}/.well-known/agent-card.json" }),
  { status: 410, headers: { "Content-Type": "application/json" } }
);
// src/app/api/a2a/[slug]/jsonrpc/route.ts — same pattern
```

**New routes:**
- `src/app/api/a2a/[slug]/[agentSlug]/.well-known/agent-card.json/route.ts`
- `src/app/api/a2a/[slug]/[agentSlug]/jsonrpc/route.ts`
- `src/app/api/a2a/[slug]/.well-known/agents.json/route.ts` ← NEW discovery index

**Agent Card route:**
```ts
const { slug, agentSlug } = await context.params;
// 1. Resolve tenant by slug (same DB query as before)
// 2. Call buildAgentCard({ tenantId, tenantSlug: slug, agentSlug, tenantName, baseUrl })
// 3. Return 404 if agent not found or a2a_enabled = false
// 4. Note: returns same 404 shape whether tenant or agent not found (prevent enumeration)
```

**JSON-RPC route — thread auth result to avoid duplicate tenant query:**
```ts
const { slug, agentSlug } = await context.params;
// 1. authenticateA2aRequest(request, slug) → { tenantId, apiKeyId }  (has tenant data)
// 2. Load agent: SELECT * FROM agents WHERE tenant_id = $1 AND slug = $2 AND a2a_enabled = true
// 3. 404 if not found — sanitized error (don't leak whether agent exists)
// 4. Budget check using already-resolved tenantId (no second tenant SELECT)
// 5. Construct SandboxAgentExecutor with agentId from step 2 (pass the row, not the slug)
```

**Discovery index route (`agents.json`):**
```ts
// GET /api/a2a/{tenantSlug}/.well-known/agents.json
// Public, rate-limited by IP (same as agent card)
// Returns: { agents: [{ name, slug, agentCardUrl, jsonRpcUrl }] }
// Only lists a2a_enabled = true agents
// 404 if tenant not found (same shape as agent not found — no enumeration)
```

#### Phase 4: Admin UI

**`src/app/admin/(dashboard)/agents/[agentId]/a2a-info-section.tsx`:**
- Add `agentSlug: string` prop
- Update URL strings:
  ```ts
  const endpointUrl  = `${baseUrl}/api/a2a/${tenantSlug}/${agentSlug}`;
  const jsonRpcUrl   = `${baseUrl}/api/a2a/${tenantSlug}/${agentSlug}/jsonrpc`;
  const agentCardUrl = `${baseUrl}/api/a2a/${tenantSlug}/${agentSlug}/.well-known/agent-card.json`;
  ```

**`src/app/admin/(dashboard)/agents/[agentId]/page.tsx`:**
- Pass `agentSlug={agent.slug}` to `A2aInfoSection`

**Agent edit form** (`edit-form.tsx`):
- Show `slug` as a read-only field when `a2a_enabled = true` (immutable once A2A is active)
- Show `slug` as an editable field when `a2a_enabled = false`
- Display warning on slug field: "Changing the slug will break existing A2A integrations"

#### Phase 5: `vercel.json` function config

The `supportsCancellation` config targets `app/api/a2a/**` — the glob matches the deeper `[slug]/[agentSlug]` nesting. No change needed.

## Alternative Approaches Considered

**Keep tenant-level endpoint + add per-agent endpoints (dual mode):** More backward-compatible but doubles the surface, confusing to maintain. Rejected — no external consumers yet.

**Use agent `id` (UUID) instead of `slug` in URL:** Works but ugly URLs. Agents already have human-readable names that are unique per tenant; slugifying them gives clean URLs. Rejected in favor of slug.

**Derive slug from name at query time (no slug column):** Fragile — if name changes the URL breaks. Rejected in favor of persistent slug column.

**Auto-update slug when name changes:** Breaks all external A2A clients silently. Rejected — slug is immutable once `a2a_enabled = true`.

## System-Wide Impact

### Interaction Graph

1. **Discovery:** External orchestrator → `GET /api/a2a/{tenantSlug}/.well-known/agents.json` (new) → DB query all `a2a_enabled` agents for tenant → returns agent list with card URLs
2. **Card fetch:** External client → `GET /api/a2a/{tenantSlug}/{agentSlug}/.well-known/agent-card.json` → `buildAgentCard(opts)` → DB single-agent query → AgentCard cached at `${tenantSlug}:${agentSlug}` with in-flight deduplication
3. **Execution:** External client → `POST /api/a2a/{tenantSlug}/{agentSlug}/jsonrpc` → `authenticateA2aRequest(req, tenantSlug)` → load agent by `(tenantId, agentSlug)` → `DefaultRequestHandler` → `SandboxAgentExecutor.execute(ctx, agentId)` → `createRun()` → sandbox → stream → `finalizeRun()`
4. **Rate limiting:** card route: IP-based; jsonrpc route: tenant-based; discovery route: IP-based (same as card)

### Error & Failure Propagation

- Agent not found (slug unknown, `a2a_enabled = false`): route returns same 404 shape regardless (prevent agent enumeration)
- Auth failure: `authenticateA2aRequest` returns null → 401 (unchanged)
- Agent slug change while `a2a_enabled = true`: PATCH handler returns 422 "Cannot change slug of an A2A-enabled agent"
- Slug conflict on insert/rename: Postgres `23505` → 409 Conflict at application layer
- Empty slug after slugification: 422 at application layer + fallback in migration (`agent-{id}`)
- Old routes now return `410 Gone` with migration message

### State Lifecycle Risks

- **Migration collision:** Pre-migration audit query must be run against production before deploying. See Phase 1.
- **`CONCURRENTLY` in transactions:** Migration runner must execute index creation outside a transaction. Check whether `npm run migrate` wraps statements in a transaction and disable it for these steps if needed.
- **AgentCard cache after slug change:** `PATCH /api/admin/agents/:id` must call `agentCardCache.delete(`${tenantSlug}:${oldSlug}`)` when slug changes (even though slugs are blocked when `a2a_enabled = true`, they can change while disabled).
- **Agent Card cache capacity:** Increasing to 1000 entries + LRU must be implemented before shipping or hot agents will thrash under the existing 100-entry FIFO cap.
- **Old route `410` → removal:** After one full deploy cycle (one week minimum), the `410 Gone` stubs can be removed in a follow-up PR.

### API Surface Parity

- SDK (`src/sdk/`) doesn't expose A2A endpoints — no SDK changes needed
- CLAUDE.md execution flow section must be updated with new URL structure and tenant discovery index
- Agent Card's `authentication` field declaration makes all spec-compliant A2A clients work without trial-and-error

## Acceptance Criteria

### Phase 1 — DB & Validation
- [ ] Pre-migration audit query run against production — zero collisions
- [ ] `019_add_agent_slug.sql` migration adds `slug`, backfills collision-safe, adds CHECK + UNIQUE constraints
- [ ] `CONCURRENTLY` index creation runs outside transaction (verify migration runner behavior)
- [ ] `AgentRow` Zod schema includes `slug`
- [ ] `AgentSlug` branded type added to `src/lib/types.ts`
- [ ] `CreateAgentSchema` auto-derives slug from name if not provided
- [ ] Reserved words blocked in slug validation (`well-known`, `api`, `admin`, `health`, `jsonrpc`)
- [ ] Postgres `23505` on slug conflict returns HTTP 409 (not 500)
- [ ] Slug PATCH blocked with 422 when `a2a_enabled = true`

### Phase 2 — Core Logic
- [ ] `buildAgentCard` takes options object; returns single-agent card
- [ ] `AgentCard.authentication` = `{ schemes: ["bearer"] }`
- [ ] `AgentCard.extensions` includes model, maxRuntimeSeconds, maxTurns
- [ ] `AgentCard.skills[]` populated from `agent.skills` JSONB
- [ ] Cache max increased to 1000 with LRU eviction
- [ ] In-flight deduplication on cache miss
- [ ] `SandboxAgentExecutor` takes `agentId: AgentId` in deps, no re-fetch by slug
- [ ] Phase 1 one-agent guard removed from `SandboxAgentExecutor`

### Phase 3 — Routes
- [ ] `GET /api/a2a/{tenantSlug}/{agentSlug}/.well-known/agent-card.json` returns single-agent card
- [ ] `POST /api/a2a/{tenantSlug}/{agentSlug}/jsonrpc` routes to specific agent
- [ ] `GET /api/a2a/{tenantSlug}/.well-known/agents.json` returns discovery index for tenant
- [ ] Old routes return `410 Gone` with migration message
- [ ] 404 returned for unknown agentSlug — same shape as tenant-not-found (prevent enumeration)
- [ ] Auth result threaded through to budget check (no duplicate `SELECT tenants`)

### Phase 4 — Admin UI
- [ ] A2A info section displays per-agent URLs
- [ ] Slug shown read-only in edit form when `a2a_enabled = true`
- [ ] Slug editable in edit form when `a2a_enabled = false`

### Phase 5 — Quality
- [ ] Multiple a2a-enabled agents per tenant work independently
- [ ] Existing unit tests in `tests/unit/a2a.test.ts` updated
- [ ] New tests: slug collision on creation, `a2a_enabled = false` rejection, cache key isolation between tenants, discovery index returns correct agents
- [ ] CLAUDE.md updated with new URL structure and tenant discovery endpoint

## Dependencies & Prerequisites

- Migration 018 (`a2a_tags`) already merged — migration 019 builds on top of it
- No external A2A clients currently rely on the old tenant-level endpoints (safe to break)
- Run pre-migration audit query against production before merging

## Sources & References

### Internal References

- A2A route (agent card): `src/app/api/a2a/[slug]/.well-known/agent-card.json/route.ts`
- A2A route (jsonrpc): `src/app/api/a2a/[slug]/jsonrpc/route.ts`
- A2A core logic: `src/lib/a2a.ts:86` (`buildAgentCard`), `src/lib/a2a.ts:200+` (`SandboxAgentExecutor`)
- Auth: `src/lib/auth.ts:70` (`authenticateA2aRequest`)
- Admin UI: `src/app/admin/(dashboard)/agents/[agentId]/a2a-info-section.tsx`
- Agent page: `src/app/admin/(dashboard)/agents/[agentId]/page.tsx`
- Tests: `tests/unit/a2a.test.ts`
- Current migrations: `src/db/migrations/016_a2a_support.sql`, `018_add_a2a_tags.sql`
- Branded types pattern: `src/lib/types.ts`

### External References

- A2A Protocol spec: https://google.github.io/A2A/
- `@a2a-js/sdk` v0.3.12 — `DefaultRequestHandler`, `AgentCard`, `AgentSkill` types
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
