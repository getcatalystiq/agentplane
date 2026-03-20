---
title: "feat: Multi-Model Agent Support via Vercel AI SDK"
type: feat
status: completed
date: 2026-03-19
origin: docs/brainstorms/2026-03-19-multi-model-support-requirements.md
---

# feat: Multi-Model Agent Support via Vercel AI SDK

## Enhancement Summary

**Deepened on:** 2026-03-19
**Sections enhanced:** All 6 phases + system-wide impact
**Review agents used:** TypeScript reviewer, Performance oracle, Security sentinel, Architecture strategist, Agent-native reviewer, Framework docs researcher, Learnings researcher, Agent-native architecture skill, Deployment verification

### Key Improvements
1. **Security hardening** - Path traversal protection on FS tools, SSRF mitigation on web_fetch, model ID regex validation, tool namespace collision prevention
2. **Architecture cleanup** - Extract `RunnerType` + `resolveRunnerType()` to `src/lib/models.ts`, split runner builders into `src/lib/runners/` directory
3. **Bug fixes** - Duplicate tool event emission, `cost_usd` coercion to 0 instead of null, migration numbering (020 not 018), fallback install missing AI SDK
4. **Performance** - Parallelize MCP client creation, non-blocking cost lookup, hardcoded model list fallback
5. **API parity** - SDK `Run` type needs `runner` field, tenant-facing model discovery endpoint, new event types in SDK
6. **Agent-native design** - Add `bash` tool, on-demand skill injection (index not bulk), `complete_task` tool

### New Considerations Discovered
- Tool schema uses `inputSchema` (Zod) not `parameters` (JSON Schema) in Vercel AI SDK v5+
- `totalUsage` (not `usage`) gives cumulative tokens across all steps
- MCP tool names can collide with built-in tools - namespace with `sandbox__` prefix
- Session history needs `runner` discriminant for cold-start format detection
- Transcript path must be per-run (`transcript-<runId>.ndjson`) for session concurrency safety

---

## Overview

Add support for non-Claude models (OpenAI, Google, Mistral, xAI, DeepSeek, etc.) in AgentPlane by introducing Vercel AI SDK as a second runner path alongside the existing Claude Agent SDK. Claude models keep their rich agentic features; non-Claude models get full tool parity through Vercel AI SDK's agent loop. All existing functionality - A2A, sessions, streaming, billing, scheduling - works with any model.

## Problem Statement

AgentPlane is locked to Claude models via the Claude Agent SDK. Tenants want multi-model support for cost optimization, capability access (image/video generation), and flexibility. Being model-agnostic strengthens competitive positioning. (see origin: docs/brainstorms/2026-03-19-multi-model-support-requirements.md)

## Proposed Solution

**Dual runner architecture** with explicit runner selection:
- Claude/Anthropic models: user chooses runner — Claude Agent SDK (default) or Vercel AI SDK
- All other models (`openai/gpt-4o`, `google/gemini-2.5-pro`, etc.): always Vercel AI SDK (auto-set, no choice)

The `runner` field is stored on the agent alongside `model`. For non-Claude models the API auto-sets it to `vercel-ai-sdk` regardless of input. All model calls route through Vercel AI Gateway using the existing `AI_GATEWAY_API_KEY`. The Vercel AI SDK runner normalizes events to the existing AgentPlane NDJSON format so clients need zero changes.

## Technical Approach

### Architecture

```
+----------------------------------------------------------+
|                     AgentPlane API                        |
|                                                           |
|  run-executor.ts / session-executor.ts                    |
|       |                                                   |
|       v                                                   |
|  +-------------------------------+                        |
|  | resolveEffectiveRunner(       |  <- src/lib/models.ts  |
|  |   agent.model, agent.runner)  |                        |
|  +------+------------------+-----+                        |
|         |                  |                              |
|    'claude-agent-sdk'   'vercel-ai-sdk'                   |
|    (Claude models,      (all models -                     |
|     user's choice)       auto for non-Claude,             |
|         |                opt-in for Claude)                |
|         v                  v                              |
|  src/lib/runners/                                         |
|  +----------------+  +-----------------------------+      |
|  | claude-runner   |  | vercel-ai-runner             |    |
|  | (query() loop)  |  | (streamText() + tools)      |    |
|  +----------------+  +-----------------------------+      |
|         |                        |                        |
|         v                        v                        |
|  Normalized NDJSON events (same format)                   |
|         |                                                 |
|         v                                                 |
|  captureTranscript() -> streaming -> client                |
+----------------------------------------------------------+
```

### Event Type Storage Matrix

Per institutional learnings (`docs/solutions/logic-errors/transcript-capture-and-streaming-fixes.md`), every event type must have an explicit storage decision:

