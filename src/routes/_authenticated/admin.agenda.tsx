import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listWeekAppointments } from "@/lib/admin/agenda.functions";
import { listServicesAdmin, createSlot, listSlots } from "@/lib/admin/slots.functions";
import { listWeekEvents } from "@/lib/admin/events.functions";
import { listWeekCalendarTasks } from "@/lib/admin/calendar-tasks.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, CheckSquare, Ticket, PartyPopper, Link2, AlertTriangle, CalendarDays, Activity, Clock, ListChecks } from "lucide-react";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { startOfWeek, addDays, addWeeks, format, isSameDay, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { SlotsPanel, NewSlotDialog } from "@/components/admin/SlotsPanel";
import { AppointmentDialog } from "@/components/admin/agenda/AppointmentDialog";
import { TaskDialog } from "@/components/admin/agenda/TaskDialog";

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

type FilterKind = "todos" | "compromissos" | "tarefas" | "vagas" | "eventos" | "consultoria" | "tour" | "clube" | "burocracia";

type CalItem = {
  id: string;
  kind: "compromisso" | "tarefa" | "vaga" | "evento";
  starts_at: string;
  ends_at?: string | null;
  title: string;
  subtitle?: string;
  category?: string;
  status?: string;
  dim?: boolean;
};

