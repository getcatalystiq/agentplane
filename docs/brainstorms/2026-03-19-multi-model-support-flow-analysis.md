---
date: 2026-03-19
topic: multi-model-support-flow-analysis
---

# Multi-Model Support — User Flow & Gap Analysis

## User Flow Overview

### Flow 1: One-Shot Run (Non-Claude Model)

1. Admin creates agent with `model: "openai/gpt-4o"` via admin UI or API
2. Model string stored in `agents.model` column (already `VARCHAR`, no schema change needed)
3. Client POSTs to `/api/agents/:id/runs` with prompt
4. `createRun()` fires budget/concurrency checks — model-agnostic, no changes needed
5. `prepareRunExecution()` calls `buildMcpConfig()` and `fetchPluginContent()` in parallel — both model-agnostic
6. `createSandbox()` is called — currently always builds `buildRunnerScript()` which hard-imports `@anthropic-ai/claude-agent-sdk`
7. **GAP**: `buildRunnerScript()` unconditionally imports Claude Agent SDK and calls `query()`. There is no branch point for Vercel AI SDK. Runner selection must be added here, gated on `isClaudeModel(agent.model)`.
8. Vercel AI SDK runner emits normalized NDJSON events
9. `parseResultEvent()` reads `event.total_cost_usd` and `event.usage.input_tokens/output_tokens` — these field names are Claude SDK conventions. **GAP**: Vercel AI SDK result format differs; the result event emitted by the new runner must map to the same field names, or `parseResultEvent()` must be made runner-aware.
10. Transcript uploaded, billing recorded, sandbox stopped

### Flow 2: Session (Non-Claude Model)

1. Client creates session via `/api/sessions` with `agent_id` pointing to non-Claude agent
2. `createSessionSandbox()` creates sandbox and writes `runner-<runId>.mjs` — currently always Claude SDK `query({ resume: sessionId })`
3. **GAP**: For non-Claude models, `resume: sessionId` is meaningless. The platform must manage conversation history (an array of `{role, content}` messages) explicitly. No storage location or format is specified for this history.
4. **GAP**: History storage decision is deferred in the requirements doc. Options: (a) write `history.json` to sandbox filesystem alongside the session file, or (b) store in Vercel Blob. Sandbox-filesystem approach reuses existing session file backup/restore path (`backupSessionFile` / `restoreSessionFile`). Blob approach adds latency on every turn. The cold-start restore path must also restore history.
5. **GAP**: `sdkSessionIdRef` is captured from `session_info` events emitted by Claude SDK's `init` event. For non-Claude sessions there is no equivalent. The `sdk_session_id` column will remain null, which is fine, but the session runner must not attempt `resume`.
6. Session cleanup cron, idle detection, and sandbox keep-alive are all model-agnostic — no changes needed there.
7. **GAP**: Context window overflow during multi-turn sessions. Claude SDK handles this internally. For non-Claude sessions, the platform must detect when the accumulated history + new prompt exceeds the model's context limit and apply a truncation or summarization strategy. No strategy is specified in the requirements.

### Flow 3: A2A (Non-Claude Model)

1. External client calls `GET /.well-known/agent-card.json` — card is built from `agents` table fields; model string is already included in the card. No changes needed.
2. Client sends `message/send` to JSON-RPC endpoint — `SandboxAgentExecutor.execute()` calls `createRun()` then `prepareRunExecution()` then `finalizeRun()` — all model-agnostic at the A2A layer.
3. `prepareRunExecution()` calls `createSandbox()` which calls `buildRunnerScript()` — **same GAP as Flow 1**: no runner branch exists yet.
4. `RunBackedTaskStore` maps run status to A2A task state; this mapping is purely status-based and model-agnostic. No changes needed.
5. **GAP**: A2A Agent Card currently exposes a `capabilities` block. If the non-Claude model does not support tool use, the card should not advertise tool capabilities. Currently there is no model-capability check when building the card.

### Flow 4: Admin — Model Selection UI

1. Admin navigates to agent create/edit
2. **GAP**: The current agent form has a `model` text input with no provider grouping or validation beyond `z.string().min(1).max(100)`. R10 requires a dropdown grouped by provider. No UI component exists for this.
3. **GAP**: No API or discovery endpoint exists to enumerate available models from Vercel AI Gateway. The requirements defer this to planning, but without it the dropdown must use a static list baked into the UI, which becomes stale as providers add models.
4. Admin saves — model stored in DB. No migration needed (column exists).
5. **GAP**: The `permission_mode` field (`default`/`acceptEdits`/`bypassPermissions`/`plan`) is a required field in `UpdateAgentSchema`. The requirements say permission modes are Claude-only. But the schema does not enforce this: a non-Claude agent can be saved with `permissionMode: "bypassPermissions"`, and the runner will silently ignore it. There is no validation or UI suppression for permission mode when a non-Claude model is selected.

