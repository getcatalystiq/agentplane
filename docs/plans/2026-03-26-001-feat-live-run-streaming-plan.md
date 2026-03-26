---
title: "feat: Live run streaming across SDK, UI package, and admin app"
type: feat
status: completed
date: 2026-03-26
origin: docs/brainstorms/2026-03-26-live-run-streaming-requirements.md
---

# feat: Live Run Streaming across SDK, UI Package, and Admin App

## Overview

Add real-time NDJSON streaming to run views so in-progress runs show events as they happen. Built as a layered feature across three packages so any consumer (admin app, embeddable UI, SDK users) can use it:

1. **SDK** (`sdk/`) — new `runs.stream(runId)` method + tenant-scoped stream API endpoint
2. **UI package** (`ui/`) — `useRunStream` hook, toast component, live `RunDetailPage` and polling `RunListPage`
3. **Admin app** (`src/app/admin/`) — consumes UI package components with minimal wiring

## Problem Frame

When an agent run is in progress, the admin UI shows no live feedback — admins see the full transcript only after the run completes. For runs that take up to 10 minutes, this creates a blind spot. The same limitation affects any consumer of the UI package. (see origin: docs/brainstorms/2026-03-26-live-run-streaming-requirements.md)

## Requirements Trace

- R1. Live transcript on run detail page — events stream incrementally into TranscriptViewer
- R2. Auto-scroll with manual override (pause when user scrolls up)
- R3. Seamless transition from live to completed view (metadata cards update)
- R4. Stream reconnection after detach (>4.5 min)
- R5. Runs list auto-refresh via 5s polling
- R6. Toast notifications on run completion/failure
- R7. Completed run behavior unchanged

## Scope Boundaries

- No live streaming for sessions (separate concern, different UX)
- No persistent notification system (toasts are ephemeral, in-browser only)
- Playground is out of scope for this plan (already has its own streaming)

## Context & Research

### Relevant Code and Patterns

**SDK layer:**
- `sdk/src/streaming.ts` — `parseNdjsonStream()` and `RunStream` class already exist; `RunStream` filters heartbeats, handles `stream_detached`, supports abort
- `sdk/src/resources/runs.ts` — has `create()` (streams from creation), `createAndWait()`, `transcript()`, `transcriptArray()`; **missing**: no method to stream an already-running run
- `sdk/src/types.ts` — `StreamEvent` union type, `narrowStreamEvent()` helper

**API layer:**
- `src/app/api/admin/runs/[runId]/stream/route.ts` — admin-only stream reconnect endpoint; polls sandbox `transcript.ndjson` every 2s, heartbeats, detach after 285s, supports `?offset=N`; handles completed runs by serving from blob
- **No tenant-scoped stream endpoint exists** — need to create `src/app/api/runs/[runId]/stream/route.ts`

**UI package layer:**
- `ui/src/components/pages/run-detail-page.tsx` — client component using `useApi` (SWR) to fetch run + `transcriptArray()` for transcript; renders `TranscriptViewer`
- `ui/src/components/pages/run-list-page.tsx` — client component using `useApi` for paginated run list
- `ui/src/components/pages/transcript-viewer.tsx` — `buildConversation()` + `ConversationView`; accepts `TranscriptEvent[]` prop
- `ui/src/hooks/use-api.ts` — SWR wrapper injecting SDK client
- `ui/src/hooks/use-client.ts` — `useAgentPlaneClient()` context hook

**Admin app layer:**
- `src/app/admin/(dashboard)/runs/[runId]/page.tsx` — server component, fetches run + transcript, passes to `TranscriptViewer`
- `src/app/admin/(dashboard)/runs/page.tsx` — server component, runs list with pagination
- `src/app/admin/lib/api.ts` — `adminFetch<T>()` and `adminStream()` helpers

### Institutional Learnings

