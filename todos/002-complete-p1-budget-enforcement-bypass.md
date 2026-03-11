---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, security, correctness]
dependencies: []
---

# Budget enforcement bypass — suspended tenants can trigger A2A runs

## Problem Statement

`checkTenantBudget` is imported in `jsonrpc/route.ts` (line 14) but never called. The route manually queries tenant budget info and computes `remainingBudget` (lines 142-156), but this only does arithmetic — it does NOT:

1. Throw `ForbiddenError` if tenant is suspended
2. Throw `BudgetExceededError` if tenant is over budget

A suspended tenant or one over their monthly budget can still trigger A2A runs.

The existing run creation path in `createRun()` (`src/lib/runs.ts`) calls `checkTenantBudget()` inside a transaction, which properly enforces both checks.

## Findings

- **TypeScript Reviewer**: Flagged as Critical bug — unused import with functional regression
- **Architecture Strategist**: Route bypasses existing budget enforcement pattern

## Proposed Solutions

### Option A: Add explicit budget/suspension checks (Recommended)
Before creating SDK components, check `tenant.status !== 'active'` and `remainingBudget <= 0`. Return JSON-RPC error.

**Pros**: Simple, explicit, keeps existing query structure
**Cons**: Duplicates logic from `checkTenantBudget`
**Effort**: Small
**Risk**: Low

### Option B: Remove manual query, call `checkTenantBudget`
Use the existing transactional check. Would need to adapt for HTTP driver context.

**Pros**: DRY, consistent with existing pattern
**Cons**: `checkTenantBudget` expects a transaction context, not HTTP driver
**Effort**: Medium
**Risk**: Low

## Technical Details

- **Affected files**: `src/app/api/a2a/[slug]/jsonrpc/route.ts` (lines 14, 142-156)
- **Reference**: `src/lib/runs.ts` lines 28-46 (`checkTenantBudget`)

## Acceptance Criteria

- [ ] Suspended tenants receive JSON-RPC error when calling A2A endpoints
- [ ] Over-budget tenants receive JSON-RPC error when calling A2A endpoints
- [ ] Remove unused `checkTenantBudget` import (or use it)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-10 | Created from code review | Budget enforcement is critical path |
