import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/auth";
import { withErrorHandler, jsonResponse } from "@/lib/api";
import { logger } from "@/lib/logger";
import { defaultRunnerForModel, supportsClaudeRunner } from "@/lib/models";

export const dynamic = "force-dynamic";

/**
 * Hardcoded fallback models when the AI Gateway is unavailable.
 */
const FALLBACK_MODELS = [
  { id: "claude-sonnet-4-6", provider: "anthropic" },
  { id: "anthropic/claude-opus-4-6", provider: "anthropic" },
  { id: "anthropic/claude-sonnet-4-6", provider: "anthropic" },
  { id: "anthropic/claude-haiku-4-5", provider: "anthropic" },
  { id: "openai/gpt-4o", provider: "openai" },
  { id: "openai/gpt-4o-mini", provider: "openai" },
  { id: "openai/o3", provider: "openai" },
  { id: "google/gemini-2.5-pro", provider: "google" },
  { id: "google/gemini-2.5-flash", provider: "google" },
  { id: "mistral/mistral-large", provider: "mistral" },
  { id: "xai/grok-3", provider: "xai" },
  { id: "deepseek/deepseek-chat", provider: "deepseek" },
];

// Process-level cache with 5-min TTL
let cachedModels: Array<{ id: string; provider: string }> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchGatewayModels(): Promise<Array<{ id: string; provider: string }>> {
  if (cachedModels && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedModels;
  }

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      signal: controller.signal,
    });

    if (!res.ok) {
      logger.warn("AI Gateway models endpoint returned non-200", { status: res.status });
      return FALLBACK_MODELS;
    }

    const data = await res.json();
    const models = (data.data || []).map((m: { id: string; owned_by?: string }) => ({
      id: m.id,
      provider: m.id.includes("/") ? m.id.split("/")[0] : (m.owned_by || "unknown"),
    }));

    cachedModels = models;
    cacheTimestamp = Date.now();
    return models;
  } catch (err) {
    logger.warn("Failed to fetch AI Gateway models, using fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    return FALLBACK_MODELS;
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  await authenticateApiKey(request.headers.get("authorization"));

  const models = await fetchGatewayModels();

  // Group by provider and annotate with runner info
  const grouped: Record<string, Array<{
    id: string;
    default_runner: string;
    supports_claude_runner: boolean;
  }>> = {};

  for (const model of models) {
    if (!grouped[model.provider]) {
      grouped[model.provider] = [];
    }
    grouped[model.provider].push({
      id: model.id,
      default_runner: defaultRunnerForModel(model.id),
      supports_claude_runner: supportsClaudeRunner(model.id),
    });
  }

  return jsonResponse({ models: grouped });
});
