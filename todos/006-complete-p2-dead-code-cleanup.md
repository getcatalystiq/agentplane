---
status: complete
priority: p2
issue_id: "006"
tags: [code-review, quality, dead-code]
dependencies: []
---

# Dead code and unused references cleanup

## Problem Statement

Multiple dead code issues identified across review agents:

1. **`void requestedMaxBudget` block** (jsonrpc/route.ts:129-138) — budget extracted, discarded, re-extracted at lines 179-182
2. **Unused `checkTenantBudget` import** (jsonrpc/route.ts:14) — imported but never called
3. **Unused `resolveAgent` in ExecutorDeps** (a2a.ts:249) — declared, passed as `async () => null`, never called
4. **Unused `sandbox` and `transcriptChunks` destructuring** (a2a.ts:316) — destructured but never used (related to #001)
5. **Unused `ValidationError` import** (jsonrpc/route.ts:12)
6. **`as never` cast** (jsonrpc/route.ts:115) — should be `as Message` or properly typed
7. **Cache parameter named `tenantId` but receives `slug`** (a2a.ts:60,67) — misleading name

## Findings

- **TypeScript Reviewer**: Items 1-5, 6
- **Code Simplicity Reviewer**: Items 1, 3, 4
- **Architecture Strategist**: Item 1

## Proposed Solutions

### Option A: Clean all in one pass (Recommended)

**Effort**: Small
**Risk**: Low

## Technical Details

- **Affected files**: `src/app/api/a2a/[slug]/jsonrpc/route.ts`, `src/lib/a2a.ts`

## Acceptance Criteria

- [ ] Remove dead `void requestedMaxBudget` block (lines 129-138)
- [ ] Remove or use `checkTenantBudget` import
- [ ] Remove `resolveAgent` from `ExecutorDeps` interface and callsite
- [ ] Fix `sandbox`/`transcriptChunks` destructuring (depends on #001)
- [ ] Remove unused `ValidationError` import
- [ ] Replace `as never` with `as Message` or proper typing
- [ ] Rename cache parameter from `tenantId` to `slug`/`cacheKey`

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-10 | Created from code review | Multiple agents flagged overlapping dead code |
