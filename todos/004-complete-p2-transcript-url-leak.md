---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, security]
dependencies: []
---

# Transcript blob URL leaked in A2A task metadata

## Problem Statement

`runToA2aTask()` in `src/lib/a2a.ts` (lines 164-170) exposes the raw Vercel Blob URL for run transcripts in A2A task metadata. Vercel Blob URLs are publicly accessible (no auth required). Any authenticated A2A consumer who calls `tasks/get` gains direct access to the full transcript, which may contain tool outputs, internal reasoning, and sensitive data not included in `result_summary`.

## Findings

- **Security Sentinel**: Flagged as Medium — full transcript disclosure bypassing access controls

## Proposed Solutions

### Option A: Remove transcript URL from metadata (Recommended)
Remove the `transcript_blob_url` field from A2A task metadata entirely. Only expose `duration_ms`.

**Pros**: Simple, eliminates the leak
**Cons**: Consumers lose transcript access
**Effort**: Small
**Risk**: Low

## Technical Details

- **Affected files**: `src/lib/a2a.ts` lines 164-170

## Acceptance Criteria

- [ ] `transcript_blob_url` is not included in A2A task metadata
- [ ] `duration_ms` still available if useful

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-10 | Created from code review | Blob URLs are public by default |
