# Vercel AI SDK Research (2025–2026)

Package: `ai` (+ `@ai-sdk/mcp` for MCP support)
Current major version: **5.0** (latest stable as of 2026)
Source: Context7 / vercel/ai official docs

---

## 1. MCP Client Support

Package: `@ai-sdk/mcp`

**API:** `createMCPClient({ transport })` — stable export (no longer `experimental_`).

Three transports are supported:

**stdio** (local only, dev/node):
```typescript
import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';

const client = await createMCPClient({
  transport: new Experimental_StdioMCPTransport({
    command: 'node',
    args: ['src/stdio/dist/server.js'],
  }),
});
```

**HTTP (Streamable HTTP)** — recommended for production:
```typescript
const client = await createMCPClient({
  transport: {
    type: 'http',
    url: 'https://your-server.com/mcp',
    headers: { Authorization: 'Bearer my-api-key' }, // optional
    authProvider: myOAuthClientProvider,             // optional OAuth
  },
});
```

**SSE:**
```typescript
const client = await createMCPClient({
  transport: {
    type: 'sse',
    url: 'http://localhost:3000/sse',
    headers: { Authorization: 'Bearer my-api-key' },
    authProvider: myOAuthClientProvider,
  },
});
```

**Converting MCP tools to AI SDK tools:**
```typescript
const tools = await client.tools(); // returns AI SDK tool-compatible object
// Merge multiple clients:
const allTools = { ...toolSetOne, ...toolSetTwo, ...toolSetThree };
```

Pass directly to `generateText` / `streamText`. Always close in `finally` / `onFinish` / `onError`.

---

## 2. Multi-Provider Tool Use

Tools are provider-agnostic. The `tools` parameter on `generateText`/`streamText` is a plain object.
Model ID format: `'openai/gpt-4o'`, `'openai/gpt-4o-mini'` (provider/model string for AI Gateway).
Provider packages: `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/mistral`, etc.

```typescript
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

const response = await generateText({
  model: 'openai/gpt-4o',
  tools: {
    weather: tool({
      description: 'Get the weather in a location',
      inputSchema: z.object({ location: z.string() }),
      execute: async ({ location }) => ({ location, temperature: 72 }),
    }),
  },
  stopWhen: stepCountIs(5),
  messages: [{ role: 'user', content: [{ type: 'text', text: 'What is the weather in NYC?' }] }],
});
```

---

## 3. Agent Loop (Multi-Step)

AI SDK 5.0 uses `stopWhen` (replaces `maxSteps` / `maxToolRoundtrips` from v3/v4):

```typescript
import { streamText, stepCountIs } from 'ai';

const result = streamText({
  model: 'openai/gpt-4o',
  tools,
  stopWhen: stepCountIs(5),   // run up to 5 tool-calling rounds
  onStepFinish: async ({ toolResults }) => {
    if (toolResults.length) console.log(toolResults);
  },
  messages,
});
```

The SDK automatically feeds tool results back to the model until `stopWhen` triggers or no more tool calls are made. No manual loop needed.

For manual control: use `createUIMessageStream` with multiple sequential `streamText` calls:
```typescript
const stream = createUIMessageStream({
  execute: async ({ writer }) => {
    const result1 = streamText({ model: '...', toolChoice: 'required', tools, messages });
    writer.merge(result1.toUIMessageStream({ sendFinish: false }));
    const result2 = streamText({
      model: '...',
      messages: [...convertToModelMessages(messages), ...(await result1.response).messages],
    });
    writer.merge(result2.toUIMessageStream({ sendStart: false }));
  },
});
```

---

## 4. Streaming Events

`streamText` returns an object with:
- `result.textStream` — `AsyncIterable<string>` of text deltas
- `result.fullStream` — `AsyncIterable` of typed part events

**Full stream event types** (AI SDK 5.0):
```
start | start-step | text-start | text-delta | text-end |
reasoning-start | reasoning-delta | reasoning-end |
source | file |
tool-call | tool-input-start | tool-input-delta | tool-input-end | tool-result | tool-error |
finish-step | finish | error | raw
```

