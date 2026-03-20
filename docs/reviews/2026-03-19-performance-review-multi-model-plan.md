---
title: "Performance Review: Multi-Model Agent Support Plan"
type: performance-review
date: 2026-03-19
subject: docs/plans/2026-03-19-002-feat-multi-model-agent-support-plan.md
---

# Performance Review: Multi-Model Agent Support Plan

## 1. Performance Summary

The dual-runner architecture is sound. Most performance concerns are isolated, addressable, and do not affect the Claude path at all. The five issues raised are real but vary considerably in impact: the AI Gateway generation lookup (concern 4) and MCP client connection overhead (concern 2) are the most impactful; the others are minor or already mitigated.

---

## 2. Critical Issues

### 2.1 AI Gateway Generation Lookup — Extra HTTP Round-Trip Per Non-Claude Run (Concern 4)

**Location:** `src/lib/run-executor.ts` → `finalizeRun()` (Phase 4)

**Current impact:** Every non-Claude run adds one synchronous HTTP call to `https://ai-gateway.vercel.sh/v1/generation?id={id}` inside `finalizeRun()`. This blocks the Vercel function from returning until the external call completes or times out.

**Problem:** The plan doesn't specify how to obtain the generation ID. The Vercel AI SDK `streamText()` result does not currently expose a gateway generation ID in its standard response. If this requires a custom response header or polling, it will add latency and complexity that is not accounted for in the plan.

**Projected impact at scale:** At 100 concurrent non-Claude runs, 100 outbound HTTP calls fire in `finalizeRun()`. If the gateway lookup averages 200ms, that's 200ms of extra Vercel function wall-time per run, and potential gateway rate-limit pressure.

**Recommended solution:**
- Make the cost lookup truly async: fire it with `void fetch(...)` and let it resolve independently, updating the DB via a separate `UPDATE runs SET cost_usd = $1 WHERE id = $2 AND cost_usd IS NULL` after resolution.
- Do not block `finalizeRun()` on it. Accept eventual consistency for cost (the plan already acknowledges best-effort — make the code match that intent).
- Confirm the generation ID is available from the AI Gateway response headers during the `streamText()` call, and capture it in the runner script's result event rather than looking it up post-hoc.

---

### 2.2 MCP Client Connection Overhead Per Run (Concern 2)

**Location:** `buildVercelAiRunnerScript()` → MCP setup block (Phase 2)

**Current design:** The plan creates one `createMCPClient` per MCP server, serially in a `for...of` loop inside the sandbox runner:

```js
for (const [name, serverConfig] of Object.entries(servers)) {
  const client = await createMCPClient(...);  // sequential await
  const tools = await client.tools();         // second sequential await
```

**Impact:** With N MCP servers, startup time is `O(N * (connection_latency + tool_discovery_latency))`. For an agent with 3 MCP servers at 200ms each, that's ~1.2 seconds of serial I/O before the first token is generated. The existing Claude runner already has this characteristic, but the plan introduces it fresh for the Vercel AI SDK path without addressing it.

**Recommended solution:** Parallelize with `Promise.all()`:

```js
const mcpClients = await Promise.all(
  Object.entries(servers).map(async ([name, serverConfig]) => {
    const client = await createMCPClient({ transport: { type: 'sse', url: serverConfig.url, headers: serverConfig.headers } });
    const tools = await client.tools();
    return { name, client, tools };
  })
);
const mcpTools = Object.fromEntries(mcpClients.flatMap(({ tools }) => Object.entries(tools)));
```

This reduces MCP startup from O(N) serial to O(1) parallel, matching how `buildMcpConfig()` already handles token refresh with `Promise.allSettled()`.

---

## 3. Optimization Opportunities

### 3.1 Snapshot Size Increase — Both SDKs (Concern 1)

**Current:** Snapshot installs only `@anthropic-ai/claude-agent-sdk` (~few MB).

**Plan change:** Snapshot installs `@anthropic-ai/claude-agent-sdk` AND `ai @ai-sdk/mcp`. The Vercel AI SDK v5 plus `@ai-sdk/mcp` adds roughly 2–8 MB depending on transitive dependencies.

**Assessment:** Low risk. Snapshot creation is a daily cron job, not on the hot path. Sandbox startup from snapshot is a resume operation — the snapshot size increase affects the `refreshSdkSnapshot()` cron runtime, not per-run sandbox creation time. The plan's own risk table correctly marks this as Low.

**One concern:** The plan's `installSdk()` fallback path (line 184 in `sandbox.ts`) only installs `@anthropic-ai/claude-agent-sdk`. If a non-Claude run triggers the fallback (snapshot expired or missing), the Vercel AI SDK will not be installed and the runner will crash immediately. The fallback must install both packages.

**Fix required in `installSdk()`:**
```typescript
// Change from:
args: ["install", "@anthropic-ai/claude-agent-sdk"],
// To:
args: ["install", "@anthropic-ai/claude-agent-sdk", "ai", "@ai-sdk/mcp"],
```