| Event Type | Yield (stream) | Store (transcript) | Asset process | Notes |
|---|---|---|---|---|
| `run_started` | yes | yes | no | |
| `assistant` | yes | yes (pre-truncation) | yes | |
| `tool_use` | yes | yes (pre-truncation) | no | |
| `tool_result` | yes | yes (pre-truncation) | yes | |
| `text_delta` | yes | **no** | no | Stream-only, never stored |
| `result` | yes | **always** (post-truncation too) | yes | Critical - must survive truncation |
| `error` | yes | **always** (post-truncation too) | no | Critical - must survive truncation |
| `mcp_status` | yes | yes (pre-truncation) | no | |
| `mcp_error` | yes | yes (pre-truncation) | no | New event type |
| `session_warning` | yes | yes (pre-truncation) | no | New event type (Phase 3) |

Both runners must follow this matrix. Post-truncation capture for `result`/`error` is handled by existing `captureTranscript()` guard - verified to apply to both runner paths.

### Implementation Phases

#### Phase 1: Foundation - Model Detection, Types & Snapshot

**Goal:** Establish routing types, prepare sandbox with both SDKs.

**Files:**

- **`src/lib/models.ts`** (new) - Shared model detection, extracted from sandbox layer:
  ```typescript
  export type RunnerType = 'claude-agent-sdk' | 'vercel-ai-sdk';

  /** Returns the default runner for a model. Used when agent has no explicit runner set. */
  export function defaultRunnerForModel(model: string): RunnerType {
    if (!model.includes('/') || model.startsWith('anthropic/')) {
      return 'claude-agent-sdk';
    }
    return 'vercel-ai-sdk';
  }

  /** Returns whether the model supports the Claude Agent SDK runner. */
  export function supportsClaudeRunner(model: string): boolean {
    return !model.includes('/') || model.startsWith('anthropic/');
  }

  /** Resolves the effective runner: agent's explicit choice, or default for model. */
  export function resolveEffectiveRunner(model: string, agentRunner: RunnerType | null): RunnerType {
    if (agentRunner) return agentRunner;
    return defaultRunnerForModel(model);
  }

  export function isClaudeModel(model: string): boolean {
    return supportsClaudeRunner(model);
  }

  // Context window map for session truncation (Phase 3)
  export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    'openai/gpt-4o': 128_000,
    'openai/gpt-4o-mini': 128_000,
    'openai/o3': 200_000,
    'google/gemini-2.5-pro': 1_000_000,
    'google/gemini-2.5-flash': 1_000_000,
    'mistral/mistral-large': 128_000,
    'xai/grok-3': 131_072,
    'deepseek/deepseek-chat': 128_000,
  };
  export const DEFAULT_CONTEXT_WINDOW = 16_000; // Fail closed for unknown models
  ```

- **`src/lib/types.ts`** - Add `RunnerType` to exports, add `runner` to `StreamEvent` union's result type

- **`src/lib/validation.ts`** - Three changes:
  ```typescript
  // 1. Model ID regex validation
  model: z.string().min(1).max(100).regex(
    /^[a-z0-9-]+(?:\/[a-z0-9._:-]{1,80})?$/,
    'Model ID must be lowercase alphanumeric, optionally with provider/ prefix'
  )

  // 2. Runner field on agent schema (nullable — NULL means use default)
  runner: z.enum(['claude-agent-sdk', 'vercel-ai-sdk']).nullable().optional()

  // 3. Cross-field validation: non-Claude model + claude-agent-sdk = error
  .refine(data => {
    if (data.runner === 'claude-agent-sdk' && !supportsClaudeRunner(data.model)) {
      return false;
    }
    return true;
  }, { message: 'Claude Agent SDK runner only supports Anthropic models' })
  ```
  Also update `RunRow` schema: `cost_usd: z.coerce.number().nullable()` (fixes coercion of null to 0)

- **`src/lib/sandbox.ts`** - Three changes: (1) Update `createSandbox()` to import `resolveRunnerType` from `models.ts` and branch on result. (2) Update `refreshSdkSnapshot()` to install `@anthropic-ai/claude-agent-sdk`, `ai`, `@ai-sdk/mcp`, and `@modelcontextprotocol/sdk` (needed for stdio transport used by AgentCo callback bridge). (3) Update `installSdk()` fallback (line ~73) to install the same full set, so non-Claude runs work even without a snapshot.

- **`src/app/api/cron/refresh-snapshot/route.ts`** - Snapshot refresh installs both packages

### Research Insights (Phase 1)

**Model ID format:** AI Gateway uses `creator/model-name` format (e.g. `openai/gpt-4o`). Full provider list at `https://ai-gateway.vercel.sh/v1/models` (no auth). The Zod regex catches injection attempts (`\n`, `../`, null bytes) while allowing all valid gateway model IDs.

**Fallback install is a real risk:** If snapshot is expired/missing, `installSdk()` only installs Claude SDK. Non-Claude runs on the fallback path would crash immediately. Must install both SDKs in fallback.

