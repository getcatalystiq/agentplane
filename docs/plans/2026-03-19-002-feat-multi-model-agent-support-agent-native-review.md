---
title: "Agent-Native Architecture Review: Multi-Model Agent Support Plan"
type: review
status: active
date: 2026-03-19
reviews: docs/plans/2026-03-19-002-feat-multi-model-agent-support-plan.md
skill: agent-native-architecture
---

# Agent-Native Architecture Review: Multi-Model Agent Support

Applying the agent-native-architecture skill to the multi-model plan. The plan is technically solid but has several gaps when evaluated against agent-native principles.

---

## Checklist Evaluation

### Parity
**Status: Partial gap**

The plan maintains API surface parity (all endpoints work with both runners). However, there is a specific parity break:

- `permissionMode` is silenced/rejected for non-Claude models (Phase 6)
- Skills are injected differently (`.claude/skills/` natively for Claude vs. system prompt injection for non-Claude)

The skill files pattern (`SKILL.md` at `.claude/skills/`) was designed so agents read files natively using the file system tools that Claude Agent SDK provides. For non-Claude models, the plan proposes injecting skill content into the system prompt instead — this is a form of parity degradation because:

1. Claude agents can dynamically read, reference, and reason about skill files at runtime
2. Non-Claude agents get a static dump in the system prompt, which grows unbounded as more skills are added

**Recommendation:** Give non-Claude runners the same `read_file`, `write_file`, `list_files` tools the plan already defines, AND inject a brief skill index into the system prompt listing available skill files by path. Let the agent read them on demand rather than pre-loading everything. This preserves the file-as-interface pattern and avoids bloated system prompts.

### Granularity
**Status: Mixed — good in places, anti-pattern in one spot**

The plan's runner script defines atomic file system tools (`read_file`, `write_file`, `list_files`, `web_fetch`) — this is correct. However, the session context window overflow strategy in Phase 3 encodes judgment in code:

```
When approaching 80% of model's context window, truncate oldest messages
(keep system prompt + last N turns)
```

This is the "happy path in code, agent just executes" anti-pattern. The truncation policy (what to keep, what to drop) is a judgment call that would be better expressed as a prompt instruction, not hardcoded logic.

**Recommendation:** Instead of hardcoding the 80% truncation rule, inject a `session_summary` tool that the agent can call to compress history when it detects context pressure. The system prompt instructs: "When your context is getting large, call `session_summary` to compress older turns." The agent decides when and how to summarize, not your code.

### Composability
**Status: Good**

The dual-runner normalization to the same NDJSON format is correct — it means new features (scheduled runs, A2A, sessions) compose with any model without new code. No changes needed here.

### Emergent Capability
**Status: Gap in non-Claude runner**

The Vercel AI SDK runner in Phase 2 defines a fixed tool set (`read_file`, `write_file`, `list_files`, `web_fetch`). For Claude models, the Claude Agent SDK provides `bash` natively, giving the agent enormous emergent capability.

Without `bash` (or an equivalent escape hatch), non-Claude agents cannot:
- Install npm packages at runtime
- Run arbitrary scripts
- Perform operations not anticipated by the three file tools

**Recommendation:** Add a `bash` tool to the Vercel AI SDK runner's default tool set. The sandbox network allowlist already limits blast radius. This is the single highest-leverage addition for emergent capability. If there's a specific reason to exclude it, document it explicitly.

---

## Specific Gaps and Recommendations

### 1. Explicit Completion Signal (High Priority)

The plan relies on `stopWhen: stepCountIs(maxTurns)` as the completion mechanism for non-Claude runs. This is heuristic completion detection — the skill's anti-pattern list calls this out specifically:

> "Detecting agent completion through heuristics... is fragile. Fix: Require agents to explicitly signal completion through a `complete_task` tool."

The Claude Agent SDK runner completes when `query()` returns — which is driven by the model calling a stop signal internally. The Vercel AI SDK runner should mirror this.

**Recommendation:** Add a `complete_task` tool to the Vercel AI SDK runner:

```typescript
complete_task: {
  description: 'Signal that you have completed the task. Call this when your work is done.',
  parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  execute: async ({ summary }) => {
    emit({ type: 'task_complete', summary });
    return 'Task marked complete.';
  }
}
```