### Flow 5: Scheduled Run (Non-Claude Model)

1. Cron dispatcher runs every minute, claims due agents, dispatches to executor
2. Executor calls `prepareRunExecution()` → `createSandbox()` → `buildRunnerScript()` — **same GAP as Flows 1 and 3**: runner is always Claude SDK
3. No schedule-specific changes needed beyond the runner branch in `buildRunnerScript()`

---

## Flow Permutations Matrix

| Dimension | Claude Agent | Non-Claude Agent | Gap? |
|---|---|---|---|
| One-shot run | Existing path | New Vercel AI SDK runner | Yes — runner branch missing |
| Session: warm sandbox | SDK `resume` | Replay history array | Yes — history storage unspecified |
| Session: cold start (restore) | Restore session file, SDK resume | Restore session file + history file | Yes — history restore path missing |
| A2A message/send | Existing path | Same executor, new runner | Yes — same runner branch gap |
| A2A message/stream | Existing path | Same executor, new runner | Yes — same runner branch gap |
| Scheduled run | Existing path | Same executor, new runner | Yes — same runner branch gap |
| Billing/cost | `total_cost_usd` from Claude SDK | Must map from Vercel AI SDK `usage` | Yes — `parseResultEvent()` field names |
| Tool use | MCP via SDK | MCP via AI SDK adapter | Yes — wiring unspecified (deferred) |
| No-tool model | Fails gracefully via SDK | Must surface clear error pre-run | Yes — no pre-run capability check |
| Permission modes | Supported | Ignored silently | Yes — no validation/suppression |
| Skills/plugins | `.claude/` conventions natively | Must inject into system prompt | Yes — injection strategy unspecified |
| SDK snapshot | `@anthropic-ai/claude-agent-sdk` pre-installed | `ai` (Vercel AI SDK) needs snapshot | Yes — separate snapshot or install step |
| Model validation | Unprefixed = Claude | Provider-prefixed = non-Claude | Partial — logic not yet defined |

---

## Missing Elements & Gaps

### Category: Runner Architecture

**Gap 1 — Runner branch missing**
`buildRunnerScript()` in `sandbox.ts` always emits a script that imports `@anthropic-ai/claude-agent-sdk`. There is no `isClaudeModel()` predicate and no branch to emit a Vercel AI SDK runner script. This is the central implementation gap the entire feature depends on.
- Impact: Non-Claude runs will attempt to call `query()` from Claude SDK with a `model: "openai/gpt-4o"` — this will fail at the Claude API level, not surface as a clear error.
- Assumption if unresolved: All non-Claude runs fail with an opaque error.

**Gap 2 — SDK snapshot contains only Claude SDK**
`refreshSdkSnapshot()` installs `@anthropic-ai/claude-agent-sdk`. The Vercel AI SDK (`ai` package) and any provider adapters (`@ai-sdk/openai`, `@ai-sdk/google`, etc.) are not present in the snapshot.
- Impact: Every non-Claude run will require a fresh `npm install ai @ai-sdk/openai ...` before execution, adding 20–40 seconds of cold start per run.
- Clarification needed: Should a second snapshot be maintained for the Vercel AI SDK, or should both SDKs be co-installed in one snapshot?

**Gap 3 — Model routing predicate undefined**
What exact logic determines "this is a Claude model"? The requirements say "unprefixed or `anthropic/` prefixed". But the current `model` field is a free-text string with no structural validation. If a tenant types `claude-3-5-sonnet` (correct) vs `Claude-3-5-Sonnet` (mixed case) vs `anthropic/claude-3-5` (truncated), the routing predicate could misclassify.
- Clarification needed: Exact regex or prefix check for Claude model detection. Does `anthropic/` prefix always mean Claude SDK? What about `anthropic/claude-instant` vs a hypothetical `anthropic/other-model`?

### Category: Session History (Non-Claude)

**Gap 4 — History storage format and location unspecified**
The requirements defer this (R6 deferred questions). The existing session infrastructure manages a single session file on the sandbox filesystem, backed up to Vercel Blob. Non-Claude sessions need a parallel history structure.
- Critical questions:
  - Is history stored in the same sandbox file (e.g. appended to `session.json`) or a separate `history.json`?
  - Does `backupSessionFile()` / `restoreSessionFile()` cover the history file, or is a new backup function needed?
  - What is the serialized format? `CoreMessage[]` from Vercel AI SDK, or a custom format?

