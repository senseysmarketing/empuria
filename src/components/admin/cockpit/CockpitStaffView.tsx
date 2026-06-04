import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { BentoCard } from "@/components/admin/BentoCard";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { getCockpitMetrics } from "@/lib/admin/cockpit.functions";
import { listCalendarTasks } from "@/lib/admin/calendar-tasks.functions";
import { CalendarClock, ListTodo, Users, Bell } from "lucide-react";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function CockpitStaffView() {
  const fetchMetrics = useServerFn(getCockpitMetrics);
  const fetchTasks = useServerFn(listCalendarTasks);

  const metricsQ = useQuery({ queryKey: ["cockpit"], queryFn: () => fetchMetrics(), retry: false });
  const tasksQ = useQuery({ queryKey: ["my-tasks"], queryFn: () => fetchTasks(), retry: false });

  const m = metricsQ.data;
  const allTasks = tasksQ.data ?? [];
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const myTasksToday = allTasks
    .filter((t) => {
      if (t.status === "concluida" || t.status === "cancelada") return false;
      if (!t.due_at) return false;
      const d = new Date(t.due_at);
      return d < endOfDay;
    })
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-12 gap-4">
        <MetricTile
          className="col-span-12 sm:col-span-6 lg:col-span-3"
          label="Minhas tarefas"
          value={myTasksToday.length}
          hint="Pendentes para hoje"
          icon={ListTodo}
          accent="accent"
        />
        <MetricTile
          className="col-span-12 sm:col-span-6 lg:col-span-3"
          label="Reuniões hoje"
          value={m?.appointmentsToday ?? "—"}
          hint="Agenda do dia"
          icon={CalendarClock}
        />
        <MetricTile
          className="col-span-12 sm:col-span-6 lg:col-span-3"
          label="Chegadas hoje"
          value={m?.todayArrivals.length ?? "—"}
          hint="Recepção física"
          icon={Users}
        />
        <MetricTile
          className="col-span-12 sm:col-span-6 lg:col-span-3"
          label="Avisos"
          value={0}
          hint="Avisos operacionais"
          icon={Bell}
        />

        <BentoCard title="Minhas tarefas de hoje" className="col-span-12 lg:col-span-6">
          {myTasksToday.length > 0 ? (
            <ul className="space-y-3">
              {myTasksToday.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start justify-between gap-3 border-b border-admin-border pb-2 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-admin-ink truncate">{t.title}</div>
                    {t.description && (
                      <div className="text-xs text-admin-ink-muted truncate">
                        {t.description}
                      </div>
                    )}
                  </div>
                  {t.due_at && (
                    <span className="text-xs font-display tabular-nums text-admin-ink-muted shrink-0">
                      {fmtTime(t.due_at)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-admin-ink-muted">Nenhuma tarefa pendente para hoje.</p>
          )}
        </BentoCard>

        <BentoCard title="Agenda de hoje" className="col-span-12 lg:col-span-6">
          {m && m.todayAppointments.length > 0 ? (
            <ul className="space-y-3">
              {m.todayAppointments.map((a) => {
                const svc = (a as { services?: { title?: string } | null }).services;
                const prof = (a as { profiles?: { full_name?: string } | null }).profiles;
                return (
                  <li
                    key={a.id}
                    className="flex justify-between items-start border-b border-admin-border pb-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-admin-ink truncate">
                        {svc?.title ?? "Serviço"}
                      </div>
                      <div className="text-xs text-admin-ink-muted truncate">
                        {prof?.full_name ?? "—"}
                      </div>
                    </div>
                    <span className="text-xs font-display tabular-nums text-admin-ink-muted shrink-0 ml-2">
                      {fmtTime(a.starts_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-admin-ink-muted">Nenhuma reunião marcada para hoje.</p>
          )}
        </BentoCard>

        <BentoCard title="Próximos agendamentos" className="col-span-12 lg:col-span-6">
          {m && m.upcomingAppointments.length > 0 ? (
            <ul className="space-y-3">
              {m.upcomingAppointments.map((a) => {
                const svc = (a as { services?: { title?: string } | null }).services;
                return (
                  <li key={a.id} className="text-sm">
                    <div className="text-admin-ink truncate">{svc?.title ?? "Serviço"}</div>
                    <div className="text-xs text-admin-ink-muted">
                      {new Date(a.starts_at).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-admin-ink-muted">Nada nas próximas datas.</p>
          )}
        </BentoCard>

        <BentoCard title="Chegadas hoje" className="col-span-12 lg:col-span-6">
          {m && m.todayArrivals.length > 0 ? (
            <ul className="space-y-2">
              {m.todayArrivals.map((ar) => (
                <li
                  key={ar.id}
                  className="flex justify-between text-sm border-b border-admin-border pb-2 last:border-0"
                >
                  <div>
                    <div className="text-admin-ink">{ar.visitor_name}</div>
                    {ar.purpose && (
                      <div className="text-xs text-admin-ink-muted">{ar.purpose}</div>
                    )}
                  </div>
                  <span className="text-xs text-admin-ink-muted tabular-nums">
                    {fmtTime(ar.arrived_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-admin-ink-muted">Nenhuma chegada registrada hoje.</p>
          )}
        </BentoCard>
      </div>
    </div>
  );
}
