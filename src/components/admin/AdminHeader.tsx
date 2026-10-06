import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTopBarSlots } from "@/components/shared/TopBarActionsContext";

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function greetingFor(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 19) return "Boa tarde";
  return "Boa noite";
}

function formatDate(date: Date) {
  return `${WEEKDAYS[date.getDay()]} · ${date.getDate()} ${MONTHS[date.getMonth()]} · ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function AdminHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { actions, quickStat } = useTopBarSlots();
  const [now, setNow] = useState(() => new Date());
  const [name, setName] = useState("");

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
      const displayName =
        (metadata.full_name as string) ||
        (metadata.name as string) ||
        (user?.email ? user.email.split("@")[0] : "");
      setName(displayName.split(" ")[0] || "");
    });
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-admin-border bg-admin-surface/95 backdrop-blur-xl">
      <div className="flex min-h-16 items-center gap-3 px-4 md:px-6">
        <button
          type="button"
          onClick={onOpenMenu}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-admin-border text-admin-ink-soft transition-colors hover:bg-admin-surface-2 hover:text-admin-ink md:hidden"
          aria-label="Abrir menu administrativo"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-semibold text-admin-ink md:text-base">
            {greetingFor(now)}, {name || "equipe"}
          </p>
          <p className="truncate font-display text-[10px] uppercase tracking-wider text-admin-ink-muted md:text-[11px]">
            <span className="text-admin-accent">●</span> {formatDate(now)}
          </p>
        </div>

        {quickStat && (
          <div className="hidden shrink-0 border-l border-admin-border pl-4 text-right lg:block">
            <div className="font-display text-[10px] uppercase tracking-widest text-admin-ink-muted">
              {quickStat.label}
            </div>
            <div className="font-display text-xl font-bold tabular-nums text-admin-accent">
              {quickStat.value}
            </div>
          </div>
        )}

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}

        <Link
          to="/admin/configuracoes"
          search={{ tab: "perfil" }}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-admin-border text-admin-ink-soft transition-colors hover:border-admin-accent/40 hover:bg-admin-accent-soft/50 hover:text-admin-accent"
          title="Configurações"
          aria-label="Configurações"
        >
          <Settings className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}
