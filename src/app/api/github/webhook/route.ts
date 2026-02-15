import { NextRequest } from "next/server";
import { withErrorHandler, jsonResponse } from "@/lib/api";
import { verifyWebhookSignature } from "@/lib/github";
import { execute } from "@/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) {
    return jsonResponse(
      { error: { code: "not_configured", message: "GitHub webhook not configured" } },
      503,
    );
  }

  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";

  const valid = await verifyWebhookSignature(body, signature, secret);
  if (!valid) {
    logger.warn("Invalid GitHub webhook signature");
    return jsonResponse(
      { error: { code: "unauthorized", message: "Invalid signature" } },
      401,
    );
  }

  const event = request.headers.get("x-github-event");
  const payload = JSON.parse(body);

  logger.info("GitHub webhook received", {
    event,
    action: payload.action,
    installation_id: payload.installation?.id,
  });

  if (event === "installation" && payload.action === "deleted") {
    // Installation was removed -- clear from any agents using it
    const installationId = String(payload.installation.id);
    const result = await execute(
      "UPDATE agents SET github_installation_id = NULL WHERE github_installation_id = $1",
      [installationId],
    );
    logger.info("Cleared GitHub installation from agents", {
      installation_id: installationId,
      agents_updated: result.rowCount,
    });
  }

  return jsonResponse({ received: true });
});
