import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PaginationBar, parsePaginationParams } from "@/components/ui/pagination-bar";
import { query, queryOne } from "@/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

const StatsRow = z.object({
  tenant_count: z.coerce.number(),
  agent_count: z.coerce.number(),
  total_runs: z.coerce.number(),
  active_runs: z.coerce.number(),
  total_spend: z.coerce.number(),
});

const RecentRun = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  tenant_id: z.string(),
  tenant_name: z.string(),
  status: z.string(),
  cost_usd: z.coerce.number(),
  num_turns: z.coerce.number(),
  created_at: z.coerce.string(),
});

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const { page: pageParam, pageSize: pageSizeParam } = await searchParams;
  const { page, pageSize, offset } = parsePaginationParams(pageParam, pageSizeParam);

  const [stats, runs, countResult] = await Promise.all([
    queryOne(
      StatsRow,
      `SELECT
         (SELECT COUNT(*) FROM tenants)::int AS tenant_count,
         (SELECT COUNT(*) FROM agents)::int AS agent_count,
         (SELECT COUNT(*) FROM runs)::int AS total_runs,
         (SELECT COUNT(*) FROM runs WHERE status = 'running')::int AS active_runs,
         (SELECT COALESCE(SUM(cost_usd), 0) FROM runs) AS total_spend`,
      [],
    ),
    query(
      RecentRun,
      `SELECT r.id, r.agent_id, a.name AS agent_name, r.tenant_id, t.name AS tenant_name,
         r.status, r.cost_usd, r.num_turns, r.created_at
       FROM runs r
       JOIN agents a ON a.id = r.agent_id
       JOIN tenants t ON t.id = r.tenant_id
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    ),
    queryOne(
      z.object({ total: z.number() }),
      `SELECT COUNT(*)::int AS total FROM runs r
       JOIN agents a ON a.id = r.agent_id
       JOIN tenants t ON t.id = r.tenant_id`,
      [],
    ),
  ]);

  const total = countResult?.total ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tenants</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.tenant_count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.agent_count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.total_runs ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-500">{stats?.active_runs ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Spend</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold font-mono">${(stats?.total_spend ?? 0).toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Runs */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Runs</h2>
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left p-3 font-medium">Run</th>
                <th className="text-left p-3 font-medium">Agent</th>
                <th className="text-left p-3 font-medium">Tenant</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-right p-3 font-medium">Cost</th>
                <th className="text-right p-3 font-medium">Turns</th>
                <th className="text-left p-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-mono text-xs">
                    <Link href={`/admin/runs/${r.id}`} className="text-primary hover:underline">
                      {r.id.slice(0, 8)}...
                    </Link>
                  </td>
                  <td className="p-3 text-xs">
                    <Link href={`/admin/agents/${r.agent_id}`} className="text-primary hover:underline">
                      {r.agent_name}
                    </Link>
                  </td>
                  <td className="p-3 text-xs">
                    <Link href={`/admin/tenants/${r.tenant_id}`} className="text-primary hover:underline">
                      {r.tenant_name}
                    </Link>
                  </td>
                  <td className="p-3">
                    <Badge variant={
                      r.status === "completed" ? "default"
                        : r.status === "running" ? "secondary"
                        : r.status === "failed" ? "destructive"
                        : "outline"
                    }>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="p-3 text-right font-mono">${r.cost_usd.toFixed(4)}</td>
                  <td className="p-3 text-right">{r.num_turns}</td>
                  <td className="p-3 text-muted-foreground text-xs">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">No runs yet</td>
                </tr>
              )}
            </tbody>
          </table>
          <PaginationBar
            page={page}
            pageSize={pageSize}
            total={total}
            buildHref={(p, ps) => `/admin?page=${p}&pageSize=${ps}`}
          />
        </div>
      </div>
    </div>
  );
}