**Acceptance Criteria:**
- [ ] `defaultRunnerForModel('claude-sonnet-4-6')` returns `'claude-agent-sdk'`
- [ ] `defaultRunnerForModel('anthropic/claude-sonnet-4-6')` returns `'claude-agent-sdk'`
- [ ] `defaultRunnerForModel('openai/gpt-4o')` returns `'vercel-ai-sdk'`
- [ ] `resolveEffectiveRunner('anthropic/claude-sonnet-4-6', 'vercel-ai-sdk')` returns `'vercel-ai-sdk'` (user override)
- [ ] `resolveEffectiveRunner('anthropic/claude-sonnet-4-6', null)` returns `'claude-agent-sdk'` (default)
- [ ] Validation rejects `runner: 'claude-agent-sdk'` for `model: 'openai/gpt-4o'`
- [ ] Model ID `"openai/../../admin"` rejected by Zod regex
- [ ] Model ID with newlines rejected by Zod regex
- [ ] `RunRow.cost_usd` accepts `null` without coercing to 0
- [ ] Snapshot contains both `@anthropic-ai/claude-agent-sdk` and `ai` + `@ai-sdk/mcp`
- [ ] Fallback `installSdk()` installs both SDKs
- [ ] Existing Claude runs continue working identically

#### Phase 2: Vercel AI SDK Runner Script - One-Shot Runs

**Goal:** Build the runner template with full tool support, security hardening, and normalized events.

**Files:**

- **`src/lib/runners/vercel-ai-runner.ts`** (new) - `buildVercelAiRunnerScript(config: SandboxConfig): string`
- **`src/lib/runners/claude-runner.ts`** (new) - Extract existing `buildRunnerScript()` from `sandbox.ts`
- **`src/lib/sandbox.ts`** - Import from `runners/`, becomes orchestrator only

**Runner script design (key elements):**

The runner template is an ES module string injected into the sandbox as `runner.mjs`. Key design elements:

**Per-run transcript path:** `transcript-<runId>.ndjson` (not shared `transcript.ndjson`) to prevent session concurrency corruption.

**Workspace-restricted FS tools:** All file operations constrained to `/vercel/sandbox/workspace/` with `path.resolve()` + prefix check to block path traversal.

**Tool namespace:** Built-in tools prefixed with `sandbox__` (`sandbox__read_file`, `sandbox__write_file`, `sandbox__list_files`, `sandbox__bash`, `sandbox__web_fetch`, `sandbox__complete_task`) to prevent MCP tool name collisions. Collisions detected at init time with `mcp_error` event.

**Zod schemas for tool parameters:** Vercel AI SDK v5+ uses `parameters: z.object(...)` not JSON Schema. The SDK handles Zod-to-JSON-Schema conversion internally.

**SSRF protection on web_fetch:** HTTPS-only, blocks RFC 1918/link-local/localhost, 1MB response cap, 15s timeout.

**Bash tool:** Claude Agent SDK provides bash natively - without it non-Claude agents lose enormous emergent capability. Runs in workspace dir with 30s timeout and 1MB output buffer.

**Complete_task tool:** Explicit completion signaling. `stopWhen: stepCountIs(maxTurns)` is a safety ceiling, not the primary completion mechanism.

**Parallel MCP client initialization:** `Promise.allSettled()` over all servers instead of serial `for...of` loop. With 3 servers at 200ms each, saves ~800ms of sequential I/O.

**AgentCo callback bridge compatibility:** The AgentCo callback bridge (`agentco-bridge.mjs`) is injected as a **stdio** MCP server into `MCP_SERVERS_JSON`. The runner must detect stdio vs SSE/HTTP entries in the MCP config and use the appropriate transport:
- SSE/HTTP entries: `createMCPClient({ transport: { type: 'sse', url, headers } })`
- Stdio entries (AgentCo bridge): `createMCPClient({ transport: new StdioClientTransport({ command, args }) })` using `@modelcontextprotocol/sdk/client/stdio`
- The bridge files (`agentco-bridge.mjs`, `agentco-tools.json`) are already written to disk by `createSandbox()` before the runner starts
- Bridge env vars (`AGENTCO_CALLBACK_URL`, `AGENTCO_CALLBACK_TOKEN`) are set in the sandbox environment
- The `hasCallback` flag suppresses `allowedTools` restriction so `mcp__agentco__*` tool names are accessible
- Bridge tools appear as `mcp__agentco__<tool_name>` — same as in the Claude runner

**Single emission site for tool events:** `onStepFinish` callback owns `tool_use`/`tool_result` emission to transcript. The `fullStream` loop handles ONLY `text-delta` streaming (not stored in transcript). This prevents the duplicate tool event bug.

