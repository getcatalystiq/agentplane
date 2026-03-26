---
date: 2026-03-26
topic: live-run-streaming
---

# Live Run Streaming in Admin UI

## Problem Frame
When an agent run is in progress, the admin UI shows no live feedback — users see the full transcript only after the run completes. For runs that take minutes (up to 10 min max runtime), this creates a blind spot. Admins can't tell what the agent is doing, whether it's stuck, or how far along it is.

## Requirements

- R1. **Live transcript on run detail page** — When viewing an in-progress run, events (`assistant`, `tool_use`, `tool_result`, `text_delta`, `system`, etc.) stream into the transcript viewer incrementally, using the same visual format as the existing `TranscriptViewer`.
- R2. **Auto-scroll** — The transcript auto-scrolls to the latest event as they arrive. If the user scrolls up manually, auto-scroll pauses until they scroll back to the bottom.
- R3. **Seamless transition** — When the run completes (terminal `result` or `error` event), the live view transitions seamlessly into the final transcript view (metadata cards update with final cost, turns, duration, tokens).
- R4. **Stream reconnection** — If the initial NDJSON stream detaches (>4.5 min), the UI automatically reconnects via `GET /api/runs/[runId]/stream` with the correct offset to continue from where it left off.
- R5. **Runs list auto-refresh** — The runs list page polls every 5 seconds while any visible run is in-progress. Status badges, duration, and cost update in place. Polling stops when all visible runs are in a terminal state.
- R6. **Toast notifications** — When a run transitions to `completed` or `failed`, show a toast notification with the run ID (or agent name) and status. Clicking the toast navigates to the run detail page.
- R7. **Completed run behavior** — When opening a run that is already completed, display the transcript as today (no streaming, just fetch and render).

## Success Criteria
- An admin can open an in-progress run and watch events appear in real-time
- The runs list page reflects status changes within ~5 seconds without manual refresh
- Toast notifications alert admins to run completions/failures without needing to watch the page
- No regression in the completed-run transcript viewing experience

## Scope Boundaries
- No changes to the backend streaming infrastructure (NDJSON, heartbeats, detach/reconnect already exist)
- No live streaming for sessions (separate concern, different UX)
- No persistent notification system (toasts are ephemeral, in-browser only)
- Playground and external API consumers are out of scope — this is admin UI only

## Key Decisions
- **Incremental append UX**: Events render in the same `TranscriptViewer` format as they arrive, not a separate log view. This reuses existing components and provides visual consistency.
- **Polling for list updates**: 5-second polling is simpler than SSE and adequate for a status list. Avoids adding a new SSE endpoint.
- **Toast on completion**: Lightweight way to notify without requiring the user to stare at the list page.

## Dependencies / Assumptions
- The existing `/api/runs/[runId]/stream` reconnect endpoint works correctly for admin-authenticated requests (JWT cookie auth)
- The existing NDJSON stream from run creation (`POST /api/runs`) can be consumed by the admin UI via the admin run-creation flow or by connecting to a running run's stream endpoint

## Outstanding Questions

### Deferred to Planning
- [Affects R1][Technical] How to connect to an already-running run's NDJSON stream from the admin detail page — the initial stream is returned from `POST /api/runs`, but admin navigates to the detail page separately. Likely need to use `GET /api/runs/[runId]/stream?offset=0` for admin consumption.
- [Affects R4][Technical] Verify that the `/api/runs/[runId]/stream` endpoint supports admin JWT auth (not just API key auth).
- [Affects R6][Technical] Choose a toast library or implement lightweight toast component (the admin UI may already have one via Radix/shadcn primitives).
- [Affects R5][Technical] Determine whether polling should be scoped to just the visible page or if a global in-progress run count should be tracked.

## Next Steps
→ `/ce:plan` for structured implementation planning
