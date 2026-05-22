import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getPortalDashboard } from "@/lib/portal/dashboard.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { MetricTile } from "@/components/admin/MetricTile";
import { PassportCard } from "@/components/portal/PassportCard";
import { NextStepWidget } from "@/components/portal/NextStepWidget";
import { DashboardSkeleton } from "@/components/portal/PortalSkeleton";
import { Wallet, CalendarClock, Crown, Receipt, ArrowRight, ShoppingBag } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/")({
  component: PortalDashboard,
});

function PortalDashboard() {
  const fetchDash = useServerFn(getPortalDashboard);
  const { data, isLoading } = useQuery({
    queryKey: ["portal-dashboard"],
    queryFn: () => fetchDash(),
  });

  if (isLoading || !data) return <DashboardSkeleton />;

  const firstName = (data.profile?.full_name ?? "").split(" ")[0] || "imigrante";
  const greeting = data.nextAppointment
    ? `Bem-vindo a Madrid, ${firstName}`
    : `Preparando sua jornada, ${firstName}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl font-bold tracking-tight text-admin-ink">{greeting}</h1>
        <p className="text-admin-ink-muted text-sm mt-1 font-body">
          Seu painel de embarque · Tudo o que você precisa para os próximos passos.
        </p>
      </header>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8">
          <PassportCard
            userId={data.profile?.id ?? ""}
            fullName={data.profile?.full_name ?? "Imigrante"}
            memberSince={data.profile?.created_at}
            isClubMember={data.metrics.isClubMember}
          />
        </div>
        <BentoCard className="col-span-12 lg:col-span-4" padded>
          <NextStepWidget appointment={data.nextAppointment} />
        </BentoCard>

        <MetricTile
          className="col-span-6 lg:col-span-3"
          label="Serviços ativos"
          value={data.metrics.activeServices}
          hint="Em andamento"
          icon={Wallet}
          accent="accent"
        />
        <MetricTile
          className="col-span-6 lg:col-span-3"
          label="Próximas reuniões"
          value={data.upcomingAppointments.length}
          hint="Agendamentos"
          icon={CalendarClock}
        />
        <MetricTile
          className="col-span-6 lg:col-span-3"
          label="Clube"
          value={data.metrics.isClubMember ? "Ativo" : "—"}
          hint={data.metrics.isClubMember ? "Acesso liberado" : "Não associado"}
          icon={Crown}
          accent={data.metrics.isClubMember ? "success" : "neutral"}
        />
        <MetricTile
          className="col-span-6 lg:col-span-3"
          label="Vouchers"
          value={data.metrics.vouchers}
          hint="Disponíveis"
          icon={Receipt}
        />

        <BentoCard title="Próximos agendamentos" className="col-span-12 lg:col-span-8">
          {data.upcomingAppointments.length === 0 ? (
            <EmptyBanner
              title="Sua agenda está livre"
              copy="Que tal um tour, uma consultoria ou um café na Gran Vía?"
              to="/portal/loja"
              cta="Ver serviços"
            />
          ) : (
            <ul className="space-y-3">
              {data.upcomingAppointments.map((a) => {
                const svc = (a as { services?: { title?: string } | null }).services;
                return (
                  <li
                    key={a.id}
                    className="flex justify-between items-start border-b border-admin-border pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-admin-ink font-display">{svc?.title ?? "Serviço"}</div>
                      <div className="text-xs text-admin-ink-muted">
                        {new Date(a.starts_at).toLocaleString("pt-BR", {
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-widest font-display text-admin-accent">
                      {a.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </BentoCard>

        <BentoCard title="Recomendados para você" className="col-span-12 lg:col-span-4">
          {data.suggested.length === 0 ? (
            <p className="text-sm text-admin-ink-muted">Em breve novos serviços por aqui.</p>
          ) : (
            <ul className="space-y-3">
              {data.suggested.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/portal/loja"
                    className="flex items-center gap-3 group"
                  >
                    <div className="h-12 w-12 rounded-lg bg-admin-accent-soft text-admin-accent flex items-center justify-center shrink-0">
                      <ShoppingBag className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-display text-admin-ink truncate group-hover:text-admin-accent transition-colors">
                        {s.title}
                      </div>
                      <div className="text-xs text-admin-ink-muted">€ {(s.price_cents / 100).toFixed(2)}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-admin-ink-muted group-hover:text-admin-accent transition-colors" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </BentoCard>
      </div>
    </div>
  );
}

function EmptyBanner({
  title,
  copy,
  to,
  cta,
}: {
  title: string;
  copy: string;
  to: "/portal/loja" | "/portal/clube" | "/portal/servicos";
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="block rounded-xl border border-dashed border-admin-border hover:border-admin-accent bg-admin-surface-2 hover:bg-admin-accent-soft/40 p-6 transition-colors text-center"
    >
      <div className="font-display text-base text-admin-ink">{title}</div>
      <div className="text-xs text-admin-ink-muted mt-1 font-body">{copy}</div>
      <span className="inline-flex items-center gap-1 mt-3 text-xs font-display uppercase tracking-wider text-admin-accent">
        {cta} <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}
