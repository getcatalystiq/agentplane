import { NextRequest } from "next/server";
import { timingSafeEqual } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { AuthError } from "@/lib/errors";

export function verifyCronSecret(request: NextRequest): void {
  const cronSecret = getEnv().CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !timingSafeEqual(authHeader, `Bearer ${cronSecret}`)) {
    throw new AuthError("Invalid cron secret");
  }
}