**Gap 5 — Context window overflow strategy missing**
R6 mentions "how to handle conversation history that exceeds model context windows" as a deferred question, but without a resolution this is a production safety gap. A session that accumulates enough history will cause the non-Claude runner to throw an unhandled error (context length exceeded), which will leave the session in `active` state until the stuck-session watchdog fires (30 min timeout).
- Impact: Users get a confusing error after many turns; sessions may get stuck.
- Minimum viable resolution: Emit a structured `error` event with `code: "context_exceeded"` and transition session to `failed` rather than hanging.

**Gap 6 — `sdk_session_id` lifecycle for non-Claude sessions**
The `sessions` table has `sdk_session_id` captured from the Claude SDK `init` event. For non-Claude sessions this stays null. The `sdkSessionIdRef` tracking in `session-executor.ts` will never fire. This is safe but the column name is misleading for non-Claude rows; this is a documentation/naming gap, not a functional one.

### Category: Event Normalization & Billing

**Gap 7 — `parseResultEvent()` field name assumptions**
`parseResultEvent()` reads `event.total_cost_usd`, `event.usage.input_tokens`, `event.usage.cache_read_input_tokens`, etc. These are Claude SDK field names. The Vercel AI SDK runner must emit a `result` event with the same field names, or `parseResultEvent()` must be extended. The exact mapping from Vercel AI SDK's `usage` object (which uses `promptTokens` / `completionTokens` in most adapters) is unspecified.
- Impact: Token counts and cost will be null/zero for all non-Claude runs if not mapped correctly.
- Clarification needed: Should the Vercel AI SDK runner normalize field names before writing to the transcript, or should `parseResultEvent()` handle both shapes?

**Gap 8 — Cost calculation when AI Gateway doesn't return cost**
R8 notes this as a deferred question. Currently `cost_usd` comes directly from the runner event (`event.total_cost_usd`). If Vercel AI Gateway does not return a cost figure, the platform has no per-provider pricing table to fall back to. This means `cost_usd` could be null for all non-Claude runs, breaking budget enforcement.
- Impact: Tenants with non-Claude agents could exceed their monthly budget if cost tracking is null.
- Clarification needed: Does the `createRun()` budget check use `cost_usd` from the run result, or does it check `current_month_spend` in the tenant table? (Answer from code: it checks `current_month_spend` pre-run, not per-run cost. So budget enforcement still works if spend is recorded. But if `cost_usd` is null, the `current_month_spend` update will be a no-op and budgets will drift.)

