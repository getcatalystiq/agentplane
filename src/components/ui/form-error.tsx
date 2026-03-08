export function FormError({ error }: { error?: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-destructive">{error}</p>;
}
