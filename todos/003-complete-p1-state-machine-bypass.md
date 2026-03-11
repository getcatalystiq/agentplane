---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, architecture, data-integrity]
dependencies: []
---

# RunBackedTaskStore.save() bypasses run state machine

## Problem Statement

`RunBackedTaskStore.save()` performs a raw `UPDATE runs SET status = $1 WHERE id = $2 AND tenant_id = $3` that bypasses:

1. `VALID_TRANSITIONS` state machine checks from `src/lib/types.ts`
2. Billing updates (`cost_usd`, token counts)
3. Structured transition logging

The A2A SDK calls `save()` on every event (50-200 per run). If the SDK sends an unexpected status (e.g., transitioning back from `completed` to `working`), the raw UPDATE would succeed.

Additionally, ~95% of these UPDATEs are no-ops writing the same status value, creating unnecessary DB load.

## Findings

- **Architecture Strategist**: State machine bypass is MEDIUM RISK — data integrity issue
- **Performance Oracle**: Redundant UPDATE storm — 50-200 writes per run, ~98% no-ops

## Proposed Solutions

### Option A: Add terminal state guard + last-status tracking (Recommended)
1. Add `AND status NOT IN ('completed', 'failed', 'cancelled', 'timed_out')` to UPDATE query
2. Track `lastWrittenStatus` in memory, skip DB call when unchanged

**Pros**: Prevents terminal overwrite, eliminates ~98% of DB calls
**Cons**: Still doesn't use `VALID_TRANSITIONS`
**Effort**: Small
**Risk**: Low

### Option B: Full state machine integration
Route status changes through `transitionRunStatus()`.

**Pros**: Full consistency with existing patterns
**Cons**: `transitionRunStatus` does billing which conflicts with `finalizeRun()`
**Effort**: Medium
**Risk**: Medium — could cause double-billing

## Technical Details

- **Affected files**: `src/lib/a2a.ts` (RunBackedTaskStore.save, lines 218-240)

## Acceptance Criteria

- [ ] Terminal run states cannot be overwritten by subsequent save() calls
- [ ] Redundant no-op UPDATEs are skipped (last-status tracking)
- [ ] DB calls reduced from ~200 to ~3 per run

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-10 | Created from code review | State machine + performance dual concern |
