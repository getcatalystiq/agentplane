"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CancelRunButton({ runId }: { runId: string }) {
  const [cancelling, setCancelling] = useState(false);
  const router = useRouter();

  async function handleCancel() {
    if (!confirm("Stop this run? This will terminate the sandbox immediately.")) return;

    setCancelling(true);
    try {
      const res = await fetch(`/api/admin/runs/${runId}/cancel`, { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data?.error ?? `Failed to cancel (HTTP ${res.status})`);
      }
    } catch {
      alert("Failed to cancel run");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleCancel}
      disabled={cancelling}
    >
      {cancelling ? "Stopping…" : "Stop Run"}
    </Button>
  );
}