- `text_delta` events are stream-only (never stored in transcript) — the live viewer should render them for real-time text display, then drop when full `assistant` event arrives
- `result` and `error` are terminal events that must never be dropped
- Browser-importable code must not transitively import server-only dependencies (follow `timezone.ts` extraction pattern)

## Key Technical Decisions

- **Three-layer architecture**: SDK method → UI hook → page component. Each layer is independently useful. SDK users can stream runs programmatically; UI package users get live components out of the box; admin app gets it for free.
- **New tenant-scoped stream endpoint**: `GET /api/runs/[runId]/stream` mirrors the admin endpoint with API key auth. Required so the SDK (and UI package) can stream runs without admin credentials.
- **SDK `runs.stream()` method**: Returns a `RunStream` (same class used by `create()`), reusing `parseNdjsonStream` and all existing streaming infrastructure.
- **`useRunStream` hook in UI package**: Uses SDK client's `runs.stream()` internally. Returns `{ events, isStreaming, terminalEvent }`. Lives in `ui/src/hooks/` so it's available to all page components and external consumers.
- **shadcn/ui toast in UI package**: Add toast primitives to `ui/src/components/ui/` so both UI package pages and admin app can use them. Uses `@radix-ui/react-toast` — consistent with existing Radix primitives.
- **SWR `refreshInterval` for list polling**: The UI package's `RunListPage` already uses `useApi` (SWR). Add `refreshInterval: 5000` conditionally when in-progress runs are visible — no custom polling logic needed.
- **Admin app minimal changes**: Admin server-component pages pass initial data to UI package client components. The UI package handles streaming, polling, and toasts internally.
- **`text_delta` handling**: Accumulate into a temporary streaming text block. When the next `assistant` event arrives, the accumulated text is replaced. Real-time display without duplication.

## Open Questions

### Resolved During Planning

- **How to connect to an already-running run**: New `GET /api/runs/[runId]/stream?offset=0` endpoint (tenant-scoped) + SDK `runs.stream(runId)` method. Admin endpoint already exists; tenant-scoped one mirrors it.
- **Auth**: Tenant-scoped endpoint uses API key auth (standard middleware). Admin endpoint uses JWT cookie auth (already working). UI package uses SDK client which handles auth.
- **Toast library**: shadcn/ui toast (`@radix-ui/react-toast`) in the UI package — consistent with existing Radix primitives.
- **Polling mechanism**: SWR `refreshInterval` — already used by the UI package for data fetching; conditionally enabled.

### Deferred to Implementation

