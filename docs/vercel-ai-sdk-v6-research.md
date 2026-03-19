# Vercel AI SDK v6 — Research Findings

> Note: docs.ai-sdk.dev serves v6 (Latest) as of March 2026. The package is still `ai` but now at v6.x.

---

## 1. `streamText` with Tools

### Tool Definition (v6 uses `inputSchema`, not `parameters`)

```typescript
import { streamText, tool } from 'ai';
import { z } from 'zod';

const result = streamText({
  model: 'anthropic/claude-sonnet-4.5',
  tools: {
    getWeather: tool({
      description: 'Get the weather for a location',
      inputSchema: z.object({
        city: z.string().describe('City name'),
        unit: z.enum(['celsius', 'fahrenheit']).optional(),
      }),
      execute: async ({ city, unit }) => {
        return { temperature: 22, unit: unit ?? 'celsius' };
      },
    }),
  },
  prompt: 'What is the weather in Brooklyn?',
  onFinish: async ({ usage, steps }) => {
    // usage.inputTokens, usage.outputTokens available here
  },
});
```

**CRITICAL GOTCHA:** In v6, tool parameters use `inputSchema` (not `parameters`). The old `parameters` key is renamed.

### Tool Results Feed Back into the Loop

- When `execute` is defined on a tool, the SDK auto-executes it and feeds the result back into the next step.
- The loop continues if there are tool results in the last step AND `stopWhen` condition is not met.
- Default: `stopWhen: stepCountIs(1)` — only one agentic step by default. Must set higher to get multi-step.

---

## 2. `stopWhen` and `stepCountIs`

### Import Path
```typescript
import { streamText, generateText, stepCountIs, hasToolCall } from 'ai';
```

Both `stepCountIs` and `hasToolCall` are exported from the top-level `'ai'` package.

### Usage

```typescript
const result = streamText({
  model: 'anthropic/claude-sonnet-4.5',
  tools: { ... },
  stopWhen: stepCountIs(10),  // stop after 10 steps
  prompt: 'Do the thing',
});

// Or combine conditions (stops when ANY is met):
stopWhen: [stepCountIs(20), hasToolCall('finalAnswer')]
```

### Custom Stop Condition

```typescript
import { StopCondition, ToolSet } from 'ai';

const budgetExceeded: StopCondition<typeof tools> = ({ steps }) => {
  const total = steps.reduce((acc, step) => ({
    inputTokens: acc.inputTokens + (step.usage?.inputTokens ?? 0),
    outputTokens: acc.outputTokens + (step.usage?.outputTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0 });
  const cost = (total.inputTokens * 0.01 + total.outputTokens * 0.03) / 1000;
  return cost > 0.50;
};
```

### Gotchas
- Default `stopWhen` is `stepCountIs(1)` — a single model call with no agentic continuation.
- `ToolLoopAgent` class exists as an alternative higher-level abstraction but `streamText` + `stopWhen` is the primitive.
- `prepareStep` callback is available to modify messages per step (useful for prompt compression on long loops).

---

## 3. `@ai-sdk/mcp` — `createMCPClient`

### Import
```typescript
import { createMCPClient } from '@ai-sdk/mcp';
```

### HTTP Transport (Recommended for production — Streamable HTTP)
```typescript
const mcpClient = await createMCPClient({
  transport: {
    type: 'http',                              // streamable-HTTP (POST-based)
    url: 'https://your-server.com/mcp',
    headers: { Authorization: 'Bearer token' }, // optional
    authProvider: myOAuthClientProvider,        // optional OAuth
    redirect: 'error',                          // optional SSRF protection
  },
});
```

### SSE Transport
```typescript
const mcpClient = await createMCPClient({
  transport: {
    type: 'sse',
    url: 'https://my-server.com/sse',
    headers: { Authorization: 'Bearer my-api-key' },
    authProvider: myOAuthClientProvider,
    redirect: 'error',
  },
});
```

### Stdio Transport (local only)
```typescript
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// Or: import { Experimental_StdioMCPTransport as StdioClientTransport } from '@ai-sdk/mcp/mcp-stdio';

const mcpClient = await createMCPClient({
  transport: new StdioClientTransport({
    command: 'node',
    args: ['src/stdio/dist/server.js'],
  }),
});
```

### `client.tools()` — with optional schema definition
```typescript
// Simple (auto-discovers all tools):
const tools = await mcpClient.tools();

// Explicit (type-safe, only pulls listed tools):
const tools = await mcpClient.tools({
  schemas: {
    'get-data': {
      inputSchema: z.object({
        query: z.string().describe('The data query'),
        format: z.enum(['json', 'text']).optional(),
      }),
    },
    'tool-with-no-args': {
      inputSchema: z.object({}),
    },
  },
});
```

### Cleanup / Close Patterns

**Streaming (use `onFinish`):**
```typescript
const mcpClient = await createMCPClient({ ... });
const tools = await mcpClient.tools();
const result = streamText({
  model: 'anthropic/claude-sonnet-4.5',
  tools,
  prompt: '...',
  onFinish: async () => {
    await mcpClient.close();
  },
});
```

**Non-streaming (use try/finally):**
```typescript
import { type MCPClient } from '@ai-sdk/mcp';
let mcpClient: MCPClient | undefined;
try {
  mcpClient = await createMCPClient({ ... });
  // ... use it
} finally {
  await mcpClient?.close();
}
```

