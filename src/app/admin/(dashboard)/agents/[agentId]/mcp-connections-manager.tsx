"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { McpToolsModal } from "./mcp-tools-modal";

interface McpServer {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo_url: string | null;
  base_url: string;
}

interface McpConnection {
  id: string;
  mcp_server_id: string;
  status: string;
  allowed_tools: string[];
  token_expires_at: string | null;
  server_name: string;
  server_slug: string;
  server_logo_url: string | null;
  server_base_url: string;
}

interface Props {
  agentId: string;
}

function statusVariant(status: string) {
  if (status === "active") return "default" as const;
  if (status === "initiated") return "secondary" as const;
  return "destructive" as const;
}

function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return ms > 0 && ms < 24 * 60 * 60 * 1000; // within 24 hours
}

export function McpConnectionsManager({ agentId }: Props) {
  const router = useRouter();
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<McpConnection | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [toolsModal, setToolsModal] = useState<McpConnection | null>(null);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/mcp-connections`);
      const data = await res.json();
      setConnections(data.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  async function loadServers() {
    const res = await fetch("/api/admin/mcp-servers");
    const data = await res.json();
    setServers(data.data ?? []);
  }

  async function handleConnect(serverId: string) {
    setConnecting(serverId);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/mcp-connections/${serverId}/initiate-oauth`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.redirectUrl) {
        // Open OAuth in popup
        const popup = window.open(data.redirectUrl, "mcp-oauth", "width=600,height=700");
        // Listen for completion message
        const handler = (event: MessageEvent) => {
          if (event.data?.type === "mcp-oauth-complete") {
            popup?.close();
            window.removeEventListener("message", handler);
            loadConnections();
            setShowAdd(false);
            router.refresh();
          }
        };
        window.addEventListener("message", handler);
      }
    } finally {
      setConnecting(null);
    }
  }

  async function handleDisconnect() {
    if (!confirmDisconnect) return;
    setDisconnecting(true);
    try {
      await fetch(`/api/admin/agents/${agentId}/mcp-connections/${confirmDisconnect.mcp_server_id}`, {
        method: "DELETE",
      });
      setConfirmDisconnect(null);
      await loadConnections();
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  // Servers not yet connected
  const connectedServerIds = new Set(connections.map((c) => c.mcp_server_id));
  const availableServers = servers.filter((s) => !connectedServerIds.has(s.id));

  return (
    <>
      <Dialog open={!!confirmDisconnect} onOpenChange={(open) => { if (!open) setConfirmDisconnect(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect MCP Server</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            Disconnect <span className="font-medium text-foreground">{confirmDisconnect?.server_name}</span> from this agent?
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(null)} disabled={disconnecting}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? "Disconnecting..." : "Disconnect"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">MCP Connections</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { loadServers(); setShowAdd(true); }}
          >
            Connect
          </Button>
        </CardHeader>
        <CardContent>
          {showAdd && (
            <div className="mb-4 rounded-lg border border-border p-3">
              <p className="text-sm font-medium mb-2">Available MCP Servers</p>
              {availableServers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {servers.length === 0 ? "No MCP servers registered." : "All servers are already connected."}
                </p>
              ) : (
                <div className="space-y-2">
                  {availableServers.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 p-2 rounded border border-border">
                      <div className="flex items-center gap-2 min-w-0">
                        {s.logo_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.logo_url} alt="" className="w-5 h-5 rounded-sm object-contain flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <span className="text-sm font-medium">{s.name}</span>
                          {s.description && (
                            <p className="text-xs text-muted-foreground truncate">{s.description}</p>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs flex-shrink-0"
                        disabled={connecting === s.id}
                        onClick={() => handleConnect(s.id)}
                      >
                        {connecting === s.id ? "Connecting..." : "Connect"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Close</Button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No MCP servers connected. Click Connect to add one.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {connections.map((c) => (
                <div key={c.id} className="rounded-lg border border-border p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {c.server_logo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.server_logo_url} alt="" className="w-5 h-5 rounded-sm object-contain flex-shrink-0" />
                    )}
                    <span className="text-sm font-medium truncate flex-1">{c.server_name}</span>
                    <Badge variant={statusVariant(c.status)} className="text-xs flex-shrink-0">
                      {c.status}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(c)}
                      className="text-muted-foreground hover:text-red-500 flex-shrink-0 ml-1 text-base leading-none"
                      title="Disconnect"
                    >
                      ×
                    </button>
                  </div>

                  {c.status === "active" && isExpiringSoon(c.token_expires_at) && (
                    <span className="text-xs text-yellow-500">Token expires soon</span>
                  )}

                  {c.status === "active" && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline text-left"
                      onClick={() => setToolsModal(c)}
                    >
                      {c.allowed_tools.length > 0
                        ? `${c.allowed_tools.length} tools selected`
                        : "All tools (no filter)"}
                    </button>
                  )}

                  {(c.status === "expired" || c.status === "failed") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs mt-auto"
                      disabled={connecting === c.mcp_server_id}
                      onClick={() => handleConnect(c.mcp_server_id)}
                    >
                      {connecting === c.mcp_server_id ? "Reconnecting..." : "Reconnect"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {toolsModal && (
        <McpToolsModal
          agentId={agentId}
          mcpServerId={toolsModal.mcp_server_id}
          serverName={toolsModal.server_name}
          serverLogo={toolsModal.server_logo_url}
          allowedTools={toolsModal.allowed_tools}
          open={!!toolsModal}
          onOpenChange={(open) => { if (!open) setToolsModal(null); }}
          onSave={async (selectedTools) => {
            await fetch(`/api/admin/agents/${agentId}/mcp-connections/${toolsModal.mcp_server_id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ allowed_tools: selectedTools }),
            });
            setToolsModal(null);
            await loadConnections();
          }}
        />
      )}
    </>
  );
}