**`onChunk` callback** (lightweight, fires per chunk):
```typescript
streamText({
  model,
  prompt: '...',
  onChunk({ chunk }) {
    if (chunk.type === 'text') console.log(chunk.text);
    // also: 'reasoning', 'source', 'tool-call'
  },
});
```

**`finish-step` event** — fires after each agent step; contains `usage` for that step.

---

## 5. Token Usage

**AI SDK 5.0 field names** (renamed from v3/v4):
- `inputTokens` (was `promptTokens`)
- `outputTokens` (was `completionTokens`)
- `totalTokens` (now **required**)

Available on:
- `result.usage` (Promise on `generateText`)
- `onFinish({ usage })` callback
- `finish-step` / `finish` stream events (via `part.usage`)
- Per-message metadata via `messageMetadata` on `toUIMessageStreamResponse`

```typescript
// onFinish callback
streamText({
  model,
  onFinish: ({ usage }) => {
    const { inputTokens, outputTokens, totalTokens } = usage;
  },
});

// finish stream event
for await (const part of result.fullStream) {
  if (part.type === 'finish') {
    console.log(part.usage); // { inputTokens, outputTokens, totalTokens }
  }
}
```

No built-in cost data — only token counts. Cost must be computed externally from token counts × model price.

---

## 6. AI Gateway Integration

Vercel AI Gateway is supported natively. Model ID format is `'provider/model'` string (plain string, not a provider function call):

```typescript
// AI Gateway format — string with provider prefix
const response = await generateText({
  model: 'openai/gpt-4o',        // routes through AI Gateway
  // model: 'anthropic/claude-3-5-sonnet-20241022'
  // model: 'google/gemini-2.0-flash'
  messages,
});
```

The `AI_GATEWAY_API_KEY` env variable (as used in this project) is picked up automatically by the SDK. No extra provider package required when using the gateway string format.

---

## 7. Conversation History (Multi-Turn)

Pass a `messages` array of `ModelMessage` objects. In v5, the type is `ModelMessage[]` (was `CoreMessage[]`):

```typescript
import { ModelMessage, streamText } from 'ai';

const messages: ModelMessage[] = [];

// Add user turn
messages.push({ role: 'user', content: userInput });

// Stream with history
const result = streamText({ model, messages, tools, stopWhen: stepCountIs(5) });

// After response, append assistant turn
messages.push({ role: 'assistant', content: fullResponse });
```

For chat apps, `convertToModelMessages()` converts UI messages (with parts) to model-compatible format:
```typescript
import { convertToModelMessages } from 'ai';

const modelMessages = await convertToModelMessages(uiMessages);
```

---

## Key Breaking Changes: v4 → v5

| v4 | v5 |
|---|---|
| `maxSteps: 5` | `stopWhen: stepCountIs(5)` |
| `maxToolRoundtrips` | removed, use `stopWhen` |
| `promptTokens` / `completionTokens` | `inputTokens` / `outputTokens` |
| `totalTokens` optional | `totalTokens` required |
| `CoreMessage` | `ModelMessage` |
| `experimental_createMCPClient` | `createMCPClient` (from `@ai-sdk/mcp`) |

---

## Sources

- https://github.com/vercel/ai/blob/main/content/docs/07-reference/01-ai-sdk-core/23-create-mcp-client.mdx
- https://github.com/vercel/ai/blob/main/content/docs/03-ai-sdk-core/16-mcp-tools.mdx
- https://github.com/vercel/ai/blob/main/content/cookbook/05-node/54-mcp-tools.mdx
- https://github.com/vercel/ai/blob/main/content/cookbook/01-next/73-mcp-tools.mdx
- https://github.com/vercel/ai/blob/main/content/docs/08-migration-guides/26-migration-guide-5-0.mdx
- https://ai-sdk.dev/docs/ai-sdk-core/generating-text
- https://ai-sdk.dev/docs/getting-started/nodejs
- https://ai-sdk.dev/cookbook/next/stream-text-multistep
- https://ai-sdk.dev/cookbook/node/manual-agent-loop
