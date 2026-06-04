import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { BentoCard } from "@/components/admin/BentoCard";
import { TrendingUp, TrendingDown } from "lucide-react";

export type AdminStatCardTone = "neutral" | "green" | "red" | "blue" | "amber";

const TONE_CLASSES: Record<AdminStatCardTone, string> = {
  neutral: "text-admin-ink bg-admin-bg",
  green: "text-emerald-700 bg-emerald-100",
  red: "text-red-800 bg-red-100",
  blue: "text-blue-800 bg-blue-100",
  amber: "text-amber-800 bg-amber-100",
};

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  const cls = up ? "text-emerald-700 bg-emerald-100" : "text-red-800 bg-red-100";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export function AdminStatCard({
  label,
  value,
  hint,
  deltaPct,
  icon: Icon,
  tone = "neutral",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  deltaPct?: number | null;
  icon?: LucideIcon;
  tone?: AdminStatCardTone;
  className?: string;
}) {
  return (
    <BentoCard className={cn(className)} padded>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-admin-ink-muted">{label}</p>
          <p className="mt-2 font-display text-2xl font-bold text-admin-ink truncate tabular-nums">
            {value}
          </p>
          {hint && (
            <p className="mt-0.5 text-xs text-admin-ink-muted tabular-nums truncate">{hint}</p>
          )}
          {deltaPct !== undefined && (
            <div className="mt-1">
              <DeltaBadge pct={deltaPct ?? null} />
            </div>
          )}
        </div>
        {Icon && (
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg shrink-0",
              TONE_CLASSES[tone],
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
    </BentoCard>
  );
}