**Gap 9 — `num_turns` and `duration_api_ms` are Claude SDK concepts**
These fields are recorded in the `runs` table. Vercel AI SDK does not natively emit `num_turns` (it is an agentic concept from Claude SDK's multi-step loop) or `duration_api_ms`. Non-Claude runs will always show null for these fields in the admin UI.
- Impact: Admin run analytics show incomplete data for non-Claude runs. Not a blocking issue but a UX gap.

### Category: Skill & Plugin Injection

**Gap 10 — Skill/plugin content not injected into system prompt for non-Claude**
The requirements (scope boundaries) acknowledge this: "only Claude Agent SDK understands `.claude/` conventions natively. For non-Claude models, skill content must be included in the system prompt or tool descriptions." But no implementation detail is provided. The current `buildRunnerScript()` uses `settingSources: ["project"]` to tell Claude SDK to read `.claude/`. The Vercel AI SDK runner has no equivalent mechanism.
- Impact: Non-Claude agents with skills/plugins silently ignore all skill content. Agent behavior diverges from intent.
- Clarification needed: Should the Vercel AI SDK runner concatenate skill file contents into the system prompt? If so, what format and ordering? What is the size limit before this becomes impractical?

### Category: Model Validation & UI

**Gap 11 — `permission_mode` not gated on model type**
The `UpdateAgentSchema` always requires a valid `permission_mode` enum value. Saving a non-Claude agent with `permissionMode: "plan"` will succeed without error. The runner will receive this config and silently ignore it (since there is no Claude SDK to pass it to). The admin UI should hide/disable this field for non-Claude agents.
- Impact: Silent misconfiguration; admin may believe permission mode is active when it is not.

**Gap 12 — No model-capability pre-check before run creation**
The requirements state: "If a model doesn't support tool use, the run fails with a clear error rather than silently degrading." But there is no pre-run check. The model would only fail when the Vercel AI SDK runner attempts to call a tool inside the sandbox, after the sandbox is already running. This wastes sandbox time (billed against tenant) and produces a cryptic error.
- Impact: Poor UX for tool-using agents on non-tool models; sandbox resource wasted.
- Minimum viable: Validate during agent creation/update that models without tool support cannot have `composio_toolkits`, `allowed_tools`, or MCP servers configured.

**Gap 13 — Model enumeration for admin dropdown**
R10 requires a dropdown of known models grouped by provider. No endpoint exists to enumerate Vercel AI Gateway models. If a static list is used, it must be maintained as providers add/remove models. The requirements note this as a deferred research question but no resolution is recorded.

### Category: A2A Specific

**Gap 14 — Agent Card capability advertisement for non-tool models**
If a non-Claude model is configured without tools, the A2A Agent Card should not advertise tool-calling capabilities. Currently `buildAgentCard()` constructs capabilities based on agent metadata without checking model capability. External A2A clients may attempt tool-based interactions with an agent that cannot support them.

---

## Critical Questions Requiring Clarification

### Critical (blocks implementation)

**Q1.** What is the exact logic for determining "Claude vs non-Claude" at runner selection time?
- Why: Everything in Flows 1–5 branches on this. A subtle regex bug silently misroutes all Claude runs.
- Proposed: `model.startsWith('anthropic/') || !model.includes('/')` — but this needs explicit confirmation. What about `claude-` prefix without `anthropic/`?
- Assumption if unresolved: Use `!model.includes('/')` as Claude, any `provider/model` as non-Claude.

**Q2.** Where is non-Claude session history stored and what triggers its backup?
- Why: Without this, sessions cannot survive sandbox restarts. Cold-start restore cannot work.
- Assumption if unresolved: Store as `history.json` in sandbox alongside session file; include in `backupSessionFile()` / `restoreSessionFile()`.

**Q3.** What is the context window overflow strategy for non-Claude sessions?
- Why: Without a strategy, long sessions fail with unhandled errors and sessions get stuck.
- Assumption if unresolved: Truncate oldest messages (sliding window), preserve system prompt. Emit `context_truncated` event to client.

**Q4.** Does the Vercel AI SDK runner normalize event field names to match Claude SDK conventions (`total_cost_usd`, `usage.input_tokens`), or does `parseResultEvent()` handle both shapes?
- Why: Billing and token tracking will be broken if this is not resolved before the runner is built.
- Assumption if unresolved: Runner normalizes — it is simpler to normalize once at the source than to branch in `parseResultEvent()`.

**Q5.** How is `@ai-sdk/...` installed in the sandbox? Separate snapshot, combined snapshot, or per-run install?
- Why: Per-run install adds 30–60s cold start per non-Claude run. Separate snapshot doubles snapshot management complexity. Combined snapshot installs both SDKs regardless of agent type.
- Assumption if unresolved: Combined snapshot — install both SDKs. `refreshSdkSnapshot()` updated to install both.

### Important (significantly affects UX or maintainability)

**Q6.** How is skill content made available to the Vercel AI SDK runner? Concatenated into system prompt, or injected as tool descriptions?
- Why: Skills are a key differentiator feature; silent ignoring is unacceptable.

**Q7.** Should `permission_mode` be stripped/rejected at API validation time for non-Claude agents, or just silently ignored?
- Why: Silent misconfiguration erodes admin trust.

**Q8.** Should there be a DB-level constraint or check that prevents non-Claude agents from having `permission_mode` != `null`/`default`?

**Q9.** What happens to an existing Claude agent if its `model` is changed to a non-Claude model while a session is active?
- Why: The active session sandbox has Claude SDK loaded. The next message will attempt Claude SDK `resume` with a non-Claude runner.

**Q10.** Does Vercel AI Gateway return per-call cost in the response metadata, or must the platform calculate it from token counts and a pricing table?

### Nice-to-have (reasonable defaults exist)

**Q11.** Should the `run_started` event emitted by the Vercel AI SDK runner include a `runner` field (e.g. `"vercel-ai"`) so clients can differentiate?

**Q12.** Should the admin UI show a warning when a model is non-Claude and skills/plugins are configured (since skill content won't be auto-loaded via `.claude/`)?

**Q13.** Should `max_budget_usd` be validated/enforced for non-Claude runs? Claude SDK enforces it natively; the Vercel AI SDK runner must implement its own turn-budget check.

---

## Recommended Next Steps

1. **Define `isClaudeModel()` predicate** — single source of truth in `src/lib/sandbox.ts` (or a new `src/lib/model-utils.ts`). All five flows depend on this.

2. **Design Vercel AI SDK runner script template** — parallel to `buildRunnerScript()`, emitting identical NDJSON events. Include: normalized `result` event shape, MCP wiring pattern, history array management, system prompt injection for skills.

3. **Resolve session history storage** — decide sandbox-filesystem vs Blob, update `backupSessionFile()` / `restoreSessionFile()`, and document the cold-start restore path for non-Claude sessions.

4. **Update `refreshSdkSnapshot()`** — decide combined vs separate snapshot strategy. Update cron job accordingly.

5. **Add model-aware validation** — strip `permission_mode` for non-Claude agents at the API schema level; add pre-run tool-capability check.

6. **Define event field name contract** — write a mapping table from Vercel AI SDK stream events to AgentPlane NDJSON events before building the runner (this is a deferred question in the requirements doc that must be resolved first).
