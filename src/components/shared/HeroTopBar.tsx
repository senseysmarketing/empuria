import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SpainWatermark } from "./SpainWatermark";
import { useTopBarSlots } from "./TopBarActionsContext";
import logoIcone from "@/assets/logo-empuria-icone.png";

type Variant = "admin" | "portal";

function greetingFor(date: Date) {
  const h = date.getHours();
  if (h < 12) return "Bom dia";
  if (h < 19) return "Boa tarde";
  return "Boa noite";
}

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function formatDate(d: Date) {
  return `${WEEKDAYS[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function HeroTopBar({ variant }: { variant: Variant }) {
  const { actions, quickStat } = useTopBarSlots();
  const [now, setNow] = useState(() => new Date());
  const [name, setName] = useState<string>("");

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
      const display =
        (meta.full_name as string) ||
        (meta.name as string) ||
        (u?.email ? u.email.split("@")[0] : "");
      setName(display.split(" ")[0] || "");
    });
  }, []);

  const isAdmin = variant === "admin";
  const bg = isAdmin
    ? "bg-gradient-to-br from-brown-deep via-brown-deep to-[#3a1f15]"
    : "bg-gradient-to-br from-[#c2956b] via-orange-brand to-yellow-brand";
  const textMain = isAdmin ? "text-offwhite" : "text-brown-deep";
  const textMuted = isAdmin ? "text-offwhite/60" : "text-brown-deep/70";
  const accent = isAdmin ? "text-orange-brand" : "text-brown-deep";
  const watermark = isAdmin ? "text-orange-brand/15" : "text-brown-deep/15";
  const logoRing = isAdmin ? "bg-brown-deep/60 ring-orange-brand/20" : "bg-white/30 ring-brown-deep/20";
  const greeting = isAdmin
    ? `${greetingFor(now)}, ${name || "equipe"}`
    : `Bem-vindo de volta, ${name || "imigrante"}`;

  return (
    <header className={`relative overflow-hidden ${bg}`}>
      <div className={`absolute inset-y-0 right-0 w-1/2 pointer-events-none ${watermark}`}>
        <SpainWatermark className="w-full h-full" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 py-6 flex flex-wrap items-center gap-4">
        <div className={`h-14 w-14 rounded-2xl ring-1 flex items-center justify-center shrink-0 ${logoRing}`}>
          <img src={logoIcone} alt="Empuria" className="h-9 w-9 object-contain" />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className={`font-display font-bold text-2xl md:text-3xl tracking-tight ${textMain}`}>
            {greeting}
          </h1>
          <p className={`text-xs md:text-sm mt-1 font-display uppercase tracking-widest ${textMuted}`}>
            <span className={accent}>●</span> {formatDate(now)}
          </p>
        </div>

        {quickStat && (
          <div className={`hidden md:block text-right border-l ${isAdmin ? "border-offwhite/15" : "border-brown-deep/20"} pl-4`}>
            <div className={`text-[10px] uppercase tracking-widest ${textMuted} font-display`}>
              {quickStat.label}
            </div>
            <div className={`font-display font-bold text-2xl tabular-nums ${accent}`}>
              {quickStat.value}
            </div>
          </div>
        )}

        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
