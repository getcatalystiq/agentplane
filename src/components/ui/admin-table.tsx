import { cn } from "@/lib/utils";

export function AdminTable({ children, footer, className }: { children: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border", className)}>
      <table className="w-full text-sm">
        {children}
      </table>
      {footer}
    </div>
  );
}

export function AdminTableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/50">
        {children}
      </tr>
    </thead>
  );
}

export function Th({ children, className, align = "left" }: { children?: React.ReactNode; className?: string; align?: "left" | "right" }) {
  return (
    <th className={cn("p-3 font-medium", align === "right" ? "text-right" : "text-left", className)}>
      {children}
    </th>
  );
}

export function AdminTableRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <tr className={cn("border-b border-border hover:bg-muted/30 transition-colors", className)}>
      {children}
    </tr>
  );
}

export function EmptyRow({ colSpan, children = "No results found" }: { colSpan: number; children?: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-8 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
