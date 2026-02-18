import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { queryOne, query } from "@/db";
import { AgentRow, RunRow, TenantRow } from "@/lib/validation";
import { AgentEditForm } from "./edit-form";
import { SkillsEditor } from "./skills-editor";
import { ConnectorsManager } from "./connectors-manager";
import { AgentHeaderActions } from "./header-actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const { agentId } = await params;
  const { page: pageParam, pageSize: pageSizeParam } = await searchParams;

  const agent = await queryOne(AgentRow, "SELECT * FROM agents WHERE id = $1", [agentId]);
  if (!agent) notFound();

  const tenant = await queryOne(TenantRow, "SELECT * FROM tenants WHERE id = $1", [agent.tenant_id]);

  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(pageSizeParam)) ? Number(pageSizeParam) : 20;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const offset = (page - 1) * pageSize;

  const [runs, countResult] = await Promise.all([
    query(RunRow, "SELECT * FROM runs WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3", [agentId, pageSize, offset]),
    queryOne(
      z.object({ total: z.number() }),
      "SELECT COUNT(*)::int AS total FROM runs WHERE agent_id = $1",
      [agentId],
    ),
  ]);

  const totalRuns = countResult?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRuns / pageSize));

  function pageHref(p: number, ps = pageSize) {
    return `/admin/agents/${agentId}?page=${p}&pageSize=${ps}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/admin/agents" className="text-muted-foreground hover:text-foreground text-sm">&larr; Agents</Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-2xl font-semibold">{agent.name}</h1>
          </div>
          <AgentHeaderActions agentId={agent.id} tenantId={agent.tenant_id} />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Tenant: <Link href={`/admin/tenants/${agent.tenant_id}`} className="text-primary hover:underline">{tenant?.name ?? agent.tenant_id.slice(0, 8)}</Link>
        </p>
        {agent.description && (
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{agent.description}</p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalRuns}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Max Turns</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{agent.max_turns}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Budget</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">${agent.max_budget_usd.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Skills</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{agent.skills.length}</p>
          </CardContent>
        </Card>
      </div>

      <AgentEditForm agent={agent} />

      <ConnectorsManager agentId={agent.id} toolkits={agent.composio_toolkits} />

      <SkillsEditor agentId={agent.id} initialSkills={agent.skills} />

      {/* Runs */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Runs</h2>
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left p-3 font-medium">Run ID</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-right p-3 font-medium">Cost</th>
                <th className="text-right p-3 font-medium">Turns</th>
                <th className="text-left p-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-border hover:bg-muted/30">
                  <td className="p-3 font-mono text-xs">
                    <Link href={`/admin/runs/${r.id}?from=agent`} className="text-primary hover:underline">
                      {r.id.slice(0, 8)}...
                    </Link>
                  </td>
                  <td className="p-3"><RunStatusBadge status={r.status} /></td>
                  <td className="p-3 text-right font-mono">${r.cost_usd.toFixed(4)}</td>
                  <td className="p-3 text-right">{r.num_turns}</td>
                  <td className="p-3 text-muted-foreground text-xs">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No runs</td></tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/20 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>Rows per page:</span>
              {PAGE_SIZE_OPTIONS.map((ps) => (
                <Link
                  key={ps}
                  href={pageHref(1, ps)}
                  className={`px-2 py-0.5 rounded text-xs ${pageSize === ps ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"}`}
                >
                  {ps}
                </Link>
              ))}
              <span className="ml-2">{totalRuns} total</span>
            </div>

            <div className="flex items-center gap-1">
              <PaginationBtn href={page > 1 ? pageHref(1) : null}>«</PaginationBtn>
              <PaginationBtn href={page > 1 ? pageHref(page - 1) : null}>‹</PaginationBtn>
              <span className="px-3 text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <PaginationBtn href={page < totalPages ? pageHref(page + 1) : null}>›</PaginationBtn>
              <PaginationBtn href={page < totalPages ? pageHref(totalPages) : null}>»</PaginationBtn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaginationBtn({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = "inline-flex items-center justify-center h-7 w-7 rounded border border-border text-xs font-medium transition-colors";
  if (!href) return <span className={`${cls} text-muted-foreground opacity-40 cursor-not-allowed`}>{children}</span>;
  return <Link href={href} className={`${cls} hover:bg-muted`}>{children}</Link>;
}

function RunStatusBadge({ status }: { status: string }) {
  const variant = status === "completed" ? "default"
    : status === "running" ? "secondary"
    : status === "failed" ? "destructive"
    : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}