- Exact `text_delta` accumulation and replacement logic — depends on seeing real streaming behavior from both runners
- Whether to show a "streaming" indicator animation on tool calls that haven't received output yet

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌─────────────────────────────────────────────────────┐
│ SDK (@getcatalystiq/agent-plane)                    │
│                                                     │
│  runs.stream(runId, { offset?, signal? })           │
│    → GET /api/runs/{id}/stream?offset=N             │
│    → returns RunStream (existing class)             │
│                                                     │
│  parseNdjsonStream() ─── RunStream ─── StreamEvent  │
│  (all existing, reused)                             │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│ UI Package (@getcatalystiq/agent-plane-ui)          │
│                                                     │
│  hooks/use-run-stream.ts                            │
│    useRunStream(runId, status)                       │
│    → calls client.runs.stream(runId)                │
│    → returns { events[], isStreaming, terminal }     │
│                                                     │
│  components/ui/toast.tsx + toaster.tsx               │
│    useToast() hook + <Toaster /> component          │
│                                                     │
│  pages/run-detail-page.tsx (modified)               │
│    → if running: useRunStream() + auto-scroll       │
│    → if terminal: static transcript (unchanged)     │
│    → on completion: toast + update metrics           │
│                                                     │
│  pages/run-list-page.tsx (modified)                 │
│    → SWR refreshInterval: 5000 when has in-progress │
│    → on status transition: toast notification        │
│                                                     │
│  pages/transcript-viewer.tsx (modified)              │
│    → auto-scroll with manual override               │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│ Admin App (src/app/admin/)                          │
│                                                     │
│  layout.tsx → <Toaster /> (from UI package)         │
│  runs/[runId]/page.tsx → uses UI RunDetailPage      │
│  runs/page.tsx → uses UI RunListPage                │
│  (minimal wiring changes)                           │
└─────────────────────────────────────────────────────┘
```

## Implementation Units

- [ ] **Unit 1: Add tenant-scoped run stream endpoint**

**Goal:** Create `GET /api/runs/[runId]/stream` that mirrors the admin stream endpoint but with tenant-scoped API key auth.

**Requirements:** R1, R4

**Dependencies:** None

**Files:**
- Create: `src/app/api/runs/[runId]/stream/route.ts`

**Approach:**
- Mirror the logic from `src/app/api/admin/runs/[runId]/stream/route.ts`
- Use standard API key auth via `withErrorHandler` (same as other tenant-scoped routes)
- Add RLS tenant scoping to the run query (WHERE tenant_id matches authenticated tenant)
- Support `?offset=N` query param for reconnection
- Handle both running (poll sandbox) and completed (serve from blob) runs
- Heartbeats every 15s, detach after 285s
- Return `stream_detached` event with `poll_url` pointing to tenant-scoped path

**Patterns to follow:**
- `src/app/api/admin/runs/[runId]/stream/route.ts` — direct mirror with auth swap
- `src/app/api/runs/[runId]/route.ts` — existing tenant-scoped run route for auth pattern

**Test scenarios:**
- Streams events from a running sandbox with API key auth
- Returns blob transcript for completed runs
- Rejects requests for runs belonging to other tenants
- Reconnects with correct offset
- Returns 404 for non-existent runs

**Verification:**
- `curl -H "Authorization: Bearer <key>" /api/runs/<id>/stream` returns NDJSON events

---

- [ ] **Unit 2: Add `runs.stream()` method to SDK**

**Goal:** Add a `stream(runId, options?)` method to `RunsResource` that connects to the stream endpoint and returns a `RunStream`.

**Requirements:** R1, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `sdk/src/resources/runs.ts`
- Modify: `sdk/src/types.ts` (add `StreamRunOptions` if needed)
- Test: `sdk/tests/resources/runs.test.ts`

**Approach:**
- Add `stream(runId: string, options?: { offset?: number; signal?: AbortSignal })` method
- Calls `GET /api/runs/{runId}/stream?offset={offset}` via `this._client._requestStream()`
- Returns a `RunStream` instance (reuses existing class — heartbeat filtering, abort, async iterable all work)
- Pass `pollRun` and `fetchTranscript` callbacks (same as `create()`) for detach handling

**Patterns to follow:**
- `runs.create()` in `sdk/src/resources/runs.ts` — same `RunStream` construction pattern
- `runs.transcript()` — same `_requestStream` pattern for GET

**Test scenarios:**
- Returns a `RunStream` that yields `StreamEvent` objects
- Passes offset as query parameter
- Abort signal cancels the stream
- `stream_detached` event is yielded to consumer

**Verification:**
- `const stream = await client.runs.stream(runId); for await (const event of stream) { ... }` works

---

- [ ] **Unit 3: Add toast component to UI package**

**Goal:** Add shadcn/ui toast primitives to the UI package so toast notifications are available to all page components.

**Requirements:** R6

**Dependencies:** None

**Files:**
- Modify: `ui/package.json` (add `@radix-ui/react-toast`)
- Create: `ui/src/components/ui/toast.tsx` (shadcn toast primitives)
- Create: `ui/src/components/ui/toaster.tsx` (Toaster component)
- Create: `ui/src/hooks/use-toast.ts` (toast state hook)
- Modify: `ui/src/index.ts` (export toast, Toaster, useToast)

**Approach:**
- Install `@radix-ui/react-toast` in the UI package
- Scaffold shadcn/ui toast component set (ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription, ToastAction, ToastClose)
- Create `useToast` hook with `toast()` function for imperative use
- Create `<Toaster />` component that renders the toast viewport
- Style with Tailwind tokens to match dark mode and existing UI primitives
- Support variants: default, success, destructive
- Support action buttons (for "View run" navigation)

**Patterns to follow:**
- Existing UI primitives in `ui/src/components/ui/` (badge, button, card, dialog)
- shadcn/ui toast pattern (well-documented, widely used)

**Test scenarios:**
- Toast renders with correct dark mode styling
- Multiple toasts stack correctly
- Action button on toast is clickable
- Toast auto-dismisses after timeout

**Verification:**
- `toast({ title: "Run completed", variant: "success" })` shows a styled toast
- `<Toaster />` renders without errors

---

- [ ] **Unit 4: Create `useRunStream` hook in UI package**

**Goal:** Create a React hook that streams events from an in-progress run using the SDK client, handling reconnection and state management.

**Requirements:** R1, R4

**Dependencies:** Unit 2

**Files:**
- Create: `ui/src/hooks/use-run-stream.ts`
- Modify: `ui/src/hooks/index.ts` (export)

**Approach:**
- `useRunStream(runId: string | null, status: string)` — streams only when `status` is `running` or `pending`
- Uses `useAgentPlaneClient()` to get SDK client
- Calls `client.runs.stream(runId, { offset })` and iterates the `RunStream`
- Accumulates events into state array
- On `stream_detached`: reconnect with updated offset (RunStream handles this via `pollRun`/`fetchTranscript` callbacks, or we can reconnect manually with offset)
- On `result` or `error`: mark complete, expose terminal event data
- Cleanup: abort stream on unmount or when runId/status changes
- Return `{ events: StreamEvent[], isStreaming: boolean, terminalEvent: StreamEvent | null, error: Error | null }`
- Handle `text_delta` accumulation: maintain a `streamingText` string that grows with `text_delta` events; clear when `assistant` event arrives

**Patterns to follow:**
- `ui/src/hooks/use-api.ts` — hook using `useAgentPlaneClient()`
- `sdk/src/streaming.ts` — `RunStream` async iteration pattern

**Test scenarios:**
- Returns growing events array during active stream
- Stops streaming when status is terminal
- Reconnects after stream detach
- Cleans up on unmount
- Handles network errors gracefully
- Does not stream when status is already terminal (R7)

**Verification:**
- Hook returns live events when run is in-progress
- Hook returns empty events and `isStreaming: false` for completed runs

---

- [ ] **Unit 5: Add auto-scroll to UI package TranscriptViewer**

**Goal:** Add auto-scroll behavior to the transcript viewer that follows new events but pauses when the user scrolls up.

**Requirements:** R2

**Dependencies:** None

**Files:**
- Modify: `ui/src/components/pages/transcript-viewer.tsx`

**Approach:**
- Add optional `isStreaming` prop to `TranscriptViewer`
- Add a ref to the transcript container div
- Track whether user has scrolled away from bottom (within ~50px threshold)
- On new events (transcript prop length changes): if user is at bottom, scroll to bottom; if user scrolled up, don't auto-scroll
- When user scrolls back to bottom, re-enable auto-scroll
- Use `useEffect` watching `transcript.length` + a scroll event listener
- For static (completed) transcripts or when `isStreaming` is false, auto-scroll is a no-op
- Show a subtle "streaming..." indicator at the bottom when `isStreaming` is true

**Patterns to follow:**
- Standard React scroll-to-bottom pattern with `scrollHeight`, `scrollTop`, `clientHeight`

**Test scenarios:**
- New events cause auto-scroll when user is at bottom
- Scrolling up pauses auto-scroll
- Scrolling back to bottom resumes auto-scroll
- No scroll behavior on completed (static) transcripts
- Streaming indicator shows/hides based on `isStreaming` prop

**Verification:**
- Transcript follows new events during live streaming
- User can scroll up to review earlier events without being yanked back down

---

- [ ] **Unit 6: Add live streaming to UI package RunDetailPage**

**Goal:** Integrate `useRunStream` into the `RunDetailPage` component so in-progress runs show live events and seamlessly transition to completed state.

**Requirements:** R1, R3, R6, R7

**Dependencies:** Units 3, 4, 5

**Files:**
- Modify: `ui/src/components/pages/run-detail-page.tsx`

**Approach:**
- Call `useRunStream(runId, run.status)` — returns live events when run is in-progress
- For terminal runs: use existing `transcriptArray()` fetch (R7, unchanged)
- For in-progress runs: pass streamed events to `TranscriptViewer` with `isStreaming={true}`
- When terminal event arrives from stream:
  - Update displayed metrics (cost, turns, duration, tokens) from the terminal event (R3)
  - Mutate SWR cache to refresh run data (so metadata cards update)
  - Fire toast notification via `useToast()` (R6)
- Handle `text_delta` rendering: show accumulated streaming text as a temporary block below transcript

**Patterns to follow:**
- Existing `RunDetailPage` structure for layout and metric cards
- `useSWRConfig().mutate` for cache invalidation on completion

**Test scenarios:**
- Completed run renders identically to current behavior (R7)
- In-progress run shows streaming events appending live
- Metadata cards update when terminal event arrives
- Toast fires on completion/failure
- `text_delta` shows real-time text without duplication after assistant event

**Verification:**
- Opening a completed run shows static transcript
- Opening an in-progress run shows events appearing incrementally
- Metadata cards reflect final values after run completes

---

- [ ] **Unit 7: Add polling to UI package RunListPage**

**Goal:** Add auto-refresh to `RunListPage` so status, cost, and duration update in real-time for in-progress runs.

**Requirements:** R5, R6

**Dependencies:** Unit 3

**Files:**
- Modify: `ui/src/components/pages/run-list-page.tsx`

**Approach:**
- Track whether any run in the current page has status `running` or `pending`
- When in-progress runs exist, set SWR `refreshInterval: 5000` to auto-refetch
- When all runs are terminal, set `refreshInterval: 0` (disabled)
- Detect status transitions between refetches: compare previous run statuses with new ones
- On transition to terminal: fire toast with agent name and status (R6), with action to navigate to run detail
- Use `useToast()` for notifications

**Patterns to follow:**
- Existing `useApi` usage in `run-list-page.tsx`
- SWR `refreshInterval` option for conditional polling

**Test scenarios:**
- Initial render matches current behavior
- Polling starts when in-progress runs are visible
- Status badges update in-place within ~5 seconds
- Toast fires when a run completes or fails
- Polling stops when all runs are terminal
- Pagination and source filter work correctly with polling

**Verification:**
- Runs list page shows status updates within ~5 seconds
- No polling when all runs are completed/failed

---

- [ ] **Unit 8: Wire admin app to use UI package streaming components**

**Goal:** Update admin app pages to consume the streaming-enabled UI package components, add `<Toaster />` to admin layout.

**Requirements:** R1-R7

**Dependencies:** Units 3, 6, 7

**Files:**
- Modify: `src/app/admin/(dashboard)/layout.tsx` (add `<Toaster />` from UI package)
- Modify: `src/app/admin/(dashboard)/runs/[runId]/page.tsx` (delegate to UI package `RunDetailPage`)
- Modify: `src/app/admin/(dashboard)/runs/page.tsx` (delegate to UI package `RunListPage`)

**Approach:**
- Add `<Toaster />` from the UI package to the admin dashboard layout
- The admin run detail page is currently a server component that does its own DB queries. Two options:
  - Option A: Convert to a thin server component that passes the run ID to the UI package's `RunDetailPage` client component (which fetches via SDK)
  - Option B: Keep server-side data fetching, serialize and pass to UI package component as initial data
- Option A is simpler and more consistent with how the UI package works — prefer this
- Similarly for the runs list page: delegate to UI package's `RunListPage`
- Ensure the admin SDK client (from provider) has the correct base URL and auth

**Patterns to follow:**
- Other admin pages that already use UI package components
- `AgentPlaneProvider` setup in admin layout

**Test scenarios:**
- Admin run detail page shows live streaming for in-progress runs
- Admin runs list page polls and updates in real-time
- Toasts appear on run completion/failure
- Completed runs display identically to current behavior
- Admin auth works correctly through SDK client

**Verification:**
- All admin run pages work with live streaming
- No regression in existing functionality

---

- [ ] **Unit 9: Integration testing and polish**

**Goal:** End-to-end verification across all three packages; fix edge cases.

**Requirements:** R1-R7

**Dependencies:** Units 1-8

**Files:**
- Modify: any files from Units 1-8 as needed
- Test: `sdk/tests/resources/runs.test.ts`

**Approach:**
- Test the full flow: trigger a run via SDK, navigate to admin detail page, watch events stream in
- Test list polling: watch status badges update while a run is in progress
- Test reconnection: verify stream detach and reconnect works
- Test completed run: verify no streaming fetch is made
- Test toast: verify toast appears and navigation works
- Build SDK (`npm run sdk:build`) and verify UI package compiles
- Build admin app (`npm run build`) and verify no type errors

**Test scenarios:**
- Full live streaming flow from run start to completion
- Stream detach and reconnect mid-run
- Multiple concurrent runs visible in list with polling
- Toast navigation to run detail
- Browser refresh during a live run (should reconnect)
- Run completes between initial render and client hydration (edge case)
- SDK `runs.stream()` works independently of UI package

**Verification:**
- All success criteria from the requirements document are met
- `npm run sdk:build` succeeds
- `npm run build` succeeds
- `npm run sdk:test` passes

## System-Wide Impact

- **Interaction graph:** New tenant-scoped stream endpoint adds a new API surface. The admin stream endpoint remains unchanged. The SDK gains a new method (`runs.stream()`).
- **Error propagation:** Stream errors (network, sandbox gone) surface as a dismissible error state in the UI. The stream endpoint already handles sandbox errors gracefully.
- **State lifecycle risks:** Race between initial fetch (run is "running") and stream start (run already completed) — the stream endpoint handles this by serving the blob transcript for completed runs.
- **API surface parity:** Both admin and tenant stream endpoints exist with matching behavior. SDK `runs.stream()` makes the tenant endpoint available to all SDK consumers.
- **Integration coverage:** The `useRunStream` hook + SDK `runs.stream()` are the critical new integration seams.

## Risks & Dependencies

- **New API endpoint**: The tenant-scoped stream endpoint is new API surface area. Must enforce RLS tenant scoping to prevent cross-tenant data access.
- **`@radix-ui/react-toast` dependency in UI package**: New Radix primitive. Low risk — consistent with existing Radix usage.
- **Long-running fetch connections**: Browser limits concurrent connections per origin (~6). Only one stream active at a time from detail page.
- **Hydration race**: Run may complete between server render and client mount. Stream endpoint handles this gracefully.
- **SDK build**: Must ensure `runs.stream()` is properly exported and typed.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-26-live-run-streaming-requirements.md](docs/brainstorms/2026-03-26-live-run-streaming-requirements.md)
- Related code: `src/app/api/admin/runs/[runId]/stream/route.ts` (admin stream endpoint to mirror)
- Related code: `sdk/src/streaming.ts` (`parseNdjsonStream`, `RunStream`)
- Related code: `sdk/src/resources/runs.ts` (`create`, `transcript` patterns)
- Related code: `ui/src/hooks/use-api.ts` (SWR + SDK client hook pattern)
- Related code: `ui/src/components/pages/run-detail-page.tsx` (existing detail page)
- Related code: `ui/src/components/pages/run-list-page.tsx` (existing list page)
- Institutional learning: `docs/solutions/logic-errors/transcript-capture-and-streaming-fixes.md` (event type matrix, `text_delta` behavior)
