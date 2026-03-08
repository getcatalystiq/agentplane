"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Props {
  serverId: string;
  serverName: string;
  hasConnections: boolean;
}

export function DeleteServerButton({ serverId, serverName, hasConnections }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/mcp-servers/${serverId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? `Error ${res.status}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground hover:text-destructive text-xs"
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete Custom Connector"
        confirmLabel="Delete"
        loadingLabel="Deleting..."
        loading={deleting}
        error={error}
        onConfirm={handleDelete}
      >
        Delete <span className="font-medium text-foreground">{serverName}</span>?
        {hasConnections && " All agent connections to this server will also be removed."}
      </ConfirmDialog>
    </>
  );
}
