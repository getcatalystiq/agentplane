---
title: "Fix captureTranscript truncation losing result/error events and text_delta bloat"
category: logic-errors
tags:
  - transcript
  - streaming
  - async-generator
  - billing
  - run-execution
  - data-loss
  - refactoring-regression
  - batch-sql
  - code-splitting
modules:
  - src/lib/run-executor.ts
  - src/app/api/cron/scheduled-runs/route.ts
  - src/lib/timezone.ts
  - src/lib/schedule.ts
symptoms:
  - "result and error events discarded after MAX_TRANSCRIPT_EVENTS cap, causing finalizeRun to miss billing/token data"
  - "text_delta events stored in transcript chunks, bloating Vercel Blob transcript storage"
  - "stuck-job reaper issuing N+1 individual UPDATE queries instead of batch operation"
  - "client components importing schedule.ts pull in server-only croner dependency"
root_causes:
  - "captureTranscript truncation logic unconditionally stopped appending to chunks[] after cap, with no exemption for critical event types"
  - "refactored captureTranscript generator lost the text_delta exclusion filter present in the original inline implementation"
  - "scheduled-runs cron used per-agent UPDATE loop instead of batch unnest() operation"
  - "isValidTimezone co-located in schedule.ts alongside croner imports, breaking code splitting boundary"
date: 2026-03-07
---

# Fix captureTranscript truncation and streaming behavior

## Problem Statement

After refactoring run execution into `src/lib/run-executor.ts`, the `captureTranscript` async generator had two behavioral bugs and one performance issue:

1. **Truncation data loss**: After hitting `MAX_TRANSCRIPT_EVENTS` (10,000), all subsequent events were yielded but never stored in `chunks[]`. The `result` event (containing `cost_usd`, `num_turns`, `duration_ms`, token usage) is always emitted last by Claude Agent SDK. For long runs, this meant `finalizeRun` found no billing data.

2. **text_delta bloat**: `text_delta` events (high-frequency incremental text fragments for real-time streaming) were being stored in `chunks[]`, inflating transcript size and pushing runs toward the truncation limit faster.

3. **N+1 stuck-job reaper**: The cron route updated each stuck agent with individual UPDATE queries.

4. **Client bundle pollution**: `isValidTimezone()` lived in `schedule.ts` alongside `croner` imports, pulling server-only code into client bundles.

## Root Cause Analysis

### 1. Transcript truncation

The truncation logic set a `truncated = true` flag after reaching the cap, then unconditionally yielded all subsequent lines without storing them. There was no distinction between "normal" events that can be safely dropped and "critical" events (`result`, `error`) that must always be captured for run finalization.

### 2. text_delta regression

The original inline streaming code excluded `text_delta` from transcript storage. When refactored into the `captureTranscript` generator, this exclusion was not carried over. The generator treated all non-empty lines identically: process assets, store in chunks, yield.

### 3. N+1 updates

Standard loop-with-individual-query anti-pattern. Each stuck agent got its own `UPDATE agents SET schedule_next_run_at = $1 WHERE id = $2`.

### 4. Code splitting

`isValidTimezone` used only the browser-native `Intl.DateTimeFormat` API but was co-located with functions that import `croner`. Any client component importing the function transitively pulled in the server-only dependency.

## Working Solution

### captureTranscript (src/lib/run-executor.ts)

**Post-truncation: preserve critical events**

```typescript
if (truncated) {
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.type === "result" || parsed.type === "error") {
      const processed = await processLineAssets(trimmed, tenantId, runId);
      chunks.push(processed);
      yield processed;
      continue;
    }
  } catch { }
  yield trimmed; // non-critical: yield for streaming, don't store
}
```

**Pre-truncation: exclude text_delta from storage**

```typescript
const isTextDelta = (() => {
  try { return JSON.parse(processed).type === "text_delta"; }
  catch { return false; }
})();
if (isTextDelta) {
  yield processed; // stream to client
  continue;        // don't store in chunks
}
```

