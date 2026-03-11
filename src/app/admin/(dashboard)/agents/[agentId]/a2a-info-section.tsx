"use client";

import { useState } from "react";
import { SectionHeader } from "@/components/ui/section-header";
import { CopyButton } from "@/components/ui/copy-button";
import { Button } from "@/components/ui/button";

export function A2aInfoSection({
  tenantSlug,
  baseUrl,
}: {
  tenantSlug: string;
  baseUrl: string;
}) {
  const [cardPreview, setCardPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const jsonRpcUrl = `${baseUrl}/api/a2a/${tenantSlug}/jsonrpc`;
  const agentCardUrl = `${baseUrl}/api/a2a/${tenantSlug}/.well-known/agent-card.json`;

  async function fetchAgentCard() {
    if (cardPreview) {
      setCardPreview(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(agentCardUrl);
      const data = await res.json();
      setCardPreview(JSON.stringify(data, null, 2));
    } catch {
      setCardPreview("Failed to fetch Agent Card");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-indigo-500/25 p-5">
      <SectionHeader title="A2A Protocol" />
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">JSON-RPC Endpoint</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-1.5 text-xs font-mono text-foreground break-all">
              {jsonRpcUrl}
            </code>
            <CopyButton text={jsonRpcUrl} />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Agent Card URL</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-1.5 text-xs font-mono text-foreground break-all">
              {agentCardUrl}
            </code>
            <CopyButton text={agentCardUrl} />
          </div>
        </div>
        <div className="pt-1">
          <Button variant="outline" size="sm" onClick={fetchAgentCard} disabled={loading}>
            {loading ? "Loading..." : cardPreview ? "Hide Agent Card" : "Preview Agent Card"}
          </Button>
          {cardPreview && (
            <div className="mt-3 relative">
              <pre className="rounded bg-muted p-4 text-xs font-mono text-foreground overflow-x-auto max-h-96">
                {cardPreview}
              </pre>
              <CopyButton text={cardPreview} className="absolute top-2 right-2" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
