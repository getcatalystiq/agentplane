"use client";

import { useState, useEffect } from "react";
import { useSWRConfig } from "swr";
import { useApi } from "../../hooks/use-api";
import { useAgentPlaneClient } from "../../hooks/use-client";
import { useRunStream } from "../../hooks/use-run-stream";
import { useToast } from "../../hooks/use-toast";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { MetricCard } from "../ui/metric-card";
import { LocalDate } from "../ui/local-date";
import { Skeleton } from "../ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { TranscriptViewer } from "./transcript-viewer";

interface RunDetail {
  id: string;
  agent_id: string;
  tenant_id: string;
  status: string;
  prompt: string;
  cost_usd: number | null;
  num_turns: number;
  duration_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  triggered_by: string;
  runner: string | null;
  error_type: string | null;
  error_messages: string[];
  result_summary: string | null;
  sandbox_id: string | null;
  transcript_blob_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  created_by_key_id: string | null;
  // Enriched fields from API
  agent_model?: string;
  requested_by_key_name?: string | null;
}

interface TranscriptEvent {
  type: string;
  [key: string]: unknown;
}

export interface RunDetailPageProps {
  runId: string;
  initialData?: RunDetail;
  initialTranscript?: TranscriptEvent[];
}

export function RunDetailPage({ runId, initialData, initialTranscript }: RunDetailPageProps) {
  const { mutate } = useSWRConfig();
  const { toast } = useToast();

  const { data: run, error, isLoading } = useApi<RunDetail>(
    `run-${runId}`,
    (client) => client.runs.get(runId) as Promise<RunDetail>,
    initialData ? { fallbackData: initialData } : undefined,
  );

  const { data: transcript } = useApi<TranscriptEvent[]>(
    run?.transcript_blob_url ? `transcript-${runId}` : null,
    (client) => client.runs.transcriptArray(runId) as Promise<TranscriptEvent[]>,
    initialTranscript ? { fallbackData: initialTranscript } : undefined,
  );

  const isActive = run?.status === "running" || run?.status === "pending";
  const { events, isStreaming, terminalEvent, streamingText } = useRunStream(
    runId,
    run?.status ?? "",
  );

  // When stream ends, show toast and revalidate run data
  useEffect(() => {
    if (!terminalEvent) return;
    toast({
      title: terminalEvent.type === "result" ? "Run completed" : "Run failed",
      variant: terminalEvent.type === "result" ? "success" : "destructive",
    });
    mutate(`run-${runId}`);
    mutate(`transcript-${runId}`);
  }, [terminalEvent, toast, mutate, runId]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-destructive">Failed to load run: {error.message}</p>
      </div>
    );
  }

  if (isLoading || !run) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {(run.status === "running" || run.status === "pending") && (
        <div className="flex items-center justify-end">
          <CancelRunButton runId={run.id} onCancelled={() => mutate(`run-${runId}`)} />
        </div>
      )}

      {/* A2A request origin */}
      {run.triggered_by === "a2a" && run.requested_by_key_name && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">A2A</Badge>
          <span>Requested by <span className="font-medium text-foreground">{run.requested_by_key_name}</span></span>
        </div>
      )}

      {/* Metadata cards */}
      <div className={`grid gap-4 ${run.result_summary ? "grid-cols-5" : "grid-cols-4"}`}>
        {run.result_summary && (
          <MetricCard label="Result Summary">
            <span className="line-clamp-1">{run.result_summary}</span>
            <p className="text-xs text-muted-foreground mt-0.5 font-normal">{run.status}</p>
          </MetricCard>
        )}
        <MetricCard label="Model">
          <span className="font-mono text-xs">{run.agent_model || "\u2014"}</span>
          <p className="text-xs text-muted-foreground mt-0.5 font-normal">
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${run.runner === "vercel-ai-sdk" ? "bg-blue-500/10 text-blue-400" : "bg-orange-500/10 text-orange-400"}`}>
              {run.runner === "vercel-ai-sdk" ? "AI SDK" : "Claude SDK"}
            </span>
          </p>
        </MetricCard>
        <MetricCard label="Cost">
          <span className="font-mono">
            ${(() => {
              const cost = terminalEvent?.cost_usd ?? run.cost_usd;
              return cost != null ? Number(cost).toFixed(4) : "\u2014";
            })()}
          </span>
        </MetricCard>
        <MetricCard label="Turns">
          {(terminalEvent?.num_turns as number | undefined) ?? run.num_turns}
        </MetricCard>
        <MetricCard label="Duration">
          {(() => {
            const ms = (terminalEvent?.duration_ms as number | undefined) ?? run.duration_ms;
            return ms > 0 ? `${(ms / 1000).toFixed(1)}s` : "\u2014";
          })()}
        </MetricCard>
        <MetricCard label="Tokens">
          {(() => {
            const inTok = (terminalEvent?.total_input_tokens as number | undefined) ?? run.total_input_tokens;
            const outTok = (terminalEvent?.total_output_tokens as number | undefined) ?? run.total_output_tokens;
            return (inTok + outTok).toLocaleString();
          })()}
          <p className="text-xs text-muted-foreground mt-0.5 font-normal">
            {((terminalEvent?.total_input_tokens as number | undefined) ?? run.total_input_tokens).toLocaleString()} in / {((terminalEvent?.total_output_tokens as number | undefined) ?? run.total_output_tokens).toLocaleString()} out
          </p>
        </MetricCard>
      </div>

      {/* Errors */}
      {run.error_messages && run.error_messages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">Errors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {run.error_type && (
              <Badge variant="destructive">{run.error_type}</Badge>
            )}
            {run.error_messages.map((msg, i) => (
              <pre key={i} className="whitespace-pre-wrap text-sm text-destructive font-mono bg-destructive/10 rounded-md p-3">
                {msg}
              </pre>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Transcript */}
      <TranscriptViewer
        transcript={isActive && isStreaming ? events : transcript || []}
        prompt={run.prompt}
        isStreaming={isActive && isStreaming}
      />

      {/* Streaming text accumulator */}
      {isActive && streamingText && (
        <div className="rounded-lg border bg-muted/30 p-4">
          <pre className="whitespace-pre-wrap text-sm font-mono">
            {streamingText}
            <span className="inline-block w-2 h-4 ml-0.5 bg-foreground/70 animate-pulse align-text-bottom" />
          </pre>
        </div>
      )}

      {/* Raw metadata */}
      <Card>
        <details>
          <summary className="flex items-center justify-between px-6 py-4 cursor-pointer list-none hover:bg-muted/30 transition-colors rounded-xl">
            <span className="text-base font-semibold">Metadata</span>
            <span className="text-xs text-muted-foreground">\u25BC</span>
          </summary>
          <div className="px-6 pb-6">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Run ID</dt>
              <dd className="font-mono">{run.id}</dd>
              <dt className="text-muted-foreground">Agent ID</dt>
              <dd className="font-mono">{run.agent_id}</dd>
              <dt className="text-muted-foreground">Company ID</dt>
              <dd className="font-mono">{run.tenant_id}</dd>
              <dt className="text-muted-foreground">Sandbox ID</dt>
              <dd className="font-mono">{run.sandbox_id || "\u2014"}</dd>
              <dt className="text-muted-foreground">Started</dt>
              <dd><LocalDate value={run.started_at} /></dd>
              <dt className="text-muted-foreground">Completed</dt>
              <dd><LocalDate value={run.completed_at} /></dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd><LocalDate value={run.created_at} /></dd>
            </dl>
          </div>
        </details>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cancel button (internal)                                           */
/* ------------------------------------------------------------------ */

function CancelRunButton({ runId, onCancelled }: { runId: string; onCancelled: () => void }) {
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const client = useAgentPlaneClient();

  async function handleConfirm() {
    setCancelling(true);
    try {
      await client.runs.cancel(runId);
      setOpen(false);
      onCancelled();
    } catch {
      // silently fail
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Stop Run
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Stop this run?</DialogTitle>
            <DialogDescription>
              This will terminate the sandbox immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={cancelling}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirm}
              disabled={cancelling}
            >
              {cancelling ? "Stopping\u2026" : "Stop Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