**Token usage:** `await result.totalUsage` (cumulative across all steps), NOT `await result.usage` (last step only).

**Generation ID for cost lookup:** The runner must capture the AI Gateway's `generation_id` from the completion response (available via `result.response.id` or `finish` stream event) and include it in the `result` event as `generation_id`. Phase 4's `resolveGatewayCost()` uses this to look up cost data from the gateway.

**Skill/Plugin injection (on-demand, not bulk):**
- Skills are injected as files into `/vercel/sandbox/workspace/.skills/`
- System prompt includes a skill index (names + descriptions) with instruction: "Read skill files with `sandbox__read_file` when relevant"
- This avoids bloating context with all skill content upfront
- Add `buildSkillIndex(skills, plugins): string` helper that generates the index section

**Acceptance Criteria:**
- [ ] Agent with `model: "openai/gpt-4o"` runs successfully in sandbox
- [ ] Runner emits `run_started`, `text_delta`, `tool_use`, `tool_result`, `result` events
- [ ] Events match existing NDJSON format - clients see no difference
- [ ] Tool events emitted exactly once (from `onStepFinish`, not duplicated in `fullStream`)
- [ ] `text_delta` events streamed but NOT stored in transcript chunks
- [ ] `result` event captured even after transcript truncation (verified via existing guard)
- [ ] MCP tools initialized in parallel via `Promise.allSettled()`
- [ ] MCP tool name collisions detected and skipped with `mcp_error` event
- [ ] FS tools reject paths outside `/vercel/sandbox/workspace/`
- [ ] `web_fetch` rejects non-HTTPS, private IPs, localhost
- [ ] `bash` tool works with 30s timeout
- [ ] Skills injected as files + index in system prompt (not bulk content)
- [ ] Transcript uploaded to platform on completion
- [ ] AgentCo callback bridge (stdio MCP) works with Vercel AI SDK runner via `StdioClientTransport`
- [ ] Mixed MCP config (SSE servers + stdio bridge) initializes correctly in parallel

#### Phase 3: Session Support for Vercel AI SDK Runner

**Goal:** Enable multi-turn sessions with conversation history management for any agent using the Vercel AI SDK runner (including Claude models that opt into it).

**Files:**

- **`src/lib/runners/vercel-ai-session-runner.ts`** (new) - `buildVercelAiSessionRunnerScript(config)`
  - Reads history from `/vercel/sandbox/session-history.json`, appends new user message
  - Calls `streamText({ messages })` with full history
  - Appends assistant response + tool calls to history, writes back
  - Uses `response.messages` from Vercel AI SDK to append correctly-formatted messages
- **`src/lib/session-executor.ts`** - Branch on `resolveEffectiveRunner(agent.model, agent.runner)` (import from `models.ts`):
  - `claude-agent-sdk` path: unchanged (uses `resume: sessionId`)
  - `vercel-ai-sdk` path: load history from session file, pass to runner, save updated history
- **`src/lib/session-files.ts`** - Support backing up `session-history.json` (non-Claude) in addition to Claude's session files
- **`src/lib/sessions.ts`** - `sdk_session_id` is NULL for non-Claude sessions (column is already nullable)

**Session history format (`session-history.json`):**
```json
{
  "runner": "vercel-ai-sdk",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "...", "toolCalls": [] },
    { "role": "tool", "content": "...", "toolCallId": "..." }
  ],
  "metadata": {
    "model": "openai/gpt-4o",
    "totalTokens": 12345,
    "turnCount": 3
  }
}
```

The `runner` discriminant at root level enables unambiguous format detection on cold-start restore (vs. Claude session files which have a different structure).

### Research Insights (Phase 3)

**Vercel AI SDK message format:** `ModelMessage` (v5 rename of `CoreMessage`) with roles: `user`, `assistant`, `tool`, `system`. Use `response.messages` to get properly-formatted messages to append to history.

**Context window overflow strategy:**
- Track cumulative token count in `metadata.totalTokens`
- When approaching 80% of model's context window, truncate oldest messages (keep system prompt + last N turns)
- Context window map: `MODEL_CONTEXT_WINDOWS` in `src/lib/models.ts`. Conservative 16k default for unknown models (fail closed).
- Emit `session_warning` event when truncation occurs
- Individual tool result entries capped at 50k chars to prevent single oversized responses from consuming the context budget

**Acceptance Criteria:**
- [ ] Session with non-Claude model preserves context across 5+ messages
- [ ] Session history has `runner: "vercel-ai-sdk"` discriminant
- [ ] History backed up to Vercel Blob (same mechanism as Claude sessions)
- [ ] Cold start restores history from Blob and detects format via `runner` field
- [ ] Context window overflow triggers truncation with `session_warning` event
- [ ] Individual tool results capped at 50k chars in history
- [ ] Cleanup cron handles non-Claude sessions identically
- [ ] Per-run transcript path prevents session concurrency corruption

