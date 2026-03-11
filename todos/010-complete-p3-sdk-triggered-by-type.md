---
status: complete
priority: p3
issue_id: "010"
tags: [code-review, quality, sdk]
dependencies: []
---

# SDK `triggered_by` should be a union type, not `string`

## Problem Statement

In `sdk/src/types.ts`, `triggered_by` on `Run` (line 106) and `ListRunsParams` (line 125) is typed as `string`. The server-side `RunTriggeredBy` is `"api" | "schedule" | "playground" | "chat" | "a2a"`. SDK consumers lose type safety.

## Proposed Solutions

```typescript
export type RunTriggeredBy = "api" | "schedule" | "playground" | "chat" | "a2a";
// Use in Run.triggered_by and ListRunsParams.triggered_by
```

**Effort**: Small | **Risk**: Low

## Technical Details

- **Affected files**: `sdk/src/types.ts` lines 106, 125

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-10 | Created from code review | Type-safe SDK filtering |
