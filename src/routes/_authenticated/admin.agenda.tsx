import { useState, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listWeekAppointments } from "@/lib/admin/agenda.functions";
import { listServicesAdmin, createSlot } from "@/lib/admin/slots.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, CheckSquare, Ticket, PartyPopper, Link2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { startOfWeek, addDays, addWeeks, format, isSameDay, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { SlotsPanel } from "@/components/admin/SlotsPanel";
import { NewSlotDialog } from "@/components/admin/SlotsPanel";
import { AppointmentDialog } from "@/components/admin/agenda/AppointmentDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/agenda")({
  component: AgendaPage,
});

const HOURS = Array.from({ length: 12 }, (_, i) => 8 + i);

const CATEGORY_COLOR: Record<string, string> = {
  consultoria: "bg-blue-100 border-blue-400 text-blue-900",
  tour: "bg-emerald-100 border-emerald-400 text-emerald-900",
  burocracia: "bg-amber-100 border-amber-400 text-amber-900",
  clube: "bg-purple-100 border-purple-400 text-purple-900",
};

function AgendaPage() {
  const navigate = useNavigate();
  const fetchWeek = useServerFn(listWeekAppointments);
  const fetchServices = useServerFn(listServicesAdmin);
  const create = useServerFn(createSlot);

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [showAppointment, setShowAppointment] = useState(false);
  const [showSlot, setShowSlot] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["agenda", weekStart.toISOString()],
    queryFn: () => fetchWeek({ data: { weekStart: weekStart.toISOString() } }),
  });

  const { data: services = [] } = useQuery({
    queryKey: ["admin-services"],
    queryFn: () => fetchServices(),
  });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const slotServices = services.filter((s) => s.requires_slot);

  // Resumo do dia
  const todayAppts = (data?.appointments ?? []).filter((a) => isToday(new Date(a.starts_at)));
  const now = Date.now();
  const happeningNow = todayAppts.filter((a) => {
    const s = new Date(a.starts_at).getTime();
    const e = new Date(a.ends_at).getTime();
    return s <= now && e >= now;
  });
  const upcoming = (data?.appointments ?? []).filter((a) => new Date(a.starts_at).getTime() > now);

  const handleCreate = (kind: "compromisso" | "tarefa" | "vaga" | "evento") => {
    if (kind === "compromisso") setShowAppointment(true);
    else if (kind === "vaga") setShowSlot(true);
    else if (kind === "evento") navigate({ to: "/admin/eventos", search: { new: 1 } as never });
    else toast.info("Tarefas chegam em breve — depende da nova tabela calendar_tasks.");
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Agenda Empuria</h1>
          <p className="text-admin-ink-muted text-sm mt-1">
            Central de compromissos, tarefas, vagas e eventos do Instituto.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoje</Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addWeeks(weekStart, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-display tabular-nums px-2">
            {format(weekStart, "dd MMM", { locale: ptBR })} – {format(addDays(weekStart, 6), "dd MMM yyyy", { locale: ptBR })}
          </span>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addWeeks(weekStart, 1))}><ChevronRight className="h-4 w-4" /></Button>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    className="opacity-70 cursor-not-allowed gap-2"
                  >
                    <Link2 className="h-4 w-4" /> Conectar Google Agenda
                    <span className="ml-1 text-[10px] uppercase tracking-wider rounded bg-muted px-1.5 py-0.5">Em breve</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Integração com Google Agenda em breve</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="bg-admin-accent hover:bg-admin-accent/90 gap-2">
                <Plus className="h-4 w-4" /> Criar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => handleCreate("compromisso")}>
                <CalendarIcon className="h-4 w-4 mr-2" /> Compromisso
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCreate("tarefa")}>
                <CheckSquare className="h-4 w-4 mr-2" /> Tarefa
                <span className="ml-auto text-[10px] uppercase text-admin-ink-muted">Em breve</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCreate("vaga")}>
                <Ticket className="h-4 w-4 mr-2" /> Vaga
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCreate("evento")}>
                <PartyPopper className="h-4 w-4 mr-2" /> Evento
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="Hoje" value={todayAppts.length} />
        <SummaryTile label="Acontecendo agora" value={happeningNow.length} />
        <SummaryTile label="Próximos" value={upcoming.length} />
        <SummaryTile label="Vagas (semana)" value={(data?.appointments ?? []).length} />
      </div>

      {/* Calendário semanal unificado */}
      <BentoCard padded={false}>
        <div className="overflow-x-auto">
          <div className="grid min-w-[900px]" style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}>
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

      <div className="flex flex-wrap gap-4 text-xs">
        {Object.entries(CATEGORY_COLOR).map(([k, c]) => (
          <span key={k} className={`${c} border-l-4 px-2 py-0.5 rounded capitalize`}>{k}</span>
        ))}
      </div>

      {/* Vagas e slots — integrados na mesma tela (sem aba) */}
      <section className="space-y-3">
        <h2 className="font-display text-xl text-admin-ink">Vagas & Slots</h2>
        <SlotsPanel />
      </section>

      {isLoading && <p className="text-sm text-admin-ink-muted">Carregando...</p>}

      <AppointmentDialog open={showAppointment} onOpenChange={setShowAppointment} />
      <NewSlotDialog
        services={slotServices}
        onCreated={() => refetch()}
        create={create}
        open={showSlot}
        onOpenChange={setShowSlot}
      />
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <BentoCard padded>
      <div className="text-[11px] uppercase tracking-wider text-admin-ink-muted">{label}</div>
      <div className="font-display text-3xl text-admin-ink mt-1">{value}</div>
    </BentoCard>
  );
}
