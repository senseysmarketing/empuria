import { Lock } from "lucide-react";

export function RestrictedAreaCard({
  title = "Área restrita",
  message = "Apenas administradores têm acesso a esta seção.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-surface p-10 flex flex-col items-center justify-center text-center gap-3">
      <div className="h-12 w-12 rounded-full bg-admin-bg border border-admin-border flex items-center justify-center text-admin-ink-muted">
        <Lock className="h-5 w-5" />
      </div>
      <h2 className="font-display text-xl text-admin-ink">{title}</h2>
      <p className="text-sm text-admin-ink-muted max-w-md">{message}</p>
    </div>
  );
}
