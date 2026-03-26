"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAgentPlaneClient } from "./use-client";
import type { StreamEventLike } from "../types";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "timed_out"]);
const ACTIVE_STATUSES = new Set(["running", "pending"]);

interface UseRunStreamResult {
  /** Accumulated stream events (grows during streaming). */
  events: StreamEventLike[];
  /** Whether the stream is currently active. */
  isStreaming: boolean;
  /** The terminal event (result or error) if the stream has ended. */
  terminalEvent: StreamEventLike | null;
  /** Accumulated text from text_delta events (cleared when assistant event arrives). */
  streamingText: string;
  /** Stream error, if any. */
  error: Error | null;
}

/**
 * React hook that streams events from an in-progress run using the SDK client.
 *
 * - Only streams when `status` is "running" or "pending"
 * - Returns accumulated events, streaming state, and terminal event
 * - Handles cleanup on unmount or when runId/status changes
 * - Accumulates text_delta events into streamingText
 */
export function useRunStream(
  runId: string | null,
  status: string,
): UseRunStreamResult {
  const client = useAgentPlaneClient();
  const [events, setEvents] = useState<StreamEventLike[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [terminalEvent, setTerminalEvent] = useState<StreamEventLike | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async (id: string, signal: AbortSignal) => {
    setIsStreaming(true);
    setError(null);

    try {
      const stream = await client.runs.stream(id, { signal });

      for await (const event of stream) {
        if (signal.aborted) break;

        // Accumulate text_delta events
        if (event.type === "text_delta") {
          const text = (event as { text?: string }).text ?? "";
          setStreamingText((prev) => prev + text);
          continue; // Don't add text_delta to events array (stream-only)
        }

        // When an assistant event arrives, clear accumulated streaming text
        if (event.type === "assistant") {
          setStreamingText("");
        }

        // Skip stream_detached — RunStream handles reconnection internally
        if (event.type === "stream_detached") {
          continue;
        }

        setEvents((prev) => [...prev, event]);

        // Detect terminal events
        if (event.type === "result" || event.type === "error") {
          setTerminalEvent(event);
          setIsStreaming(false);
          setStreamingText("");
          return;
        }
      }

      // Stream ended without terminal event (connection dropped or completed run)
      setIsStreaming(false);
    } catch (err) {
      if (signal.aborted) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsStreaming(false);
    }
  }, [client]);

  useEffect(() => {
    // Only stream for active runs
    if (!runId || !ACTIVE_STATUSES.has(status)) {
      setIsStreaming(false);
      return;
    }

    // Don't re-stream if we already have a terminal event
    if (terminalEvent) return;

    const controller = new AbortController();
    abortRef.current = controller;

    startStream(runId, controller.signal);

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [runId, status, startStream, terminalEvent]);

  return { events, isStreaming, terminalEvent, streamingText, error };
}