---

## 4. Vercel AI Gateway — Model Format

### Plain String (simplest, works directly in `streamText`/`generateText`)
```typescript
import { generateText, streamText } from 'ai';

const result = await generateText({
  model: 'xai/grok-4.1-fast-non-reasoning',  // format: "provider/model-name"
  prompt: '...',
});

// Examples:
// 'anthropic/claude-sonnet-4.5'
// 'openai/gpt-4o'
// 'anthropic/claude-opus-4.5'
```

No special configuration needed when running on Vercel — the gateway is automatically used. The `AI_GATEWAY_API_KEY` env var authenticates requests.

### `@ai-sdk/gateway` package (for explicit provider instance)
```typescript
import { gateway } from '@ai-sdk/gateway';

const result = await generateText({
  model: gateway('anthropic/claude-sonnet-4.5'),
  prompt: '...',
});
```

### Model ID format
`{creator}/{model-name}` e.g. `anthropic/claude-sonnet-4.6`, `openai/gpt-5.4`, `xai/grok-code-fast-1`

---

## 5. `fullStream` Event Types

```typescript
const result = streamText({ ... });

for await (const part of result.fullStream) {
  switch (part.type) {
    case 'text-delta':
      // part.textDelta: string
      break;
    case 'tool-call':
      // part.toolCallId, part.toolName, part.input
      break;
    case 'tool-result':
      // part.toolCallId, part.toolName, part.input, part.output
      break;
    case 'start':
      // Stream started
      break;
    case 'finish':
      // part.finishReason, part.usage
      break;
    case 'start-step':
      // New agentic step started
      break;
    case 'finish-step':
      // Agentic step finished; part.usage, part.finishReason, part.isContinued
      break;
    case 'source':
      // Grounding source (e.g. web search result)
      break;
    case 'reasoning':
      // Reasoning/thinking tokens
      break;
    case 'error':
      // part.error — non-fatal errors (fatal errors are thrown)
      break;
  }
}
```

**Type:** `AsyncIterable<TextStreamPart<TOOLS>> & ReadableStream<TextStreamPart<TOOLS>>`

The `messageMetadata` callback in `streamText` fires on `start`, `finish`, `start-step`, `finish-step` parts.

---

## 6. Usage / Token Tracking

### From `streamText` result
```typescript
const result = streamText({ ... });

// Async promise — resolves when stream finishes (last step only):
const usage = await result.usage;
// usage.inputTokens: number
// usage.outputTokens: number
// usage.totalTokens: number | undefined  (may include reasoning tokens)

// Total across all steps:
const totalUsage = await result.totalUsage;
```

### From `onFinish` callback (all steps)
```typescript
streamText({
  ...,
  onFinish: async ({ usage, steps }) => {
    // usage = total across all steps
    // steps[n].usage.inputTokens, steps[n].usage.outputTokens per step
  },
});
```

### From `finish-step` stream parts
```typescript
for await (const part of result.fullStream) {
  if (part.type === 'finish-step') {
    console.log(part.usage.inputTokens, part.usage.outputTokens);
  }
}
```

### From custom `StopCondition` (for budget enforcement)
```typescript
const budgetExceeded: StopCondition<typeof tools> = ({ steps }) => {
  const totalUsage = steps.reduce((acc, step) => ({
    inputTokens: acc.inputTokens + (step.usage?.inputTokens ?? 0),
    outputTokens: acc.outputTokens + (step.usage?.outputTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0 });
  return (totalUsage.inputTokens * 0.01 + totalUsage.outputTokens * 0.03) / 1000 > 0.50;
};
```

---

## 7. Message History Format (`ModelMessage`)

```typescript
import { generateText, streamText, ModelMessage } from 'ai';

const messages: ModelMessage[] = [
  { role: 'user', content: 'What is the weather?' },
  // After first call, push response.messages to continue:
];

const { response } = await generateText({ model: '...', messages });
messages.push(...response.messages);

// For streamText:
const result = streamText({ model: '...', messages });
messages.push(...(await result.response).messages);
```

### Role types
- `'user'` — user message
- `'assistant'` — model response (text + tool calls)
- `'tool'` — tool results (array of `tool-result` parts)
- `'system'` — system prompt

### Tool approval messages (new in v6)
```typescript
// role: 'tool' content can also include ToolApprovalResponse:
messages.push({ role: 'tool', content: approvals });
```

### `response.messages` property
Both `generateText` and `streamText` expose `response.messages` containing `ModelMessage[]` ready to be appended to conversation history. This is the canonical way to build multi-turn conversations.

---

## Key v6 Breaking Changes vs v5

| v5 | v6 |
|---|---|
| `parameters: z.object(...)` | `inputSchema: z.object(...)` |
| `maxSteps` | `stopWhen: stepCountIs(n)` |
| `experimental_*` for some features | Many graduated to stable |
| `CoreMessage` | `ModelMessage` |

---

## Sources

- `ai-sdk-streamText` — https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text (redirects to same page as generating-text)
- `ai-sdk-loop-control` — https://ai-sdk.dev/docs/agents/loop-control
- `ai-sdk-mcp-tools` — https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools
- `ai-sdk-tool-calling` — https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- `ai-sdk-providers` — https://ai-sdk.dev/docs/foundations/providers-and-models
- `ai-sdk-generating-text` — https://ai-sdk.dev/docs/ai-sdk-core/generating-text