**Design decisions:**
- Asset processing still runs on `result`/`error` events post-truncation (they can contain URLs needing persistence)
- Non-result events skip `processLineAssets` post-truncation (efficiency)
- `text_delta` still gets asset processing pre-truncation (defensive), but is never stored

### Batch stuck-job reaper (src/app/api/cron/scheduled-runs/route.ts)

```sql
UPDATE agents SET schedule_next_run_at = v.next_run_at::timestamptz
FROM unnest($1::uuid[], $2::text[]) AS v(id, next_run_at)
WHERE agents.id = v.id
```

Recompute failures push `null` instead of silently skipping, preventing infinite reaper loops. Errors logged at `error` level with agent ID context.

### Client/server code splitting (src/lib/timezone.ts)

```typescript
// src/lib/timezone.ts - zero dependencies, browser-safe
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
```

`schedule.ts` re-exports for backward compatibility: `export { isValidTimezone } from "@/lib/timezone"`.

## Test Coverage

Tests in `tests/unit/run-executor.test.ts`:

| Test | What it verifies |
|------|-----------------|
| basic transcript capture | Lines stored in chunks and yielded |
| excludes text_delta from chunks | text_delta yielded but not stored |
| truncation with system marker | System message appended at cap |
| preserves result after truncation | Result event stored even post-cap |
| preserves error after truncation | Error event stored even post-cap |
| discards non-result after truncation | tool_use/tool_result not stored post-cap |
| empty line handling | Empty lines yielded, not stored |

## Prevention Strategies

### Event type matrix for streaming pipelines

When modifying `captureTranscript` or any generator that both yields and stores events, verify behavior for every event type:

| Event type | Yield (stream)? | Store (transcript)? | Asset process? |
|-----------|-----------------|---------------------|----------------|
| assistant | Yes | Yes | Yes |
| tool_use | Yes | Yes (pre-truncation) | Yes |
| tool_result | Yes | Yes (pre-truncation) | Yes |
| text_delta | Yes | **No** | Yes (pre-truncation) |
| result | Yes | **Always** | **Always** |
| error | Yes | **Always** | **Always** |
| system | Yes | Yes | No |

### Code review checklist

- [ ] **Transcript integrity**: Are `result` and `error` events always captured, even after truncation?
- [ ] **Yield vs. store**: Are `text_delta` events yielded but not stored?
- [ ] **New event types**: Explicitly decide storage behavior and add test case
- [ ] **Batch SQL**: Any loop with SQL inside should use `unnest()` or `VALUES` batching
- [ ] **Silent failures**: Are per-item errors in batch operations logged, not skipped?
- [ ] **Client/server boundary**: Do client-importable files avoid server-only transitive dependencies?

### General principles

1. **Bounded buffers need allowlists**: Any truncation/cap mechanism should have an explicit list of event types that bypass the limit.
2. **Refactor with an event matrix**: Before refactoring streaming code, enumerate all event types and their expected behaviors. Verify each after refactoring.
3. **Batch by default**: Default to `unnest()` batch SQL for collection operations. Handle per-item failures explicitly.
4. **Separate by dependency**: Keep browser-safe utilities in files with zero server-only imports. Use `import 'server-only'` as a guardrail.

## Related Files

- `src/lib/run-executor.ts` - captureTranscript generator, run execution
- `src/lib/streaming.ts` - SSE/NDJSON streaming, heartbeats, stream detach
- `src/lib/sandbox.ts` - Sandbox creation, text_delta emission
- `src/app/api/cron/scheduled-runs/route.ts` - Cron job, stuck-job reaper
- `src/lib/timezone.ts` - Browser-safe timezone validation
- `tests/unit/run-executor.test.ts` - Test coverage for transcript behavior
- `docs/plans/2026-03-07-feat-scheduled-agent-runs-plan.md` - Feature plan