---

### 3.2 Session History Replay — Full Message Array Each Turn (Concern 3)

**Location:** Phase 3, `buildVercelAiSessionRunnerScript()`

**Current design:** Each session message sends the full `messages[]` array to the model. This is the correct approach for stateless providers (no equivalent to Claude SDK's `resume: sessionId`). The concern is memory and token cost growth.

**Complexity:** O(N) tokens per turn where N is cumulative turns. After 20 turns of 500 tokens each, turn 21 sends ~10,000 tokens of history in context, plus the new prompt.

**Assessment:** The plan already addresses this with a context window truncation strategy (80% threshold, hardcoded model context window map). This is the correct mitigation. Two gaps:

1. **The truncation happens inside the sandbox runner**, which has no access to the DB or Blob to persist a "truncated_at" marker. If the sandbox dies and restores from Blob, it restores the pre-truncation history. This is acceptable but should be documented.

2. **The hardcoded model context window map will drift.** New models (e.g. GPT-5) will hit the conservative 32k default even if they have 1M context. Recommend storing the effective context window in `session_history.json` metadata on first message, derived from a simple lookup table that defaults conservatively, and allow override via agent config.

**No immediate action required** — the existing design is sound for MVP. Flag for post-launch improvement.

---

### 3.3 Admin UI Model List Fetch from AI Gateway (Concern 5)

**Location:** `src/app/api/admin/agents/models/route.ts` (Phase 5, new endpoint)

**Current design:** Dropdown fetches from `/api/admin/agents/models` on mount, which proxies `GET https://ai-gateway.vercel.sh/v1/models` with a 5-minute TTL cache.

**Assessment:** The 5-minute TTL process-level cache is correct. The AI Gateway models API is publicly documented as stable and rarely changes. No performance concern for the admin UI.

**One gap:** The plan doesn't specify what happens if the gateway is unreachable at form load. The dropdown will show empty or an error, blocking agent creation. Recommend a hardcoded fallback list of the 8–10 most common models (already shown in the UX mockup) that renders immediately while the fetch is in flight, replacing with live data on success. This makes the form usable even during gateway outages.

---

### 3.4 Duplicate Tool Event Emission in Vercel AI SDK Runner

**Location:** Phase 2, runner script `fullStream` loop

**Problem identified:** The plan emits tool events twice. `onStepFinish` callback emits `tool_use` and `tool_result` events, and then the `fullStream` iteration emits them again for `tool-call` and `tool-result` chunk types. A single tool call will produce 2 `tool_use` events and 2 `tool_result` events in the transcript.

**Impact:** Doubles the number of tool events in the transcript, inflates token event counts, and could confuse clients that render the transcript. The transcript-based billing (`parseResultEvent`) reads the `result` event which uses `finalUsage` so billing is unaffected — but the NDJSON stream format will differ from the Claude runner for any client inspecting tool events.

**Fix:** Remove the `tool_use`/`tool_result` emissions from either `onStepFinish` or the `fullStream` loop — not both. Given that `onStepFinish` fires after the step completes (not while streaming), prefer emitting from `fullStream` for event ordering parity with the Claude runner, and remove the duplicate emissions from `onStepFinish`.

---

## 4. Scalability Assessment

| Dimension | Current (Claude only) | After This Plan |
|---|---|---|
| Snapshot startup | ~2s from snapshot | ~2–3s (same path, slightly larger snapshot) |
| MCP setup per run | O(N) serial via Claude SDK | O(N) serial (same, unless parallelized per §2.2) |
| Session history per turn | O(1) via SDK resume | O(N) tokens, bounded by truncation |
| Cost resolution | Inline from SDK | Inline for Claude; async Gateway lookup for others |
| Admin model list | Hardcoded | Cached proxy, 5-min TTL |

At 1000x volume, the serial MCP client setup (§2.2) and the blocking AI Gateway cost lookup (§2.1) are the two issues that will hurt most. Both have clean fixes.

---

## 5. Recommended Actions (Prioritized)

| Priority | Issue | Effort | Impact |
|---|---|---|---|
| P0 | Fix `installSdk()` fallback to install both SDKs (§3.1) | Trivial (1 line) | Non-Claude runs crash on snapshot miss without this |
| P0 | Fix duplicate tool event emission in runner (§3.4) | Small (remove ~8 lines from `onStepFinish`) | NDJSON format correctness |
| P1 | Make AI Gateway cost lookup non-blocking (§2.1) | Small | Removes external HTTP from `finalizeRun()` critical path |
| P1 | Parallelize MCP client creation in Vercel AI runner (§2.2) | Small | Reduces MCP-heavy run startup by O(N-1) * latency |
| P2 | Hardcoded fallback model list for admin UI (§3.3) | Small | UX resilience during gateway outages |
| P3 | Document session history truncation behavior for cold-start (§3.2) | Docs only | Operational clarity |
