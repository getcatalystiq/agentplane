---
status: complete
priority: p3
issue_id: "009"
tags: [code-review, quality, performance]
dependencies: []
---

# Noisy text_delta → status-update mapping in streaming

## Problem Statement

When a `text_delta` event arrives in `SandboxAgentExecutor.execute()`, the code publishes a `status-update` with `state: "working"` and `final: false` (lines 332-340). This is identical to the initial "working" status already published at line 267. Sending ~100+ identical status updates per run is pure noise.

## Proposed Solutions

Remove the `text_delta` branch entirely. Only handle `result` events.

**Effort**: Small | **Risk**: Low | ~9 lines removed

## Technical Details

- **Affected files**: `src/lib/a2a.ts` lines 332-340

## Acceptance Criteria

- [ ] text_delta events do not produce redundant status-update publishes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-10 | Created from code review | Reduces event volume ~100x |
