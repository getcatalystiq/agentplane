import type { AgentPlane } from "../client";
import type { DashboardStats, DailyAgentStat, DashboardChartsParams } from "../types";

export class DashboardResource {
  constructor(private readonly _client: AgentPlane) {}

  /** Get dashboard overview stats (agent count, run count, active runs, spend, sessions). */
  async stats(): Promise<DashboardStats> {
    return this._client._request<DashboardStats>("GET", "/api/dashboard/stats");
  }

  /** Get daily run/cost chart data broken down by agent. */
  async charts(params?: DashboardChartsParams): Promise<DailyAgentStat[]> {
    const resp = await this._client._request<{ data: DailyAgentStat[] }>(
      "GET",
      "/api/dashboard/charts",
      { query: { days: params?.days ?? 30 } },
    );
    return resp.data;
  }
}