Update `stopWhen` to also stop on `complete_task` call (Vercel AI SDK supports custom stop conditions). Use `stepCountIs(maxTurns)` only as a safety ceiling, not the primary completion mechanism.

### 2. Context Injection (Dynamic State in System Prompt)

The current plan builds `systemPrompt` from `agent.system_prompt` + skill content. It does not inject runtime context about what exists in the sandbox or what capabilities are available.

The skill's anti-pattern is "context starvation":

> "Agent: 'What feed? I don't understand what system you're referring to.'"

For non-Claude agents, the system prompt should include:
- Available MCP tools (tool names and descriptions, not just tool objects)
- Available file system primitives
- Session history metadata (turn count, model, total tokens used) for session runs

**Recommendation:** Extend `buildSystemPrompt()` to inject a `## Available Capabilities` section listing tool names with one-line descriptions, and a `## Context` section with current session state for session runs.

### 3. CRUD Completeness for Session History

Phase 3 defines session history as a JSON file agents write to. The runner reads and writes this file, but the agent itself has no tool to inspect or modify session history directly.

If a user asks a non-Claude agent: "Forget everything I said about X" — the agent cannot edit the history file because its only file tool is `write_file` (full overwrite), and it doesn't know where the history file is.

**Recommendation:** Expose the session history path to the agent via the system prompt. Since `write_file` can overwrite the full file, the agent technically has the capability — but it needs to know where the file is and what format it uses. Add to the system prompt: "Session history is stored at `/vercel/sandbox/session-history.json` in JSON format with a `messages` array."

### 4. Model Capability Discovery Should Be Agent-Driven

Phase 5 plans a `/api/admin/agents/models` endpoint that proxies AI Gateway's model list. The UI uses this to show available models. This is good infrastructure.

However, Phase 6's handling of model capabilities (tool support, vision support) is static: "best-effort, fail at runtime." This is a missed opportunity for agent-native design.

**Recommendation:** When a non-Claude run fails with a tool-use error, the runner should emit a structured `capability_error` event with `{ capability: 'tool_use', model }`. The platform can record this (a new `model_capabilities` cache, or a column on the `runs` table) and surface it in the UI next time that model is selected. The platform learns what models can do by observing what fails — the emergent capability flywheel applied to model metadata.

### 5. Shared Workspace Pattern for Sessions

The plan stores session history at `/vercel/sandbox/session-history.json`. This is correct — agent and user share the same sandbox as the workspace. But the cleanup cron and session file backup treat this as an implementation detail rather than a first-class contract.

**Recommendation:** Document `/vercel/sandbox/session-history.json` as the canonical session workspace file in `sandbox.ts` (as a named constant, not an inline string). Both the runner script and `session-files.ts` backup logic should reference this constant. This makes the shared workspace explicit and prevents path drift.

---

## Summary Table

| Principle | Status | Key Gap | Recommendation |
|---|---|---|---|
| Parity | Partial | Skills injected statically vs. dynamically | Inject skill index; let agent read files on demand |
| Granularity | Mixed | Context truncation logic in code | Add `session_summary` tool; agent decides when to compress |
| Composability | Good | — | No changes needed |
| Emergent Capability | Gap | No `bash` tool in non-Claude runner | Add `bash` to default tool set |
| Completion Signals | Gap | `stepCountIs` is heuristic detection | Add `complete_task` tool; use step count as ceiling only |
| Context Injection | Gap | System prompt lacks runtime capability listing | Inject `## Available Capabilities` section |
| CRUD Completeness | Partial | Agent doesn't know session history path | Document path in system prompt |
| Shared Workspace | Partial | History path is an inline string | Extract to named constant in `sandbox.ts` |

---

## Priority Order for Incorporation

1. **Add `complete_task` tool** (Phase 2) — prevents stuck runs and matches existing platform semantics
2. **Add `bash` tool** (Phase 2) — highest emergent capability leverage, sandbox already limits blast radius
3. **Skill index + on-demand reading** (Phase 2) — prevents system prompt bloat as skill libraries grow
4. **Inject capabilities into system prompt** (Phase 2) — prevents context starvation for non-Claude agents
5. **`session_summary` tool** (Phase 3) — replaces hardcoded truncation policy with agent judgment
6. **Structured `capability_error` events** (Phase 4/6) — enables platform-level model capability learning
7. **Named constant for history path** (Phase 3) — minor but prevents future bugs
