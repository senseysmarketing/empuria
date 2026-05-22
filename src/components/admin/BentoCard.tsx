import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function BentoCard({
  title,
  action,
  className,
  children,
  padded = true,
}: {
  title?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section
      className={cn(
        "bg-admin-surface border border-admin-border rounded-2xl shadow-[var(--shadow-admin)] overflow-hidden",
        className,
      )}
    >
      {title && (
        <header className="flex items-center justify-between px-5 py-4 border-b border-admin-border">
          <h2 className="font-display text-sm uppercase tracking-wider text-admin-ink-soft">{title}</h2>
          {action}
        </header>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}
