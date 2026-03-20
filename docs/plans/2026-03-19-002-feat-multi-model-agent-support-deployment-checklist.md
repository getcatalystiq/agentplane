# Deployment Checklist: Multi-Model Agent Support (feat/multi-model)

Plan: docs/plans/2026-03-19-002-feat-multi-model-agent-support-plan.md
Migration: `020_add_runner_column.sql` (planned as 018 in plan, actual next slot is 020)
Deploy target: Vercel (auto-deploy on push to main; migration runs during build)

---

## Critical Pre-Deploy Findings

### Finding 1: Migration number conflict

The plan calls this migration "018" but the repo is already at 019. The file must be
named `020_add_runner_column.sql`. Using 018 will cause the migration runner to skip it
(already-seen or out-of-order) depending on the runner's deduplication logic. Verify
the exact migration runner behavior in `src/db/migrate.ts` before naming the file.

### Finding 2: Migration 020 is zero-downtime safe (with one condition)

The planned DDL:
```sql
ALTER TABLE runs ADD COLUMN runner TEXT DEFAULT 'claude-agent-sdk';
```
Postgres adds a column with a constant DEFAULT without a table rewrite (PG11+). This
acquires a brief `ACCESS EXCLUSIVE` lock on `runs`, then releases it. Old code reading
`runs` rows will simply not select the new column — safe. New code reading old rows
will get the default value `'claude-agent-sdk'` — safe.

The condition: do NOT add `NOT NULL` without a `DEFAULT` in the same statement. The
plan already omits `NOT NULL`, so this is fine. Do not change it.

### Finding 3: Snapshot refresh is a single point of failure for BOTH runners

If `refreshSdkSnapshot()` fails after this change, the fallback fresh-install path
runs `npm install` inside the sandbox at execution time. That install covers both SDKs
only if the runner script requests them. Verify the fallback `package.json` in the
sandbox template lists both `@anthropic-ai/claude-agent-sdk` and `ai @ai-sdk/mcp`.
If it lists only the Claude SDK, non-Claude runs will fail silently after a snapshot
miss.

### Finding 4: A2A Agent Cards are safe during rollout

Agent Cards are built from the `agents` table columns `a2a_enabled`, `slug`, `model`,
`name`, `description`. None of these change in this migration. The Card cache (60s TTL,
process-level) will serve stale-but-valid cards during Vercel's rolling deploy. No
card content changes until an admin edits an agent to use a non-Claude model.

### Finding 5: `isClaudeModel()` must treat bare model names (no `/`) as Claude

Existing agents store bare model names like `claude-sonnet-4-6`. The proposed
implementation (`!model.includes('/') || model.startsWith('anthropic/')`) handles this
correctly. Any deviation will route existing agents to the wrong runner.

---

## Pre-Deploy Audits (Run Before Merging)

Save all output from these queries. Any unexpected result is a STOP condition.

```sql
-- 1. Baseline run counts by status (compare post-deploy)
SELECT status, COUNT(*) FROM runs GROUP BY status ORDER BY status;

-- 2. Confirm runner column does not already exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'runs' AND column_name = 'runner';
-- Expected: 0 rows

-- 3. Confirm migration 019 is the latest applied
SELECT filename FROM schema_migrations ORDER BY applied_at DESC LIMIT 3;
-- Expected: 019_add_agent_slug.sql is most recent

-- 4. All agents that are currently a2a_enabled (card validity baseline)
SELECT id, name, slug, model, a2a_enabled
FROM agents WHERE a2a_enabled = true ORDER BY created_at;
-- Save this list. Post-deploy: same rows must exist with identical slug/model.

-- 5. Count of agents with bare model names vs prefixed
SELECT
  CASE WHEN model LIKE '%/%' THEN 'prefixed' ELSE 'bare' END AS model_type,
  COUNT(*) AS count
FROM agents GROUP BY 1;
-- Expected: all existing agents are 'bare' (e.g. claude-sonnet-4-6)
-- Any 'prefixed' rows are unexpected and need investigation before deploy.

-- 6. Active and running runs (must drain before deploy if possible)
SELECT status, COUNT(*) FROM runs
WHERE status IN ('pending', 'running') GROUP BY status;
-- Ideal: 0 rows. If not, wait for active runs to complete or accept brief interruption.

-- 7. Active sessions
SELECT status, COUNT(*) FROM sessions
WHERE status NOT IN ('stopped') GROUP BY status;
-- Document count. Active sessions will survive deploy (sandbox stays alive independently).
```

