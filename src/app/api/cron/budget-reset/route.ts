import { NextRequest } from "next/server";
import { withErrorHandler, jsonResponse } from "@/lib/api";
import { execute } from "@/db";
import { logger } from "@/lib/logger";
import { verifyCronSecret } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (request: NextRequest) => {
  verifyCronSecret(request);

  // First day of the current month at midnight UTC
  const now = new Date();
  const currentMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();

  // Reset spend for tenants whose period started before this month
  const result = await execute(
    `UPDATE tenants
     SET current_month_spend = 0, spend_period_start = $1
     WHERE spend_period_start < $1`,
    [currentMonthStart],
  );

  const resetCount = result.rowCount ?? 0;

  logger.info("Budget reset completed", {
    reset_count: resetCount,
    current_month_start: currentMonthStart,
  });

  return jsonResponse({ reset: resetCount, period_start: currentMonthStart });
});