#### Phase 4: Event Normalization & Billing

**Goal:** Ensure `parseResultEvent()` handles both runner outputs, billing is accurate, DB schema updated.

**Files:**

- **`src/lib/transcript-utils.ts`** - `parseResultEvent()`:
  - Already works for both runners since Phase 2 emits compatible field names
  - Add `runner: event.runner ?? null` to the `updates` object
  - Handle `cost_usd: null` gracefully (Phase 1's Zod fix prevents coercion to 0)

- **`src/lib/run-executor.ts`** - After `finalizeRun()`, if `cost_usd` is null and runner is `vercel-ai-sdk`:
  - Extract `generation_id` from the runner's `result` event (emitted in Phase 2)
  - Fire non-blocking cost lookup: `void resolveGatewayCost(runId, generationId)` - do NOT block `finalizeRun()`
  - `resolveGatewayCost()` calls `GET https://ai-gateway.vercel.sh/v1/generation?id={id}` with 3s `AbortSignal` timeout
  - On success, UPDATE run's `cost_usd` independently
  - On failure, log and leave cost null (best-effort)

- **`src/lib/runs.ts`** - `transitionRunStatus()` must persist `runner` field from updates

- **`src/db/migrations/020-add-runner-column.sql`** (NOT 018 - repo is at migration 019):
  ```sql
  -- Runner on agents: explicit user choice (NULL = use default for model)
  ALTER TABLE agents ADD COLUMN runner TEXT;
  -- Runner on runs: records which runner actually executed (always populated)
  ALTER TABLE runs ADD COLUMN runner TEXT DEFAULT 'claude-agent-sdk';
  -- Safe for zero-downtime: no table rewrite on Postgres 11+, brief ACCESS EXCLUSIVE lock only
  -- Old code ignores both columns; new code reading old rows gets NULL/default
  ```

### Research Insights (Phase 4)

**Migration numbering:** Repo is at migration 019. Using 018 would risk the migration runner skipping it. Must be 020.

**Migration safety:** `ALTER TABLE ... ADD COLUMN ... DEFAULT` is zero-downtime safe on Postgres 11+ (no table rewrite). Instant rollback via Vercel's one-click deploy rollback - old code doesn't reference the column.

**AI Gateway cost data:** Available via `GET https://ai-gateway.vercel.sh/v1/generation?id={generation_id}`. Returns `total_cost`, `tokens_prompt`, `tokens_completion`. The `generation_id` comes from the completion response's `id` field - need to capture this in the runner's result event.

**Non-blocking cost lookup is critical:** With AI Gateway latency (200-500ms), synchronous lookup in `finalizeRun()` would slow every non-Claude run. Fire-and-forget with independent DB update.

**Acceptance Criteria:**
- [ ] `parseResultEvent()` extracts `runner` field and passes to DB
- [ ] `cost_usd: null` stored as NULL (not coerced to 0)
- [ ] AI Gateway cost lookup is non-blocking (fire-and-forget after finalize)
- [ ] Cost lookup has 3s timeout via `AbortSignal`
- [ ] `runner` column populated for new runs, defaults to `'claude-agent-sdk'` for old runs
- [ ] Migration is numbered 020
- [ ] Budget checks work with token-based estimation when cost unavailable

#### Phase 5: Admin UI & API - Model Selection

**Goal:** Update admin forms + add tenant-facing model discovery.

**Files:**

- **`src/app/admin/(dashboard)/agents/add-agent-form.tsx`** - Replace hardcoded `MODELS` array with grouped provider list
- **`src/app/admin/(dashboard)/agents/[id]/edit-form.tsx`** - Same update
- **`src/app/api/admin/agents/models/route.ts`** - Admin endpoint that proxies AI Gateway model list with 5-min TTL cache
- **`src/app/api/models/route.ts`** (new) - Tenant-facing model discovery endpoint (same data, tenant auth)
- **`sdk/src/resources/models.ts`** (new) - `client.models.list()` method
- **`sdk/src/types.ts`** - Add `runner` to `Run` interface, add `runner` to `Agent` interface (nullable), add `runner` to `CreateAgentParams`/`UpdateAgentParams`, add `runner` to `ListRunsParams` for filtering, add `McpErrorEvent` and `SessionWarningEvent` to `KNOWN_EVENT_TYPES`

**Model selector UX:**
```
+- Model ------------------------------------------+
| v anthropic/claude-sonnet-4-6                    |
| +----------------------------------------------+ |
| | Anthropic                                    | |
| |   claude-opus-4-6                            | |
| |   claude-sonnet-4-6          <- curr         | |
| |   claude-haiku-4-5                           | |
| | OpenAI                                       | |
| |   gpt-4o                                    | |
| |   gpt-4o-mini                               | |
| |   o3                                        | |
| | Google                                       | |
| |   gemini-2.5-pro                            | |
| |   gemini-2.5-flash                          | |
| | -----------------------------------------   | |
| | Custom model ID...                          | |
| +----------------------------------------------+ |
+--------------------------------------------------+

+- Runner -----------------------------------------+
| (shown for Anthropic models only)                |
|                                                   |
|  (*) Claude Agent SDK  (default)                 |
|      Full agentic features: session resumption,  |
|      permission modes, CLAUDE.md, skill awareness |
|                                                   |
|  ( ) Vercel AI SDK                               |
|      Standard agent loop with tool use.          |
|      Same tools but no Claude-specific features. |
|                                                   |
| (auto-set to Vercel AI SDK for non-Claude models)|
+--------------------------------------------------+
```

**Runner selection logic:**
- Anthropic/Claude models: radio buttons, Claude Agent SDK selected by default
- Non-Claude models: runner field auto-set to "Vercel AI SDK" (read-only, no choice)
- Permission mode field shown only when Claude Agent SDK runner is selected

**Hardcoded fallback:** If AI Gateway model list is unavailable, fall back to a hardcoded list of popular models (top 3-5 per provider). Prevents empty dropdown on gateway outage.

### Research Insights (Phase 5)

**Agent-native parity gap (fixed):** The original plan had model discovery as admin-only. API clients need programmatic model discovery. Added tenant-facing `GET /api/models` and `client.models.list()`.

**SDK `Run` type gap (fixed):** The `Run` interface needs `runner?: 'claude-agent-sdk' | 'vercel-ai-sdk' | null` so clients can filter and inspect runner type.

**Acceptance Criteria:**
- [ ] Model dropdown shows models grouped by provider with runner badge
- [ ] Free text input for custom model IDs
- [ ] Runner radio buttons shown for Anthropic models (Claude SDK default, AI SDK option)
- [ ] Runner auto-set to Vercel AI SDK (read-only) for non-Claude models
- [ ] Permission mode field hidden/disabled when Vercel AI SDK runner selected
- [ ] Hardcoded fallback list shown when AI Gateway unavailable
- [ ] `GET /api/models` accessible with tenant API key
- [ ] `client.models.list()` works in SDK
- [ ] SDK `Run` type includes `runner` field
- [ ] SDK `ListRunsParams` supports `runner` filter
- [ ] `mcp_error` and `session_warning` in SDK `KNOWN_EVENT_TYPES`

#### Phase 6: Validation, Edge Cases & Hardening

**Goal:** Handle edge cases, complete security hardening.

**Files:**

- **`src/lib/validation.ts`** - Reject `permissionMode` non-default values when effective runner is `vercel-ai-sdk` with 400 error (not silent ignore). This means Claude models on Vercel AI SDK runner also cannot use permission modes. Document in SDK's `UpdateAgentParams` JSDoc.
- **`src/lib/runners/vercel-ai-runner.ts`** - Catch tool-use failures with clear error: "Model X does not support tool use"
- **`src/lib/a2a.ts`** - Agent Card `capabilities` field: omit tool-related capabilities when model is known to not support tools
- **`src/lib/mcp.ts`** - Validate MCP server URLs against network allowlist before serialization to `MCP_SERVERS_JSON`
- **`src/app/admin/(dashboard)/runs/`** - Run detail page: show `runner` badge
- **`src/app/admin/(dashboard)/agents/[id]/edit-form.tsx`** - Hide `permissionMode` when Vercel AI SDK runner selected

**Acceptance Criteria:**
- [ ] Agent with Vercel AI SDK runner and `permissionMode: 'plan'` returns 400 error via API
- [ ] Claude model with Vercel AI SDK runner and `permissionMode: 'plan'` also returns 400 error
- [ ] Model without tool support fails with descriptive error
- [ ] Run detail shows runner badge (Claude SDK / AI SDK)
- [ ] A2A Agent Card reflects actual capabilities
- [ ] MCP server URLs validated against network allowlist
- [ ] `permissionMode` behavior documented in SDK JSDoc

## Alternative Approaches Considered

1. **Unify everything on Vercel AI SDK** - Simpler architecture but loses Claude Agent SDK's session resumption, permission modes, CLAUDE.md awareness, and skill/plugin conventions. Rejected for now. (see origin)
2. **Build custom agent loop** - Maximum control but high maintenance burden. Vercel AI SDK already handles multi-provider tool use well. Rejected. (see origin)
3. **Provider-specific SDKs** - N different integrations (OpenAI Assistants, etc.). Too much surface area. Rejected. (see origin)

## System-Wide Impact

### Interaction Graph

- `prepareRunExecution()` -> `createSandbox()` -> calls `resolveEffectiveRunner(agent.model, agent.runner)` from `models.ts` -> branches to `claude-runner.ts` OR `vercel-ai-runner.ts`
- `captureTranscript()` -> unchanged (both runners emit same NDJSON)
- `parseResultEvent()` -> extracts `runner` field -> handles `cost_usd: null` -> fires non-blocking AI Gateway cost lookup
- `transitionRunStatus()` -> persists `runner` to DB
- A2A `SandboxAgentExecutor` -> unchanged (delegates to `prepareRunExecution()`)
- A2A `SandboxAgentExecutor` with AgentCo `ac_callback` DataPart -> `callbackData` flows through `prepareRunExecution()` -> `createSandbox()` writes bridge files + adds stdio entry to `MCP_SERVERS_JSON` -> Vercel AI SDK runner detects stdio transport and uses `StdioClientTransport`
- Session executor -> calls `resolveEffectiveRunner(agent.model, agent.runner)` -> branches for history management (Claude on Vercel AI SDK uses history, not resume)

### Error Propagation

- Vercel AI SDK errors surface as `error` events in NDJSON (same as Claude SDK)
- MCP client connection failures -> `mcp_error` event + run continues with available tools
- MCP tool name collisions -> `mcp_error` event + colliding tool skipped
- AI Gateway cost lookup failure -> cost stays null, tokens always recorded, non-blocking
- Model doesn't support tools -> runner catches and emits descriptive error event
- Path traversal attempt -> immediate error return from tool, no crash
- SSRF attempt -> immediate error return from `web_fetch`

### State Lifecycle Risks

- Snapshot must contain both SDKs - if refresh fails, both runners affected. Mitigation: fallback `installSdk()` now installs both SDKs.
- Session history file must be backed up BEFORE response ends (same TOCTOU pattern - use existing `allowOverwrite` pattern)
- Per-run transcript path (`transcript-<runId>.ndjson`) prevents concurrent session message corruption
- Non-Claude session with very large history mitigated by context window truncation + per-entry size cap

### API Surface Parity

- All API endpoints work with both model types - no changes to REST API contract
- SDK adds: `runner` on `Run`, `runner` filter on `ListRunsParams`, `client.models.list()`, `McpErrorEvent` + `SessionWarningEvent` types
- A2A protocol endpoints work identically - model type is transparent to A2A clients
- Tenant-facing `GET /api/models` mirrors admin model discovery - no orphan features

### Integration Test Scenarios

1. Create agent with `openai/gpt-4o` -> run with MCP tools -> verify event stream matches Claude format
2. Create session with non-Claude model -> send 3 messages -> verify history persists across turns
3. Schedule a non-Claude agent -> verify cron dispatches correctly -> run completes
4. A2A `message/stream` to non-Claude agent -> verify SSE events and task state
5. Mixed tenant: one Claude agent, one OpenAI agent -> concurrent runs -> both complete correctly
6. FS tool path traversal attempt (`../../runner.mjs`) -> verify rejection
7. `web_fetch` with `http://169.254.169.254/` -> verify SSRF blocked
8. MCP tool named `sandbox__read_file` -> verify collision detected and tool skipped
9. A2A message with AgentCo callback data to non-Claude agent -> verify callback bridge tools accessible via `mcp__agentco__*`
10. Claude model with `runner: 'vercel-ai-sdk'` -> verify runs on Vercel AI SDK path, not Claude Agent SDK
11. Claude model with `runner: 'vercel-ai-sdk'` session -> verify history-based context (not SDK resume)

## Acceptance Criteria

### Functional Requirements

- [ ] Non-Claude model runs produce identical NDJSON event format to Claude runs
- [ ] MCP tools (Composio + custom) work with non-Claude models
- [ ] File system, bash, and web tools work with non-Claude models (workspace-restricted)
- [ ] Sessions with non-Claude models preserve multi-turn context
- [ ] A2A works with non-Claude models identically
- [ ] Scheduled runs work with non-Claude models
- [ ] Admin UI shows multi-provider model selection
- [ ] Tenant API exposes model discovery
- [ ] Existing Claude agents work with zero changes

### Non-Functional Requirements

- [ ] Sandbox startup time <= 10% slower with dual-SDK snapshot
- [ ] MCP client initialization parallelized (not serial)
- [ ] AI Gateway cost lookup is non-blocking
- [ ] Token counts always available; cost available when gateway provides it

### Security Requirements

- [ ] Model IDs validated via regex (no injection)
- [ ] FS tools restricted to workspace directory
- [ ] Web fetch blocks non-HTTPS, private IPs, localhost
- [ ] Built-in tools namespaced to prevent MCP collisions
- [ ] MCP server URLs validated against network allowlist
- [ ] Session history entries size-capped

### Quality Gates

- [ ] Unit tests for `resolveRunnerType()`, event normalization, system prompt building, path validation
- [ ] Integration test: full run lifecycle with non-Claude model
- [ ] Integration test: session with non-Claude model (3+ turns)
- [ ] Integration test: security edge cases (path traversal, SSRF, tool collision)
- [ ] Existing test suite passes unchanged

## Dependencies & Prerequisites

- `ai` (Vercel AI SDK v5+), `@ai-sdk/mcp`, and `@modelcontextprotocol/sdk` (for stdio transport) npm packages - pin exact versions
- Vercel AI Gateway model list API (`https://ai-gateway.vercel.sh/v1/models`)
- AI Gateway generation lookup API for cost data
- DB migration 020 for `runner` column

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Vercel AI SDK breaking changes | High | Pin exact version in snapshot; test on upgrade |
| AI Gateway model list unavailable | Low | Hardcoded fallback list of popular models |
| Cost lookup API unreliable | Medium | Non-blocking, best-effort; tokens always available |
| MCP tool wiring incompatible with some providers | Medium | Test top 3 providers; fail with clear error |
| Snapshot size increase | Low | Monitor creation time; both SDKs are small |
| Path traversal / SSRF via tools | Critical | Workspace restriction + URL validation (Phase 2) |
| Model ID injection via gateway | High | Zod regex validation at ingestion (Phase 1) |
| MCP tool name collisions | Medium | `sandbox__` prefix + collision detection |
| Session history prompt injection | Medium | Entry size caps + trust boundary markers |

## Future Considerations

- **Tenant-managed provider keys** - Allow tenants to bring their own API keys (bypass gateway)
- **Model capability discovery** - Auto-detect tool support, context window, vision support per model
- **Unified runner** - If Vercel AI SDK matures enough, consider migrating Claude models too
- **Cost estimation** - Per-provider pricing tables for real-time budget enforcement
- **Model routing** - Automatic model selection based on task complexity or cost constraints
- **Session summarization tool** - Agent-driven context compression instead of hard truncation

## Documentation Plan

- Update CLAUDE.md with dual-runner architecture, `src/lib/models.ts`, `src/lib/runners/` directory
- Add `runner` field to API docs for runs
- Document supported model ID format (`provider/model-name`) with regex
- Document `permissionMode` restrictions for non-Claude models in SDK JSDoc
- Update SDK README with multi-model examples and `client.models.list()`

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-19-multi-model-support-requirements.md](docs/brainstorms/2026-03-19-multi-model-support-requirements.md) - Key decisions carried forward: dual runner architecture, Vercel AI SDK for non-Claude, Vercel AI Gateway for auth, normalize events to existing format