function AgendaPage() {
  const fetchWeek = useServerFn(listWeekAppointments);
  const fetchServices = useServerFn(listServicesAdmin);
  const fetchSlots = useServerFn(listSlots);
  const fetchEvents = useServerFn(listWeekEvents);
  const fetchTasks = useServerFn(listWeekCalendarTasks);
  const create = useServerFn(createSlot);

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [view, setView] = useState<"dia" | "semana" | "mes">("semana");
  const [filter, setFilter] = useState<FilterKind>("todos");
  const [showAppointment, setShowAppointment] = useState(false);
  const [showSlot, setShowSlot] = useState(false);
  const [showTask, setShowTask] = useState(false);

  const weekKey = weekStart.toISOString();

  const { data: apptData, isLoading, refetch } = useQuery({
    queryKey: ["agenda", weekKey],
    queryFn: () => fetchWeek({ data: { weekStart: weekKey } }),
  });
  const { data: services = [] } = useQuery({
    queryKey: ["admin-services"],
    queryFn: () => fetchServices(),
  });
  const { data: allSlots = [] } = useQuery({
    queryKey: ["admin-slots", "all"],
    queryFn: () => fetchSlots({ data: {} }),
  });
  const { data: weekEvents = [] } = useQuery({
    queryKey: ["agenda-events", weekKey],
    queryFn: () => fetchEvents({ data: { weekStart: weekKey } }),
  });
  const { data: weekTasks = [] } = useQuery({
    queryKey: ["agenda-tasks", weekKey],
    queryFn: () => fetchTasks({ data: { weekStart: weekKey } }),
  });

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const days = useMemo(
    () => (view === "dia" ? [weekStart] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))),
    [weekStart, view],
  );

  const slotServices = services.filter((s) => s.requires_slot);
  const now = Date.now();

  // Build unified items
  const items: CalItem[] = useMemo(() => {
    const list: CalItem[] = [];
    for (const a of apptData?.appointments ?? []) {
      const svc = (a as { services?: { title?: string; category?: string } | null }).services;
      const prof = (a as { profiles?: { full_name?: string } | null }).profiles;
      list.push({
        id: `a-${a.id}`,
        kind: "compromisso",
        starts_at: a.starts_at,
        ends_at: a.ends_at,
        title: svc?.title ?? "Serviço",
        subtitle: prof?.full_name ?? "—",
        category: svc?.category ?? undefined,
        status: a.status,
      });
    }
    for (const s of allSlots) {
      const start = new Date(s.starts_at);
      if (start < weekStart || start >= weekEnd) continue;
      const svc = (s as { services?: { title?: string; kind?: string } | null }).services;
      const ended = new Date(s.ends_at).getTime() < now;
      const full = s.booked >= s.capacity;
      const status = !s.is_active ? "Inativa" : ended ? "Encerrada" : full ? "Lotada" : "Aberta";
      list.push({
        id: `s-${s.id}`,
        kind: "vaga",
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        title: svc?.title ?? "Vaga",
        subtitle: `${s.booked}/${s.capacity} · ${status}`,
        category: svc?.kind,
        status,
        dim: ended || !s.is_active,
      });
    }
    for (const e of weekEvents) {
      list.push({
        id: `e-${e.id}`,
        kind: "evento",
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        title: e.title,
        subtitle: e.is_published ? "Publicado" : "Rascunho",
        dim: !e.is_published,
      });
    }
    for (const t of weekTasks) {
      if (!t.due_at) continue;
      const overdue = new Date(t.due_at).getTime() < now && t.status === "pendente";
      list.push({
        id: `t-${t.id}`,
        kind: "tarefa",
        starts_at: t.due_at,
        title: t.title,
        subtitle: overdue ? "Atrasada" : t.status,
        status: t.status,
        dim: t.status === "concluida" || t.status === "cancelada",
      });
    }
    return list;
  }, [apptData, allSlots, weekEvents, weekTasks, weekStart, weekEnd, now]);

  // Filter pipeline
  const filtered = useMemo(() => {
    if (filter === "todos") return items;
    if (filter === "compromissos") return items.filter((i) => i.kind === "compromisso");
    if (filter === "tarefas") return items.filter((i) => i.kind === "tarefa");
    if (filter === "vagas") return items.filter((i) => i.kind === "vaga");
    if (filter === "eventos") return items.filter((i) => i.kind === "evento");
    return items.filter((i) => i.category === filter);
  }, [items, filter]);

  // Summary tiles (PDF §6)
  const todayAppts = (apptData?.appointments ?? []).filter((a) => isToday(new Date(a.starts_at)));
  const happeningNow = todayAppts.filter((a) => {
    const s = new Date(a.starts_at).getTime();
    const e = new Date(a.ends_at).getTime();
    return s <= now && e >= now;
  });
  const upcoming = (apptData?.appointments ?? []).filter((a) => new Date(a.starts_at).getTime() > now);
  const vagasAbertas = allSlots.filter((s) => s.is_active && new Date(s.ends_at).getTime() > now && s.booked < s.capacity).length;
  const tarefasPendentes = weekTasks.filter((t) => t.status === "pendente").length;

  // Sidebar lists
  const sideToday = items.filter((i) => isToday(new Date(i.starts_at)) && !i.dim).slice(0, 6);
  const sideUpcoming = items
    .filter((i) => new Date(i.starts_at).getTime() > now && !isToday(new Date(i.starts_at)) && !i.dim)
    .slice(0, 6);
  const sidePast = items
    .filter((i) => (i.ends_at ? new Date(i.ends_at).getTime() : new Date(i.starts_at).getTime()) < now)
    .slice(-6)
    .reverse();
  const alerts: string[] = [];
  for (const s of allSlots) {
    if (s.is_active && new Date(s.ends_at).getTime() < now) {
      const title = (s as { services?: { title?: string } | null }).services?.title ?? "Vaga";
      alerts.push(`Vaga vencida ainda ativa: ${title}`);
    }
  }
  for (const t of weekTasks) {
    if (t.status === "pendente" && t.due_at && new Date(t.due_at).getTime() < now) {
      alerts.push(`Tarefa atrasada: ${t.title}`);
    }
  }

  const handleCreate = (kind: "compromisso" | "tarefa" | "vaga" | "evento") => {
    if (kind === "compromisso") setShowAppointment(true);
    else if (kind === "vaga") setShowSlot(true);
    else if (kind === "tarefa") setShowTask(true);
    else if (kind === "evento") window.location.href = "/admin/eventos?new=1";
  };

  const FILTERS: { key: FilterKind; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "compromissos", label: "Compromissos" },
    { key: "tarefas", label: "Tarefas" },
    { key: "vagas", label: "Vagas" },
    { key: "eventos", label: "Eventos" },
    { key: "consultoria", label: "Consultoria" },
    { key: "tour", label: "Tour" },
    { key: "clube", label: "Clube" },
    { key: "burocracia", label: "Burocracia" },
  ];

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

          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as typeof view)} size="sm" variant="outline">
            <ToggleGroupItem value="dia">Dia</ToggleGroupItem>
            <ToggleGroupItem value="semana">Semana</ToggleGroupItem>
            <ToggleGroupItem value="mes" disabled>Mês</ToggleGroupItem>
          </ToggleGroup>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button variant="outline" size="sm" disabled className="opacity-70 cursor-not-allowed gap-2">
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <AdminStatCard label="Hoje" value={todayAppts.length} icon={CalendarDays} tone="blue" />
        <AdminStatCard label="Acontecendo agora" value={happeningNow.length} icon={Activity} tone="green" />
        <AdminStatCard label="Próximos" value={upcoming.length} icon={Clock} tone="amber" />
        <AdminStatCard label="Vagas abertas" value={vagasAbertas} icon={Ticket} tone="amber" />
        <AdminStatCard label="Tarefas pendentes" value={tarefasPendentes} icon={ListChecks} tone="red" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs uppercase tracking-wider font-display px-3 py-1.5 rounded-full border transition ${
              filter === f.key
                ? "bg-admin-accent text-white border-admin-accent"
                : "bg-admin-surface text-admin-ink-muted border-admin-border hover:border-admin-accent"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Calendário + lateral */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <BentoCard padded={false}>
          <div className="overflow-x-auto">
            <div className="grid min-w-[700px]" style={{ gridTemplateColumns: `60px repeat(${days.length}, 1fr)` }}>
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
                    const cellStart = new Date(d);
                    cellStart.setHours(h, 0, 0, 0);
                    const cellEnd = new Date(cellStart);
                    cellEnd.setHours(h + 1);
                    const cellItems = filtered.filter((it) => {
                      const s = new Date(it.starts_at);
                      return s >= cellStart && s < cellEnd;
                    });
                    return (
                      <div key={d.toISOString() + h} className="border-r border-b border-admin-border min-h-[60px] p-1 relative">
                        {cellItems.map((it) => (
                          <ItemPill key={it.id} item={it} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </BentoCard>

        <aside className="space-y-4">
          <SideList title="Hoje" items={sideToday} empty="Nada para hoje" />
          <SideList title="Próximos" items={sideUpcoming} empty="Sem itens próximos" />
          <SideList title="Já ocorreu" items={sidePast} empty="Sem histórico" />
          <BentoCard padded>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-display text-sm uppercase tracking-wider text-admin-ink">Alertas</h3>
            </div>
            {alerts.length === 0 ? (
              <p className="text-xs text-admin-ink-muted">Nada crítico no momento.</p>
            ) : (
              <ul className="space-y-1 text-xs text-admin-ink">
                {alerts.slice(0, 6).map((a, i) => <li key={i}>• {a}</li>)}
              </ul>
            )}
          </BentoCard>
        </aside>
      </div>

      <div className="flex flex-wrap gap-4 text-xs">
        {Object.entries(CATEGORY_COLOR).map(([k, c]) => (
          <span key={k} className={`${c} border-l-4 px-2 py-0.5 rounded capitalize`}>{k}</span>
        ))}
        <span className="border-l-4 border-dashed border-orange-500 bg-orange-50 text-orange-900 px-2 py-0.5 rounded">vaga</span>
        <span className="border-l-4 border-pink-500 bg-pink-50 text-pink-900 px-2 py-0.5 rounded">evento</span>
        <span className="border-l-4 border-slate-400 bg-slate-100 text-slate-700 px-2 py-0.5 rounded">tarefa</span>
      </div>

      {/* Vagas & Slots — gestão tabular */}
      <SlotsPanel />

      {isLoading && <p className="text-sm text-admin-ink-muted">Carregando...</p>}

      <AppointmentDialog open={showAppointment} onOpenChange={setShowAppointment} />
      <TaskDialog open={showTask} onOpenChange={setShowTask} />
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

function ItemPill({ item }: { item: CalItem }) {
  let cls = "bg-slate-100 border-slate-400 text-slate-900";
  if (item.kind === "compromisso") {
    cls = CATEGORY_COLOR[item.category ?? ""] ?? cls;
  } else if (item.kind === "vaga") {
    cls = "bg-orange-50 border-orange-500 text-orange-900 border-dashed";
  } else if (item.kind === "evento") {
    cls = "bg-pink-50 border-pink-500 text-pink-900";
  } else if (item.kind === "tarefa") {
    cls = "bg-slate-100 border-slate-400 text-slate-700";
  }
  return (
    <div className={`${cls} border-l-4 rounded text-[10px] px-1.5 py-1 mb-1 ${item.dim ? "opacity-50" : ""}`}>
      <div className="font-medium truncate">{item.title}</div>
      {item.subtitle && <div className="opacity-80 truncate">{item.subtitle}</div>}
    </div>
  );
}

function SideList({ title, items, empty }: { title: string; items: CalItem[]; empty: string }) {
  return (
    <BentoCard padded>
      <h3 className="font-display text-sm uppercase tracking-wider text-admin-ink mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-admin-ink-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="text-xs">
              <div className="font-display text-admin-ink truncate">{i.title}</div>
              <div className="text-admin-ink-muted tabular-nums">
                {new Date(i.starts_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                {i.subtitle ? ` · ${i.subtitle}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </BentoCard>
  );
}

