import Link from "next/link";

interface DetailPageHeaderProps {
  backHref: string;
  backLabel: string;
  title: React.ReactNode;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  subtitle?: React.ReactNode;
}

export function DetailPageHeader({ backHref, backLabel, title, actions, badge, subtitle }: DetailPageHeaderProps) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={backHref} className="text-muted-foreground hover:text-foreground text-sm">&larr; {backLabel}</Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {badge}
        </div>
        {actions}
      </div>
      {subtitle && <div className="mt-1">{subtitle}</div>}
    </div>
  );
}
