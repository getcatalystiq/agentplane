---
status: complete
priority: p3
issue_id: "011"
tags: [code-review, testing]
dependencies: []
---

# Missing tests for `runToA2aTask` and `cancelTask` error path

## Problem Statement

`runToA2aTask` is a pure mapping function that is easy to test but has zero coverage. Edge cases: completed run with result, failed run, pending run, run without transcript. Additionally, `cancelTask` silently swallows errors without publishing a failure event.

## Proposed Solutions

Add test cases for `runToA2aTask` covering all status variants and artifact conditions.

**Effort**: Small | **Risk**: Low

## Technical Details

- **Affected files**: `tests/unit/a2a.test.ts`, `src/lib/a2a.ts`

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-10 | Created from code review | Pure functions should always be tested |
