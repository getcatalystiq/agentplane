---
date: 2026-03-19
topic: multi-model-support
---

# Multi-Model Agent Support

## Problem Frame

AgentPlane is currently locked to Claude models via the Claude Agent SDK. Tenants want to run agents powered by other models (OpenAI, Google, Mistral, MiniMax, etc.) for cost optimization, capability access (e.g. image/video generation), and flexibility. Being model-agnostic also strengthens competitive positioning. All existing AgentPlane functionality — including A2A protocol, sessions, MCP tools, streaming, and billing — must continue to work regardless of which model powers an agent.

## Requirements

- R1. **Dual runner architecture** — Claude models continue using Claude Agent SDK inside the sandbox. Non-Claude models use Vercel AI SDK. The runner path is selected based on the agent's configured model.
- R2. **All Vercel AI Gateway providers supported** — Any model available through Vercel AI Gateway can be used. The `model` field on agents accepts provider-prefixed model IDs (e.g. `openai/gpt-4o`, `google/gemini-2.5-pro`, `mistral/mistral-large`). Claude models (unprefixed or `anthropic/` prefixed) continue using the Claude Agent SDK path.
- R3. **Vercel AI Gateway for all providers** — All model calls route through Vercel AI Gateway using the existing `AI_GATEWAY_API_KEY`. No tenant-managed provider keys required.
- R4. **Full tool parity for non-Claude agents** — Non-Claude agents must have access to MCP servers (Composio + custom), file system tools (read/write/edit), and web tools (search/fetch). The Vercel AI SDK runner wires these up as AI SDK tools.
- R5. **Normalized streaming events** — Non-Claude runs emit the same NDJSON event format as Claude runs (`run_started`, `assistant`, `tool_use`, `tool_result`, `result`, `text_delta`). Existing clients require zero changes.
- R6. **Sessions for all models** — Multi-turn sessions work with any model. For non-Claude models, the platform manages conversation history (message array stored and replayed each turn) instead of relying on Claude Agent SDK's `resume` feature. Sandbox persistence works the same.
- R7. **A2A protocol works with any model** — A2A Agent Cards, JSON-RPC endpoints, and task lifecycle are model-agnostic. The A2A layer already routes through run-executor; no A2A-specific changes needed beyond ensuring the executor handles both runner paths.
- R8. **Billing and token tracking** — Token usage and cost are captured for all providers. Vercel AI SDK exposes usage metadata; the result event parser extracts it regardless of provider.
- R9. **Scheduling works with any model** — Scheduled runs dispatch to the correct runner path based on agent model. No schedule-specific changes beyond runner selection.
- R10. **Admin UI model selection** — Agent create/edit forms allow selecting from available models across providers. Model field accepts free text (for new models) with a dropdown of known models grouped by provider.

## Success Criteria

- A tenant can create an agent with `model: "openai/gpt-4o"`, trigger a run, and receive streamed results in the existing event format
- The same agent can use Composio toolkits and custom MCP servers
- A session with a non-Claude agent preserves conversation context across multiple messages
- An A2A client can interact with a non-Claude agent identically to a Claude agent
- Existing Claude agents continue working with zero changes
- Token usage and costs are tracked for all providers

## Scope Boundaries

- **Not changing Claude Agent SDK path** — Claude models keep all existing features (permission modes, session resumption, CLAUDE.md, skill/plugin awareness)
- **No tenant-managed provider keys** — All routing through Vercel AI Gateway; tenant key management is a potential future feature
- **No per-provider capability negotiation** — If a model doesn't support tool use, the run fails with a clear error rather than silently degrading
- **No model recommendation engine** — Tenants choose their model; the platform doesn't suggest alternatives
- **Permission modes are Claude-only** — `permissionMode` (default/acceptEdits/bypassPermissions/plan) only applies to Claude Agent SDK runs. Non-Claude runs execute with full tool access in the sandbox.
- **Skills/plugins injection unchanged** — Skill and plugin files are still injected into the sandbox for all models, but only Claude Agent SDK understands `.claude/` conventions natively. For non-Claude models, skill content must be included in the system prompt or tool descriptions.

## Key Decisions

- **Dual runner, not unified**: Keeping Claude Agent SDK for Claude models preserves session resumption, permission modes, and the rich agentic features. The cost is maintaining two runner paths, but the coupling analysis shows this is contained to `sandbox.ts` runner templates.
- **Vercel AI SDK for non-Claude**: Natural fit given the Vercel deployment. Handles provider abstraction, tool-use protocol, and streaming. Avoids building/maintaining a custom agent loop.
- **Vercel AI Gateway for auth**: Eliminates tenant key management complexity. Single gateway key handles all providers.
- **Normalize events, don't pass through**: Keeps the client contract stable. The mapping layer lives in the Vercel AI SDK runner script inside the sandbox.

## Dependencies / Assumptions

- Vercel AI Gateway supports the providers tenants want (confirmed: OpenAI, Google, Mistral, and others)
- Vercel AI SDK's tool-use abstraction can wire up MCP server tools (MCP client → AI SDK tool adapter)
- Vercel AI SDK provides token usage metadata in a parseable format for billing
- `@anthropic-ai/claude-agent-sdk` npm package continues to be available and maintained

## Outstanding Questions

### Resolve Before Planning

(none — all product decisions resolved)

### Deferred to Planning

- [Affects R2][Needs research] How does Vercel AI SDK model identification work with the AI Gateway? Does it use provider-prefixed IDs natively or need a mapping layer?
- [Affects R4][Needs research] What's the best pattern for wiring MCP server connections as Vercel AI SDK tools inside the sandbox? Does `@vercel/ai` have native MCP support or do we need an adapter?
- [Affects R5][Technical] Exact mapping table from Vercel AI SDK stream events to AgentPlane NDJSON events — which fields exist, which need synthesizing?
- [Affects R6][Technical] Session history storage format for non-Claude models — store in sandbox filesystem (like Claude SDK) or in Vercel Blob directly? What's the size/performance trade-off?
- [Affects R8][Needs research] Does Vercel AI Gateway provide unified cost data, or do we need per-provider pricing tables for cost calculation?
- [Affects R4][Technical] How to implement file system tools (read/write/edit) and web tools for the Vercel AI SDK runner — build as AI SDK tool definitions that operate on the sandbox filesystem?
- [Affects R6][Technical] For non-Claude sessions, how to handle conversation history that exceeds model context windows — truncation strategy, summarization, or sliding window?
- [Affects R10][Technical] How to discover available models from Vercel AI Gateway for the admin UI dropdown?

## Next Steps

→ `/ce:plan` for structured implementation planning
