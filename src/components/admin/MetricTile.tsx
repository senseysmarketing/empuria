import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function MetricTile({
  label,
  value,
  hint,
  icon: Icon,
  accent = "neutral",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  accent?: "neutral" | "success" | "warning" | "accent";
  className?: string;
}) {
  const accentClass = {
    neutral: "text-admin-ink",
    success: "text-admin-success",
    warning: "text-admin-warning",
    accent: "text-admin-accent",
  }[accent];
  return (
    <div className={cn("bg-admin-surface border border-admin-border rounded-2xl p-5 shadow-[var(--shadow-admin)]", className)}>
      <div className="flex items-start justify-between">
        <span className="text-xs uppercase tracking-wider font-display text-admin-ink-muted">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-admin-ink-muted" />}
      </div>
      <div className={cn("mt-3 font-display text-4xl font-bold leading-none", accentClass)}>{value}</div>
      {hint && <div className="mt-2 text-xs text-admin-ink-muted">{hint}</div>}
    </div>
  );
}
