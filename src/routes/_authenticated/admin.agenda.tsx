import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listWeekAppointments } from "@/lib/admin/agenda.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { startOfWeek, addDays, addWeeks, format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/admin/agenda")({
  component: AgendaPage,
});

const HOURS = Array.from({ length: 12 }, (_, i) => 8 + i); // 8-19

const CATEGORY_COLOR: Record<string, string> = {
  consultoria: "bg-blue-100 border-blue-400 text-blue-900",
  tour: "bg-emerald-100 border-emerald-400 text-emerald-900",
  burocracia: "bg-amber-100 border-amber-400 text-amber-900",
  clube: "bg-purple-100 border-purple-400 text-purple-900",
};

function AgendaPage() {
  const fetchWeek = useServerFn(listWeekAppointments);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));

  const { data, isLoading } = useQuery({
    queryKey: ["agenda", weekStart.toISOString()],
    queryFn: () => fetchWeek({ data: { weekStart: weekStart.toISOString() } }),
  });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Agenda</h1>
          <p className="text-admin-ink-muted text-sm mt-1">Sala Gran Vía + tours pela cidade. Bloqueio automático contra sobreposição.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addWeeks(weekStart, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-display tabular-nums px-3">
            {format(weekStart, "dd MMM", { locale: ptBR })} – {format(addDays(weekStart, 6), "dd MMM yyyy", { locale: ptBR })}
          </span>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addWeeks(weekStart, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoje</Button>
        </div>
      </header>

      <BentoCard padded={false}>
        <div className="overflow-x-auto">
          <div className="grid min-w-[900px]" style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}>
            {/* Day headers */}
            <div className="border-b border-r border-admin-border" />
            {days.map((d) => {
              const today = isSameDay(d, new Date());
              return (
                <div key={d.toISOString()} className={`border-b border-admin-border py-3 text-center ${today ? "bg-admin-accent-soft" : ""}`}>
                  <div className="text-[10px] uppercase tracking-wider text-admin-ink-muted">{format(d, "EEE", { locale: ptBR })}</div>
                  <div className={`font-display text-xl ${today ? "text-admin-accent font-bold" : "text-admin-ink"}`}>{format(d, "dd")}</div>
                </div>
              );
            })}

            {/* Hour rows */}
            {HOURS.map((h) => (
              <div key={h} className="contents">
                <div className="border-r border-b border-admin-border text-right pr-2 py-2 text-[10px] text-admin-ink-muted tabular-nums">{`${h}:00`}</div>
                {days.map((d) => {
                  const slotStart = new Date(d);
                  slotStart.setHours(h, 0, 0, 0);
                  const slotEnd = new Date(slotStart);
                  slotEnd.setHours(h + 1);
                  const events = (data?.appointments ?? []).filter((a) => {
                    const s = new Date(a.starts_at);
                    return s >= slotStart && s < slotEnd;
                  });
                  return (
                    <div key={d.toISOString() + h} className="border-r border-b border-admin-border min-h-[60px] p-1 relative">
                      {events.map((ev) => {
                        const svc = (ev as { services?: { title?: string; category?: string } | null }).services;
                        const prof = (ev as { profiles?: { full_name?: string } | null }).profiles;
                        const color = CATEGORY_COLOR[svc?.category ?? ""] ?? "bg-slate-100 border-slate-400 text-slate-900";
                        return (
                          <div key={ev.id} className={`${color} border-l-4 rounded text-[10px] px-1.5 py-1 mb-1`}>
                            <div className="font-medium truncate">{svc?.title ?? "Serviço"}</div>
                            <div className="opacity-80 truncate">{prof?.full_name ?? "—"}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </BentoCard>

      <div className="flex gap-4 text-xs">
        {Object.entries(CATEGORY_COLOR).map(([k, c]) => (
          <span key={k} className={`${c} border-l-4 px-2 py-0.5 rounded capitalize`}>{k}</span>
        ))}
      </div>

      {isLoading && <p className="text-sm text-admin-ink-muted">Carregando...</p>}
    </div>
  );
}