### Internal References

- Runner script templates: `src/lib/sandbox.ts:567` (`buildRunnerScript`), `src/lib/sandbox.ts:939` (`buildSessionRunnerScript`)
- Event parsing: `src/lib/transcript-utils.ts:11` (`parseResultEvent`)
- MCP config builder: `src/lib/mcp.ts`
- Admin agent forms: `src/app/admin/(dashboard)/agents/add-agent-form.tsx`, `src/app/admin/(dashboard)/agents/[id]/edit-form.tsx`
- Streaming learnings: `docs/solutions/logic-errors/transcript-capture-and-streaming-fixes.md`

### External References

- Vercel AI SDK docs: https://sdk.vercel.ai
- `@ai-sdk/mcp` - MCP client for AI SDK, supports SSE/HTTP/stdio transports, `client.tools()` returns AI SDK-compatible tools
- AI Gateway models API: `GET https://ai-gateway.vercel.sh/v1/models` (no auth, returns full model list with pricing)
- AI Gateway generation lookup: `GET https://ai-gateway.vercel.sh/v1/generation?id={id}` (returns `total_cost`, token counts)
- Vercel AI SDK agent loop: `stopWhen: stepCountIs(N)` with `onStepFinish` callback
- Vercel AI SDK streaming: `fullStream` emits `text-delta`, `tool-call`, `tool-result`, `finish-step`, `finish` events
- Vercel AI SDK usage: `await result.totalUsage` for cumulative tokens across all steps
- Vercel AI SDK messages: `ModelMessage` type with roles `user`, `assistant`, `tool`, `system`

### Review Reports

- TypeScript review: duplicate tool emission bug, `cost_usd` coercion, `RunnerType` extraction
- Security audit: 2 critical (path traversal, model injection), 3 high (SSRF, key exposure, session injection), 2 medium (tool collision, MCP URL)
- Architecture review: extract `isClaudeModel()` to shared module, split runner files, wire `runner` through `parseResultEvent()`
- Performance review: parallelize MCP clients, non-blocking cost lookup, fix fallback install
- Agent-native review: SDK needs `runner` on `Run`, tenant model discovery, new event types
- Deployment verification: migration numbering (020), snapshot fallback, zero-downtime safe
- Learnings check: event matrix documentation, single emission site for tools
- Agent-native architecture: add `bash` tool, on-demand skill injection, `complete_task` tool
