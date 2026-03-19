# Multi-Model Support Research

Research for adding Vercel AI SDK as a second runner path alongside the existing Claude Agent SDK.

---

## 1. `src/lib/sandbox.ts` — Runner Script Templates

### `buildRunnerScript` (line 572)

Takes `SandboxConfig` and returns an ES module string written to `/vercel/sandbox/runner.mjs`.

**Key config shape passed in (`SandboxConfig.agent`):**
- `model: string` — passed directly into `agentConfig.model`
- `permission_mode: string` → `permissionMode`
- `allowed_tools: string[]` → `allowedTools` (suppressed when MCP servers present)
- `max_turns: number` → `maxTurns`
- `max_budget_usd: number` → `maxBudgetUsd`
- `skills` → triggers `settingSources: ["project"]`

**Generated script (lines 592+):**
```js
import { query } from '@anthropic-ai/claude-agent-sdk';
import { writeFileSync, appendFileSync } from 'fs';

const config = { model, permissionMode, allowedTools, maxTurns, maxBudgetUsd, ... };
const prompt = "...";
const runId = process.env.AGENT_PLANE_RUN_ID;
// ... reads MCP_SERVERS_JSON from env
// ... streams NDJSON events (run_started, assistant, tool_use, tool_result, result, text_delta)
// ... uploads transcript to platform via AGENT_PLANE_PLATFORM_URL
```

**Environment variables injected into the sandbox command (lines 302–324):**
- `ANTHROPIC_BASE_URL` = `https://ai-gateway.vercel.sh`
- `ANTHROPIC_AUTH_TOKEN` = `config.aiGatewayApiKey`
- `ANTHROPIC_API_KEY` = `""` (blanked; AI Gateway key is used instead)
- `MCP_SERVERS_JSON` = JSON-stringified MCP server map
- `AGENTCO_CALLBACK_URL` / `AGENTCO_CALLBACK_TOKEN` for bridge

**Runner is launched via:**
```ts
sandbox.runCommand({ cmd: "node", args: ["runner.mjs"], env, detached: true })
```

### `buildSessionRunnerScript` (line 939)

Takes `SessionRunnerConfig`, writes per-message `runner-<runId>.mjs`. Same structure but adds:
- `includePartialMessages: true`
- `options: { resume: sessionId }` in the `query()` call for context continuity
- `hasMcp` flag suppresses `allowedTools` (same logic as one-shot)

### Key insight: the runner script is a **string template** — the entire Claude Agent SDK call is embedded as generated JS source code. Vercel AI SDK would need its own separate template function (`buildVercelAiRunnerScript`).

---

## 2. `src/lib/run-executor.ts` — Run Preparation

**`prepareRunExecution` params (lines 13–26):**
```ts
{
  agent: AgentInternal,
  tenantId: TenantId,
  runId: RunId,
  prompt: string,
  platformApiUrl: string,
  effectiveBudget: number,
  effectiveMaxTurns: number,
  maxRuntimeSeconds: number,
  extraAllowedHostnames?: string[],
  callbackData?: CallbackData,
}
```

**Flow:**
1. `Promise.all([buildMcpConfig(agent, tenantId), fetchPluginContent(agent)])`
2. `createSandbox(config)` — passes full `SandboxConfig` including `agent.model`
3. `transitionRunStatus(runId, "running")`
4. Returns `{ sandbox, logIterator, transcriptChunks }`

**`finalizeRun` (separate export):** consumes transcript chunks, calls `parseResultEvent`, records billing, uploads transcript. Shared with A2A and scheduled runs.

**Runner selection insertion point:** Between steps 1 and 2 — inspect `agent.model` (or a new `agent.runner` field) and call either `createSandbox` (Claude Agent SDK) or a new `createVercelAiSandbox` function.

---

## 3. `src/lib/session-executor.ts` — Session Message Execution

**`SessionExecutionParams` (lines 26–34):**
```ts
{
  sessionId: string,
  tenantId: TenantId,
  agent: AgentInternal,
  prompt: string,
  platformApiUrl: string,
  effectiveBudget: number,
  effectiveMaxTurns: number,
}
```

