import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getCockpitMetrics, getActivityFeed } from "@/lib/admin/cockpit.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { MetricTile } from "@/components/admin/MetricTile";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { ArrivalDialog } from "@/components/admin/ArrivalDialog";
import { RevenueChart } from "@/components/admin/RevenueChart";
import { PassportScannerDialog } from "@/components/admin/PassportScannerDialog";
import { Euro, Crown, CalendarClock, Users } from "lucide-react";
import { useTopBarActions, useTopBarQuickStat } from "@/components/shared/TopBarActionsContext";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: CockpitPage,
});

function CockpitPage() {
  const fetchMetrics = useServerFn(getCockpitMetrics);
  const fetchFeed = useServerFn(getActivityFeed);

  const metricsQ = useQuery({ queryKey: ["cockpit"], queryFn: () => fetchMetrics(), retry: false });
  const feedQ = useQuery({ queryKey: ["activity"], queryFn: () => fetchFeed(), retry: false });

  useTopBarActions(
    <>
      <PassportScannerDialog />
      <ArrivalDialog />
    </>,
  );

  const m = metricsQ.data;
  useTopBarQuickStat(
    m ? { label: "Vendas hoje", value: `€ ${(m.salesTodayCents / 100).toFixed(2)}` } : null,
  );

  if (metricsQ.error) {
    return (
      <div className="text-center py-24">
        <h1 className="font-display text-3xl">Acesso restrito</h1>
        <p className="text-admin-ink-muted mt-2">Você precisa de permissão de staff ou admin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">


      <div className="grid grid-cols-12 gap-4">
        {/* Metric tiles */}
        <MetricTile
          className="col-span-12 sm:col-span-6 lg:col-span-3"
          label="Vendas hoje"
          value={m ? `€ ${m.salesToday.toFixed(2)}` : "—"}
          hint="Esteira 1 (pagas)"
          icon={Euro}
          accent="success"
        />
        <MetricTile
          className="col-span-12 sm:col-span-6 lg:col-span-3"
          label="Novos membros (30d)"
          value={m?.newMembers ?? "—"}
          hint="Clube do Imigrante"
          icon={Crown}
          accent="accent"
        />
        <MetricTile
          className="col-span-12 sm:col-span-6 lg:col-span-3"
          label="Reuniões hoje"
          value={m?.appointmentsToday ?? "—"}
          hint="Sala Gran Vía + tours"
          icon={CalendarClock}
        />
        <MetricTile
          className="col-span-12 sm:col-span-6 lg:col-span-3"
          label="Chegadas hoje"
          value={m?.todayArrivals.length ?? "—"}
          hint="Recepção física"
          icon={Users}
        />

        {/* Revenue chart */}
        <BentoCard
          title="Receita · últimos 30 dias"
          className="col-span-12 lg:col-span-8"
        >
          {m ? <RevenueChart data={m.revenueSeries} /> : <div className="h-56" />}
        </BentoCard>

        {/* Activity feed */}
        <BentoCard title="Feed de atividade" className="col-span-12 lg:col-span-4 row-span-2">
          <ActivityFeed initial={feedQ.data ?? []} />
        </BentoCard>

        {/* Today's appointments */}
        <BentoCard title="Agenda de hoje" className="col-span-12 lg:col-span-4">
          {m && m.todayAppointments.length > 0 ? (
            <ul className="space-y-3">
              {m.todayAppointments.map((a) => {
                const svc = (a as { services?: { title?: string } | null }).services;
                const prof = (a as { profiles?: { full_name?: string } | null }).profiles;
                return (
                  <li key={a.id} className="flex justify-between items-start border-b border-admin-border pb-2 last:border-0">
                    <div className="min-w-0">
                      <div className="text-sm text-admin-ink truncate">{svc?.title ?? "Serviço"}</div>
                      <div className="text-xs text-admin-ink-muted truncate">{prof?.full_name ?? "—"}</div>
                    </div>
                    <span className="text-xs font-display tabular-nums text-admin-ink-muted shrink-0 ml-2">
                      {new Date(a.starts_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-admin-ink-muted">Nenhuma reunião marcada para hoje.</p>
          )}
        </BentoCard>

        {/* Upcoming */}
        <BentoCard title="Próximos agendamentos" className="col-span-12 lg:col-span-4">
          {m && m.upcomingAppointments.length > 0 ? (
            <ul className="space-y-3">
              {m.upcomingAppointments.map((a) => {
                const svc = (a as { services?: { title?: string } | null }).services;
                return (
                  <li key={a.id} className="text-sm">
                    <div className="text-admin-ink truncate">{svc?.title ?? "Serviço"}</div>
                    <div className="text-xs text-admin-ink-muted">
                      {new Date(a.starts_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-admin-ink-muted">Nada nas próximas datas.</p>
          )}
        </BentoCard>

        {/* Arrivals today */}
        <BentoCard title="Chegadas hoje" className="col-span-12 lg:col-span-4">
          {m && m.todayArrivals.length > 0 ? (
            <ul className="space-y-2">
              {m.todayArrivals.map((ar) => (
                <li key={ar.id} className="flex justify-between text-sm border-b border-admin-border pb-2 last:border-0">
                  <div>
                    <div className="text-admin-ink">{ar.visitor_name}</div>
                    {ar.purpose && <div className="text-xs text-admin-ink-muted">{ar.purpose}</div>}
                  </div>
                  <span className="text-xs text-admin-ink-muted tabular-nums">
                    {new Date(ar.arrived_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
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
