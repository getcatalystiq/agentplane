"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  loadingLabel?: string;
  loading?: boolean;
  error?: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel = "Delete",
  loadingLabel = "Deleting...",
  loading = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">{children}</div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button size="sm" variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? loadingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