**Flow:**
1. `prepareSessionSandbox` — tries `reconnectSessionSandbox` first (hot path), falls back to `createSessionSandbox`
2. `buildMcpConfig` + `fetchPluginContent` + reconnect run in parallel via `Promise.all`
3. `runMessage(sandbox, ...)` — writes per-message runner script, executes it

**Gotcha:** Session runners use `resume: sessionId` from the Claude Agent SDK. Vercel AI SDK has no equivalent persistent session mechanism — this would need a different strategy (e.g., pass conversation history as context).

---

## 4. `src/lib/transcript-utils.ts` — Event Parsing

**`parseResultEvent` (lines 11–47):** Parses the final `result` or `error` NDJSON line:
```ts
// From result event:
cost_usd: event.total_cost_usd           // Claude Agent SDK specific
total_input_tokens: event.usage?.input_tokens
total_output_tokens: event.usage?.output_tokens
cache_read_tokens: event.usage?.cache_read_input_tokens
cache_creation_tokens: event.usage?.cache_creation_input_tokens
model_usage: event.modelUsage
num_turns: event.num_turns
duration_ms / duration_api_ms
```

**Gotcha:** All field names (`total_cost_usd`, `usage.input_tokens`, `modelUsage`) are Claude Agent SDK-specific. Vercel AI SDK emits different token usage shapes (`usage.promptTokens`, `usage.completionTokens`, no `total_cost_usd`). The runner script itself would need to synthesize a compatible `result` event, OR `parseResultEvent` needs a runner-type branch.

**`captureTranscript` (line 58):** Generic async generator — reads lines, processes assets, enforces `MAX_TRANSCRIPT_EVENTS = 10,000`. Fully runner-agnostic as long as lines are NDJSON.

---

## 5. `src/lib/validation.ts` — Model Field & Agent Schema

**`CreateAgentSchema` / `UpdateAgentSchema` (line 232):**
```ts
model: z.string().min(1).max(100).default("claude-sonnet-4-6")
```
- Unconstrained free-text string — accepts any value today.
- No enum restriction, so adding non-Claude models requires **no schema change**.
- Default is hardcoded to `"claude-sonnet-4-6"`.

**`AgentInternal` (inferred from schema):** includes `model`, `composio_toolkits`, `composio_allowed_tools`, `permission_mode`, `allowed_tools`, `max_turns`, `max_budget_usd`, `skills`, `plugins`, etc.

---

## 6. `src/lib/mcp.ts` — MCP Config Builder

**`buildMcpConfig(agent, tenantId): Promise<McpBuildResult>`**

Returns:
```ts
{
  servers: Record<string, McpServerConfig>,  // "http"|"sse"|"stdio" entries
  errors: string[],
}
```

**McpServerConfig union:**
```ts
| { type: "http" | "sse"; url: string; headers?: Record<string, string> }
| { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }
```

For Vercel AI SDK, MCP servers would need to be converted to `experimental_createMCPClient()` instances (only supports SSE/HTTP, not stdio). Stdio MCP servers (used by Composio) are a **blocker** for Vercel AI SDK unless run as a subprocess bridge. Custom MCP servers that use HTTP/SSE would work directly.

---

## 7. `src/lib/mcp-connections.ts`

Handles OAuth token refresh for custom MCP servers. Tokens are embedded as `Authorization` headers in `McpServerConfig` entries of type `http`/`sse`. Fully compatible with Vercel AI SDK's `experimental_createMCPClient` which accepts HTTP headers.

---

## 8. `src/lib/types.ts` — StreamEvent & Types

**`StreamEvent` union** (from the NDJSON stream): event types observed in runner code:
- `run_started`, `assistant`, `tool_use`, `tool_result`, `result`, `text_delta`, `error`, `stream_detached`, `session_info`

These are defined as wire-format strings in the runner template, not as a TypeScript discriminated union in `types.ts` itself. `types.ts` contains branded IDs, `RunStatus`, `RunTriggeredBy`, scheduling types — but **not** a `StreamEvent` union type.