---

## Migration Steps (Automated via Build)

| Step | Action | Runtime | Reversible |
|------|--------|---------|------------|
| 1 | Vercel build triggers `npm run migrate` | <1 min | Yes — drop column |
| 2 | `020_add_runner_column.sql` executes `ALTER TABLE runs ADD COLUMN runner TEXT DEFAULT 'claude-agent-sdk'` | <5 sec (no table rewrite) | Yes |
| 3 | Next.js build compiles new code | 2-4 min | N/A — rollback via revert commit |
| 4 | Vercel promotes new deployment | <1 min | Yes — instant rollback in Vercel dashboard |

The migration file to create before merging:

```sql
-- 020_add_runner_column.sql
-- Safe: Postgres adds column with constant DEFAULT without table rewrite (PG11+).
-- No NOT NULL constraint — existing rows get default 'claude-agent-sdk' implicitly.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS runner TEXT DEFAULT 'claude-agent-sdk';
```

---

## Snapshot Refresh Risk

The daily cron at `POST /api/cron/refresh-snapshot` must install both SDKs in the
new snapshot. If this cron runs BEFORE the new code deploys, the old snapshot
(Claude SDK only) remains active. Non-Claude runs will fall back to fresh install
inside the sandbox — slower but functional, provided the fallback package list is
updated.

Mitigation steps (do these before or immediately after deploy):

- [ ] Manually trigger `POST /api/cron/refresh-snapshot` after deploy completes
- [ ] Confirm new snapshot ID appears in Vercel function logs
- [ ] Confirm snapshot creation log shows both `@anthropic-ai/claude-agent-sdk` and
      `ai @ai-sdk/mcp` installed without errors
- [ ] If snapshot refresh fails: non-Claude runs are degraded (slow cold start) but
      Claude runs are unaffected (old snapshot still valid for them)

---

## Go/No-Go Checklist

### Pre-Deploy (Required)

- [ ] Migration file named `020_add_runner_column.sql` (not 018)
- [ ] Migration file uses `ADD COLUMN IF NOT EXISTS` (idempotent)
- [ ] `isClaudeModel()` unit tests pass: bare names → true, prefixed non-anthropic → false
- [ ] Fallback sandbox `package.json` lists both `@anthropic-ai/claude-agent-sdk` and `ai @ai-sdk/mcp`
- [ ] Baseline SQL queries above executed and values saved
- [ ] No active runs in `pending`/`running` state (or accepted risk documented)
- [ ] Staging deploy tested with a non-Claude agent run end-to-end
- [ ] Existing Claude agent run tested on staging after the change
- [ ] A2A `message/stream` tested on staging with a Claude agent (A2A card must remain valid)
- [ ] `parseResultEvent()` handles `cost_usd: null` without throwing
- [ ] `runner` field extracted and stored correctly in `finalizeRun()`

### Deploy Steps

1. [ ] Merge feat branch to main
2. [ ] Vercel auto-deploy triggers — watch build logs for migration success
3. [ ] Confirm migration log line: `Applied: 020_add_runner_column.sql`
4. [ ] Confirm Next.js build completes without type errors
5. [ ] Verify Vercel deployment promoted to production

### Post-Deploy (Within 5 Minutes)

