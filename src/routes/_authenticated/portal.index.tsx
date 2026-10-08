import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, FileText, Wallet } from "lucide-react";
import { getPortalDashboard } from "@/lib/portal/dashboard.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { DashboardSkeleton } from "@/components/portal/PortalSkeleton";
import { PassportCard } from "@/components/portal/PassportCard";

export const Route = createFileRoute("/_authenticated/portal/")({
  component: PortalDashboard,
});

const statusLabels: Record<string, string> = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  aguardando_documentos: "Aguardando documentos",
  em_andamento: "Em andamento",
  aguardando_cliente: "Aguardando você",
  concluido: "Concluído",
  inativo: "Inativo",
};

function PortalDashboard() {
  const fetchDash = useServerFn(getPortalDashboard);
  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-dashboard"],
    queryFn: () => fetchDash(),
  });

  if (isLoading) return <DashboardSkeleton />;
  if (error || !data)
    return (
      <p className="text-sm text-red-600">Não foi possível carregar seu portal. Tente novamente.</p>
    );
  const firstName = (data.profile?.full_name ?? "").split(" ")[0] || "imigrante";
  const appointment = data.nextAppointment;
  const appointmentTitle = (appointment?.services as { title?: string } | null)?.title;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl font-bold tracking-tight text-admin-ink">
          Olá, {firstName}
        </h1>
        <p className="mt-1 text-sm text-admin-ink-muted">
          Acompanhe seus serviços e documentos com o Instituto Empuria.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <BentoCard title="Sua situação" padded className="lg:col-span-2">
          <p className="text-xl font-display text-admin-ink">
            {statusLabels[data.profile?.member_status ?? "novo"] ?? "Novo"}
          </p>
          {data.profile?.member_next_step ? (
            <div className="mt-4 rounded-xl border border-admin-border bg-admin-bg p-4">
              <p className="text-xs font-display uppercase tracking-wider text-admin-ink-muted">
                Próximo passo
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-admin-ink">
                {data.profile.member_next_step}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-admin-ink-muted">
              Nossa equipe atualizará o próximo passo quando houver uma orientação para você.
            </p>
          )}
        </BentoCard>

        <BentoCard title="Documentos" padded>
          <FileText className="h-6 w-6 text-admin-accent" />
          <p className="mt-3 text-sm text-admin-ink">
            {data.documents.needsUpload > 0
              ? `${data.documents.needsUpload} documento(s) aguardando seu envio`
              : "Nenhum documento aguardando seu envio"}
          </p>
          <p className="mt-1 text-xs text-admin-ink-muted">
            {data.documents.underReview} em análise · {data.documents.total} no total
          </p>
          <Link
            to="/portal/documentos"
            className="mt-4 inline-flex items-center gap-1 text-sm font-display text-admin-accent"
          >
            Ver documentos <ArrowRight className="h-4 w-4" />
          </Link>
        </BentoCard>

        <BentoCard title="Meus serviços" padded>
          <Wallet className="h-6 w-6 text-admin-accent" />
          {data.orders.length ? (
            <ul className="mt-3 space-y-2">
              {data.orders.slice(0, 3).map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-admin-ink">{order.service_title}</span>
                  <span className="shrink-0 text-xs text-admin-ink-muted">
                    {order.delivery_status.replaceAll("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-admin-ink-muted">Nenhum serviço contratado ainda.</p>
          )}
          <Link
            to="/portal/servicos"
            className="mt-4 inline-flex items-center gap-1 text-sm font-display text-admin-accent"
          >
            Ver meus serviços <ArrowRight className="h-4 w-4" />
          </Link>
        </BentoCard>

        <BentoCard title="Próximo compromisso" padded className="lg:col-span-2">
          <CalendarClock className="h-6 w-6 text-admin-accent" />
          {appointment ? (
            <div className="mt-2">
              <p className="font-display text-admin-ink">{appointmentTitle ?? "Compromisso"}</p>
              <p className="text-sm text-admin-ink-muted">
                {new Date(appointment.starts_at).toLocaleString("pt-BR", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-admin-ink-muted">
              Nenhum compromisso agendado no momento.
            </p>
          )}
        </BentoCard>
      </div>
      {data.profile?.id && (
        <details className="rounded-xl border border-admin-border bg-admin-surface p-4">
          <summary className="cursor-pointer text-sm font-display text-admin-accent">
            Ver meu passaporte e QR
          </summary>
          <div className="mt-4">
            <PassportCard
              userId={data.profile.id}
              fullName={data.profile.full_name ?? "Membro"}
              memberSince={data.profile.created_at}
            />
          </div>
        </details>
      )}
    </div>
  );
}
