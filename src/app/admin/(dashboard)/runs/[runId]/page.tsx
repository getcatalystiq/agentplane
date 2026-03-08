import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { RunStatusBadge } from "@/components/ui/run-status-badge";
import { DetailPageHeader } from "@/components/ui/detail-page-header";
import { LocalDate } from "@/components/local-date";
import { queryOne } from "@/db";
import { RunRow } from "@/lib/validation";
import { TranscriptViewer } from "./transcript-viewer";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { runId } = await params;
  const { from } = await searchParams;

  const run = await queryOne(RunRow, "SELECT * FROM runs WHERE id = $1", [runId]);
  if (!run) notFound();

  // Fetch transcript
  let transcript: { type: string; [key: string]: unknown }[] = [];
  if (run.transcript_blob_url) {
    try {
      const res = await fetch(run.transcript_blob_url);
      if (res.ok) {
        const text = await res.text();
        transcript = text
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return { type: "raw", data: line };
            }
          });
      }
    } catch {
      // ok
    }
  }

  const backHref = from === "agent" ? `/admin/agents/${run.agent_id}` : "/admin/runs";
  const backLabel = from === "agent" ? "Agent" : "Runs";

  return (
    <div className="space-y-6">
      <DetailPageHeader
        backHref={backHref}
        backLabel={backLabel}
        title={<span className="font-mono">{run.id.slice(0, 12)}...</span>}
        badge={<RunStatusBadge status={run.status} />}
      />

      {/* Metadata cards */}
      <div className={`grid gap-4 ${run.result_summary ? "grid-cols-5" : "grid-cols-4"}`}>
        {run.result_summary && (
          <MetricCard label="Result Summary">
            <span className="line-clamp-1">{run.result_summary}</span>
            <p className="text-xs text-muted-foreground mt-0.5 font-normal">{run.status}</p>
          </MetricCard>
        )}
        <MetricCard label="Cost"><span className="font-mono">${run.cost_usd.toFixed(4)}</span></MetricCard>
        <MetricCard label="Turns">{run.num_turns}</MetricCard>
        <MetricCard label="Duration">
          {run.duration_ms > 0 ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"}
        </MetricCard>
        <MetricCard label="Tokens">
          {(run.total_input_tokens + run.total_output_tokens).toLocaleString()}
          <p className="text-xs text-muted-foreground mt-0.5 font-normal">
            {run.total_input_tokens.toLocaleString()} in / {run.total_output_tokens.toLocaleString()} out
          </p>
        </MetricCard>
      </div>

      {/* Errors */}
      {run.error_messages.length > 0 && (
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
      <TranscriptViewer transcript={transcript} prompt={run.prompt} />

      {/* Raw metadata */}
      <Card>
        <details>
          <summary className="flex items-center justify-between px-6 py-4 cursor-pointer list-none hover:bg-muted/30 transition-colors rounded-xl">
            <span className="text-base font-semibold">Metadata</span>
            <span className="text-xs text-muted-foreground details-marker">▼</span>
          </summary>
          <div className="px-6 pb-6">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Run ID</dt>
              <dd className="font-mono">{run.id}</dd>
              <dt className="text-muted-foreground">Agent ID</dt>
              <dd className="font-mono">{run.agent_id}</dd>
              <dt className="text-muted-foreground">Tenant ID</dt>
              <dd className="font-mono">{run.tenant_id}</dd>
              <dt className="text-muted-foreground">Sandbox ID</dt>
              <dd className="font-mono">{run.sandbox_id || "—"}</dd>
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