```sql
-- 1. Confirm column exists with correct default
SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'runs' AND column_name = 'runner';
-- Expected: column_default = 'claude-agent-sdk', is_nullable = YES

-- 2. Spot-check recent runs got the default
SELECT id, status, runner, triggered_by, created_at
FROM runs ORDER BY created_at DESC LIMIT 10;
-- Expected: runner = 'claude-agent-sdk' for all existing rows

-- 3. Confirm run counts match pre-deploy baseline
SELECT status, COUNT(*) FROM runs GROUP BY status ORDER BY status;
-- Compare with saved pre-deploy values. Counts may have grown (new runs) but no
-- status should have decreased.

-- 4. Confirm A2A agents unchanged
SELECT id, name, slug, model, a2a_enabled
FROM agents WHERE a2a_enabled = true ORDER BY created_at;
-- Must match pre-deploy list exactly.

-- 5. Confirm no runs failed mid-migration
SELECT COUNT(*) FROM runs WHERE status = 'failed'
AND created_at > NOW() - INTERVAL '10 minutes';
-- Expected: same or lower than normal baseline failure rate.
```

Functional checks:

- [ ] Trigger a Claude agent run via API → verify `runner = 'claude-agent-sdk'` in DB
- [ ] Trigger a non-Claude agent run (if any exist) → verify `runner = 'vercel-ai-sdk'` in DB
- [ ] Check admin runs page → `runner` badge renders without JS errors
- [ ] A2A Agent Card fetch for an enabled agent returns 200 with unchanged structure
- [ ] Check Vercel function error rate dashboard — no spike in 5xx errors

---

## Rollback Plan

Can we roll back? YES — the column addition is fully reversible and code is deployed
via Vercel instant rollback.

**Rollback trigger:** Any of the following in the first 30 minutes post-deploy:
- Existing Claude runs failing at >2% error rate
- A2A Agent Cards returning 500
- `runner` column causing query errors (unexpected type mismatch)
- Snapshot refresh failure causing all new runs to fail

**Rollback steps:**

1. [ ] In Vercel dashboard: "Instant Rollback" to previous deployment (takes <1 min)
2. [ ] Old code does not reference `runner` column — reads will simply ignore it
3. [ ] No data restoration needed — `DEFAULT 'claude-agent-sdk'` means no nulls exist
4. [ ] Optionally drop the column after rollback (non-urgent, old code ignores it):
   ```sql
   ALTER TABLE runs DROP COLUMN IF EXISTS runner;
   ```
5. [ ] Re-run post-deploy SQL checks above to confirm baseline restored
6. [ ] Investigate root cause before re-attempting deploy

---

## Post-Deploy Monitoring (First 24 Hours)

| What to watch | Condition to act | Where |
|---|---|---|
| Vercel function error rate | >1% sustained for 5 min | Vercel dashboard > Functions |
| Run `status = 'failed'` rate | >normal baseline | DB query #5 above, re-run hourly |
| Snapshot cron success | Cron logs show error | Vercel dashboard > Cron |
| Non-Claude run completion | First non-Claude run fails | Admin runs page, filter by runner badge |
| A2A task errors | Any 500 from A2A JSON-RPC | Vercel function logs |
| Session idle/stuck watchdog | Unusual spike in stopped sessions | DB: `SELECT status, COUNT(*) FROM sessions GROUP BY status` |

Console verification at +1 hour:

```sql
-- Verify runner column distribution (once non-Claude runs exist)
SELECT runner, COUNT(*) FROM runs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY runner;

-- Verify no NULL runner values slipped through
SELECT COUNT(*) FROM runs WHERE runner IS NULL;
-- Expected: 0
```

---

## Phase Rollout Recommendation

Given the dual-runner architecture is a significant new code path, the following
phased rollout reduces blast radius:

1. Deploy migration + code with `isClaudeModel()` routing (Phase 1 only) — all
   existing agents continue using Claude SDK, new column added.
2. Manually trigger snapshot refresh. Confirm both SDKs installed.
3. Create ONE internal test agent with `openai/gpt-4o`. Run it. Verify full event
   stream, transcript, billing.
4. Enable non-Claude model selection in Admin UI (Phase 5) only after Phase 1-4
   verified stable for 24 hours.
5. Enable A2A for non-Claude agents (Phase 6) only after sessions (Phase 3) stable.
