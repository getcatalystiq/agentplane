interface FormFieldProps {
  label: string;
  children: React.ReactNode;
  error?: string | null;
  hint?: string;
}

export function FormField({ label, children, error, hint }: FormFieldProps) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
