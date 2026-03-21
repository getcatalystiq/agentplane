"use client";

import { useState, useCallback } from "react";
import { useApi } from "../../hooks/use-api";
import { useNavigation } from "../../hooks/use-navigation";
import { PaginationBar } from "../ui/pagination-bar";
import { RunStatusBadge } from "../ui/run-status-badge";
import { RunSourceBadge } from "../ui/run-source-badge";
import { AdminTable, AdminTableHead, AdminTableRow, Th, EmptyRow } from "../ui/admin-table";
import { LocalDate } from "../ui/local-date";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";

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
  triggered_by: string;
  error_type: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface RunListResponse {
  data: RunItem[];
  limit: number;
  offset: number;
  has_more: boolean;
}

const SOURCES = [
  { value: "", label: "All Sources" },
  { value: "api", label: "API" },
  { value: "schedule", label: "Schedule" },
  { value: "playground", label: "Playground" },
  { value: "chat", label: "Chat" },
  { value: "a2a", label: "A2A" },
];

const VALID_SOURCES = SOURCES.filter((s) => s.value).map((s) => s.value);

export interface RunListPageProps {
  /** Optional initial data for SSR hosts */
  initialData?: RunListResponse;
}

export function RunListPage({ initialData }: RunListPageProps) {
  const { LinkComponent, basePath } = useNavigation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  const cacheKey = `runs-${page}-${pageSize}-${sourceFilter || "all"}`;

  const { data, error, isLoading } = useApi<RunListResponse>(
    cacheKey,
    (client) => {
      return client.runs.list({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        ...(sourceFilter ? { triggered_by: sourceFilter } : {}),
      }) as Promise<RunListResponse>;
    },
    initialData ? { fallbackData: initialData } : undefined,
  );

  const handleSourceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSourceFilter(VALID_SOURCES.includes(value) ? value : null);
    setPage(1);
  }, []);

  const handlePaginationNavigate = useCallback((href: string) => {
    const url = new URL(href, "http://localhost");
    const p = parseInt(url.searchParams.get("page") || "1", 10);
    const ps = parseInt(url.searchParams.get("pageSize") || "20", 10);
    setPage(p);
    setPageSize(ps);
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-destructive">Failed to load runs: {error.message}</p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  const runs = data.data;
  const total = data.has_more ? data.offset + data.limit + 1 : data.offset + runs.length;

  return (
    <div>
      <div className="flex items-center mb-6">
        <div className="w-40">
          <Select value={sourceFilter ?? ""} onChange={handleSourceChange}>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
      </div>
      <AdminTable className="overflow-x-auto" footer={
        <PaginationBar
          page={page}
          pageSize={pageSize}
          total={total}
          buildHref={(p, ps) => `?page=${p}&pageSize=${ps}${sourceFilter ? `&source=${sourceFilter}` : ""}`}
          onNavigate={handlePaginationNavigate}
        />
      }>
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
                <LinkComponent href={`${basePath}/runs/${r.id}`} className="text-primary hover:underline">
                  {r.id.slice(0, 8)}...
                </LinkComponent>
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
                {r.duration_ms > 0 ? `${(r.duration_ms / 1000).toFixed(1)}s` : "\u2014"}
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
