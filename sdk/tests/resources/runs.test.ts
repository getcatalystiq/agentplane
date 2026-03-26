import { describe, it, expect, vi } from "vitest";
import { AgentPlane } from "../../src/index";
import type { Run } from "../../src/types";

function createStreamBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_1",
    agent_id: "agent_1",
    tenant_id: "tenant_1",
    status: "completed",
    prompt: "test",
    result_summary: "done",
    total_input_tokens: 100,
    total_output_tokens: 50,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cost_usd: 0.01,
    num_turns: 1,
    duration_ms: 5000,
    duration_api_ms: 4000,
    model_usage: null,
    transcript_blob_url: null,
    error_type: null,
    error_messages: [],
    sandbox_id: null,
    started_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:00:05Z",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("RunsResource.createAndWait", () => {
  it("returns immediately when stream ends and run is terminal", async () => {
    const completedRun = makeRun({ status: "completed" });

    const mockFetch = vi.fn()
      // 1st call: POST /api/runs (stream)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: createStreamBody([
          '{"type":"run_started","run_id":"run_1","agent_id":"a1","model":"claude","timestamp":"2026-01-01T00:00:00Z"}\n',
          '{"type":"result","subtype":"success","total_cost_usd":0.01}\n',
        ]),
      })
      // 2nd call: GET /api/runs/run_1 (final state)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(completedRun),
      });

    const client = new AgentPlane({
      apiKey: "ap_live_test1234567890abcdef12345678",
      baseUrl: "http://localhost:3000",
      fetch: mockFetch as unknown as typeof fetch,
    });

    const result = await client.runs.createAndWait({
      agent_id: "agent_1",
      prompt: "test",
    });

    expect(result.status).toBe("completed");
    expect(mockFetch).toHaveBeenCalledTimes(2); // stream + single GET
  });

  it("polls until terminal when stream ends with non-terminal status", async () => {
    const runningRun = makeRun({ status: "running" as Run["status"] });
    const completedRun = makeRun({ status: "completed" });

    const mockFetch = vi.fn()
      // 1st call: POST /api/runs (stream — ends without stream_detached)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: createStreamBody([
          '{"type":"run_started","run_id":"run_1","agent_id":"a1","model":"claude","timestamp":"2026-01-01T00:00:00Z"}\n',
          // Stream ends here — no stream_detached, no result event
        ]),
      })
      // 2nd call: GET /api/runs/run_1 — still running
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(runningRun),
      })
      // 3rd call: GET /api/runs/run_1 (poll from _pollUntilTerminal) — still running
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(runningRun),
      })
      // 4th call: GET /api/runs/run_1 (poll) — now completed
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(completedRun),
      });

    const client = new AgentPlane({
      apiKey: "ap_live_test1234567890abcdef12345678",
      baseUrl: "http://localhost:3000",
      fetch: mockFetch as unknown as typeof fetch,
    });

    const result = await client.runs.createAndWait({
      agent_id: "agent_1",
      prompt: "test",
    });

    expect(result.status).toBe("completed");
    // stream + initial GET (non-terminal) + 2 polls (running, completed)
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("polls after stream_detached event", async () => {
    const runningRun = makeRun({ status: "running" as Run["status"] });
    const completedRun = makeRun({ status: "completed" });

    const mockFetch = vi.fn()
      // 1st call: POST /api/runs (stream with detach)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: createStreamBody([
          '{"type":"run_started","run_id":"run_1","agent_id":"a1","model":"claude","timestamp":"2026-01-01T00:00:00Z"}\n',
          '{"type":"stream_detached","poll_url":"/api/runs/run_1","timestamp":"2026-01-01T00:04:30Z"}\n',
        ]),
      })
      // 2nd call: poll — still running
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(runningRun),
      })
      // 3rd call: poll — completed
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(completedRun),
      });

    const client = new AgentPlane({
      apiKey: "ap_live_test1234567890abcdef12345678",
      baseUrl: "http://localhost:3000",
      fetch: mockFetch as unknown as typeof fetch,
    });

    const result = await client.runs.createAndWait({
      agent_id: "agent_1",
      prompt: "test",
    });

    expect(result.status).toBe("completed");
    expect(mockFetch).toHaveBeenCalledTimes(3); // stream + 2 polls
  });

  it("handles failed terminal status", async () => {
    const failedRun = makeRun({
      status: "failed",
      error_type: "agent_error",
      error_messages: ["Something went wrong"],
    });

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: createStreamBody([
          '{"type":"run_started","run_id":"run_1","agent_id":"a1","model":"claude","timestamp":"2026-01-01T00:00:00Z"}\n',
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(failedRun),
      });

    const client = new AgentPlane({
      apiKey: "ap_live_test1234567890abcdef12345678",
      baseUrl: "http://localhost:3000",
      fetch: mockFetch as unknown as typeof fetch,
    });

    const result = await client.runs.createAndWait({
      agent_id: "agent_1",
      prompt: "test",
    });

    expect(result.status).toBe("failed");
    expect(result.error_messages).toEqual(["Something went wrong"]);
    expect(mockFetch).toHaveBeenCalledTimes(2); // stream + single GET (already terminal)
  });
});

describe("RunsResource.stream", () => {
  it("streams events from an already-running run", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: createStreamBody([
        '{"type":"run_started","run_id":"run_1","agent_id":"a1","model":"claude","timestamp":"2026-01-01T00:00:00Z"}\n',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}\n',
        '{"type":"result","subtype":"success","total_cost_usd":0.01}\n',
      ]),
    });

    const client = new AgentPlane({
      apiKey: "ap_live_test1234567890abcdef12345678",
      baseUrl: "http://localhost:3000",
      fetch: mockFetch as unknown as typeof fetch,
    });

    const stream = await client.runs.stream("run_1");
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]!.type).toBe("run_started");
    expect(events[2]!.type).toBe("result");

    // Verify it called GET /api/runs/run_1/stream
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0]!;
    expect(url.toString()).toContain("/api/runs/run_1/stream");
  });

  it("passes offset as query parameter", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: createStreamBody([
        '{"type":"result","subtype":"success","total_cost_usd":0.01}\n',
      ]),
    });

    const client = new AgentPlane({
      apiKey: "ap_live_test1234567890abcdef12345678",
      baseUrl: "http://localhost:3000",
      fetch: mockFetch as unknown as typeof fetch,
    });

    const stream = await client.runs.stream("run_1", { offset: 42 });
    for await (const _event of stream) {
      // consume
    }

    const [url] = mockFetch.mock.calls[0]!;
    expect(url.toString()).toContain("offset=42");
  });
});