---

## 9. `package.json` — Dependencies

The `ai` package (Vercel AI SDK) is **NOT currently installed**. Current AI-related deps:
- `@anthropic-ai/claude-agent-sdk` — used inside the sandbox (not in the host)
- `@ai-sdk/anthropic` is also **not** present

To add Vercel AI SDK runner support, you'd need to install `ai` and relevant provider packages (e.g., `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`) inside the **sandbox** (in the runner script's npm install step or snapshot), not in the host Next.js process.

---

## 10. `src/lib/a2a.ts` — A2A Model Agnosticism

`SandboxAgentExecutor` calls `prepareRunExecution` + `finalizeRun` — the same functions used by regular API runs. The A2A layer is **fully model-agnostic**: it does not reference `agent.model` directly. Model selection is delegated to the runner script via `SandboxConfig`. A2A will automatically benefit from multi-model support once the runner selection logic is in `prepareRunExecution`.

---

## Admin UI — Model Selection

**`edit-form.tsx`** (`src/app/admin/(dashboard)/agents/[agentId]/edit-form.tsx`, line 11):
```ts
const MODELS = [
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];
```

**`add-agent-form.tsx`** (`src/app/admin/(dashboard)/agents/add-agent-form.tsx`, line 12): same 3 models, default `claude-sonnet-4-6`.

Both use a `<Select>` component rendering `<option>` elements. Adding new models (GPT-4o, Gemini, etc.) is a straightforward array addition in **both files**.

---

## Implementation Plan Summary

### Where to add runner selection logic:

1. **New field on agent** (optional but clean): add `runner: "claude-agent-sdk" | "vercel-ai"` column to DB + validation schema, OR derive from model string prefix (`gpt-*`, `gemini-*` → Vercel AI SDK; `claude-*` → Claude Agent SDK).

2. **`src/lib/sandbox.ts`**: Add `buildVercelAiRunnerScript(config)` alongside `buildRunnerScript`. The Vercel AI SDK runner template would:
   - `import { generateText, streamText } from 'ai'`
   - Import the appropriate provider (`openai`, `anthropic`, `google`)
   - Convert `MCP_SERVERS_JSON` servers (HTTP/SSE only) to `experimental_createMCPClient()`
   - Emit the same NDJSON event format (`run_started`, `assistant`, `tool_use`, `result`) so `captureTranscript` + `parseResultEvent` work unchanged
   - Synthesize a `result` event with compatible token usage fields

3. **`src/lib/run-executor.ts` `prepareRunExecution`**: After building MCP config, branch on runner type to call `createSandbox` with the appropriate runner script.

4. **`src/lib/transcript-utils.ts` `parseResultEvent`**: Add a branch for Vercel AI SDK's token usage shape (`promptTokens`/`completionTokens`) or handle in the runner script itself.

5. **Snapshot**: The current SDK snapshot pre-installs `@anthropic-ai/claude-agent-sdk`. A new snapshot (or secondary snapshot) would need `ai` + provider packages. Alternatively, git-repo agents already do a fresh install — could extend that path.

### Key gotchas:

- **Stdio MCP** (used by Composio) is not supported by Vercel AI SDK's `experimental_createMCPClient`. Need subprocess bridge or skip Composio for Vercel AI SDK agents.
- **Session resume** (`options.resume: sessionId`) is Claude Agent SDK-specific. Sessions with Vercel AI SDK agents would need full conversation history passed each turn.
- **Cost calculation**: Vercel AI SDK does not emit `total_cost_usd`. The runner would need to compute it from token counts + model pricing table, or leave `cost_usd` null.
- **`permission_mode`** is Claude Agent SDK-specific. Can be ignored/no-op for Vercel AI SDK agents.
- **`allowed_tools`** maps to tool filtering; Vercel AI SDK uses explicit tool definitions rather than name-based allowlists.
- **`max_budget_usd`** is a Claude Agent SDK concept. Vercel AI SDK has no built-in budget enforcement — the platform's own budget check in `createRun` handles this regardless.
