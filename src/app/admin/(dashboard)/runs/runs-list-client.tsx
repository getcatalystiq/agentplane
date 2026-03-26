"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminTable, AdminTableHead, AdminTableRow, Th, EmptyRow } from "@/components/ui/admin-table";
import { RunStatusBadge } from "@/components/ui/run-status-badge";
import { RunSourceBadge } from "@/components/ui/run-source-badge";
import { LocalDate } from "@/components/local-date";
import { toast } from "@/hooks/use-toast";
import type { RunTriggeredBy } from "@/lib/types";

interface RunItem {
  id: string;
  agent_id: string;
  agent_name: string;
  tenant_id: string;
  status: string;
  prompt: string;
  cost_usd: number;
  num_turns: number;
  duration_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  triggered_by: RunTriggeredBy;
  error_type: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface RunsListClientProps {
  initialRuns: RunItem[];
  total: number;
  page: number;
  pageSize: number;
  sourceFilter: string | null;
  paginationBar: React.ReactNode;
  sourceFilterBar: React.ReactNode;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "timed_out"]);
const POLL_INTERVAL = 5000;

export function RunsListClient({
  initialRuns,
  total,
  page,
  pageSize,
  sourceFilter,
  paginationBar,
  sourceFilterBar,
}: RunsListClientProps) {
  const router = useRouter();
  const [runs, setRuns] = useState(initialRuns);
  const prevStatusRef = useRef<Map<string, string>>(new Map());

  // Initialize status tracking
  useEffect(() => {
    const map = new Map<string, string>();
    initialRuns.forEach((r) => map.set(r.id, r.status));
    prevStatusRef.current = map;
    setRuns(initialRuns);
  }, [initialRuns]);

  const hasActiveRuns = runs.some((r) => !TERMINAL_STATUSES.has(r.status));

  const poll = useCallback(async () => {
    try {
      const offset = (page - 1) * pageSize;
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
      });
      if (sourceFilter) params.set("source", sourceFilter);

      const res = await fetch(`/api/admin/runs?${params.toString()}`);
      if (!res.ok) return;

      const body = await res.json();
      const freshRuns: RunItem[] = body.data || [];

      // Detect status transitions
      for (const r of freshRuns) {
        const prev = prevStatusRef.current.get(r.id);
        if (prev && !TERMINAL_STATUSES.has(prev) && TERMINAL_STATUSES.has(r.status)) {
          const success = r.status === "completed";
          toast({
            title: success ? "Run completed" : `Run ${r.status}`,
            description: `${r.agent_name} - ${r.id.slice(0, 8)}...`,
            variant: success ? "success" : r.status === "failed" ? "destructive" : "default",
          });
        }
      }

      // Update tracking
      const map = new Map<string, string>();
      freshRuns.forEach((r) => map.set(r.id, r.status));
      prevStatusRef.current = map;

      setRuns(freshRuns);
    } catch {
      // Silently ignore polling errors
    }
  }, [page, pageSize, sourceFilter]);

  useEffect(() => {
    if (!hasActiveRuns) return;

    const interval = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [hasActiveRuns, poll]);

  return (
    <div>
      <div className="flex items-center mb-6">
        {sourceFilterBar}
      </div>
      <AdminTable className="overflow-x-auto" footer={paginationBar}>
        <AdminTableHead>
          <Th>Run</Th>
          <Th>Agent</Th>
          <Th>Status</Th>
          <Th>Source</Th>
          <Th className="max-w-xs">Prompt</Th>
          <Th align="right">Cost</Th>
          <Th align="right">Turns</Th>
          <Th align="right">Duration</Th>
          <Th>Created</Th>
        </AdminTableHead>
        <tbody>
          {runs.map((r) => (
            <AdminTableRow key={r.id}>
              <td className="p-3 font-mono text-xs">
                <Link href={`/admin/runs/${r.id}`} className="text-primary hover:underline">
                  {r.id.slice(0, 8)}...
                </Link>
              </td>
              <td className="p-3 text-xs">{r.agent_name}</td>
              <td className="p-3"><RunStatusBadge status={r.status} /></td>
              <td className="p-3">
                <RunSourceBadge triggeredBy={r.triggered_by} />
              </td>
              <td className="p-3 max-w-xs truncate text-muted-foreground text-xs" title={r.prompt}>
                {r.prompt.slice(0, 80)}{r.prompt.length > 80 ? "..." : ""}
              </td>
              <td className="p-3 text-right font-mono">${r.cost_usd.toFixed(4)}</td>
              <td className="p-3 text-right">{r.num_turns}</td>
              <td className="p-3 text-right text-muted-foreground text-xs">
                {r.duration_ms > 0 ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
              </td>
              <td className="p-3 text-muted-foreground text-xs">
                <LocalDate value={r.created_at} />
              </td>
            </AdminTableRow>
          ))}
          {runs.length === 0 && <EmptyRow colSpan={9}>No runs found</EmptyRow>}
        </tbody>
      </AdminTable>
    </div>
  );
}
