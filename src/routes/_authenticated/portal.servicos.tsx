import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMyServices } from "@/lib/portal/services.functions";
import { MyServicesPanel } from "@/components/portal/MyServicesPanel";
import { ServiceProgressBar } from "@/components/portal/ServiceProgressBar";
import { BentoCard } from "@/components/admin/BentoCard";
import { GridSkeleton } from "@/components/portal/PortalSkeleton";
import { Wallet, ArrowRight, ShoppingBag } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/servicos")({
  component: ServicosPage,
});

function ServicosPage() {
  const fetchMy = useServerFn(getMyServices);
  const { data, isLoading } = useQuery({
    queryKey: ["my-services"],
    queryFn: () => fetchMy(),
  });

  const highTicket = (data?.orders ?? []).filter((o) => {
    const svc = data?.services.find((s) => s.id === o.service_id);
    return o.payment_status === "aprovado" && (svc?.kind === "banking" || svc?.kind === "consulting");
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-admin-accent-soft text-admin-accent flex items-center justify-center">
          <Wallet className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Meus Serviços</h1>
          <p className="text-admin-ink-muted text-sm mt-1 font-body">
            Vouchers, agendamentos e progresso dos processos contratados.
          </p>
        </div>
      </header>

      {isLoading ? (
        <GridSkeleton />
      ) : !data || data.orders.length === 0 ? (
        <EmptyServices />
      ) : (
        <div className="space-y-6">
          {highTicket.length > 0 && (
            <BentoCard title="Processos em andamento">
              <ul className="space-y-5">
                {highTicket.map((o) => {
                  const svc = data.services.find((s) => s.id === o.service_id);
                  return (
                    <li key={o.id}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="font-display text-sm text-admin-ink">{o.service_title}</div>
                          {o.voucher_code && (
                            <code className="text-[10px] font-mono text-admin-ink-muted">{o.voucher_code}</code>
                          )}
                        </div>
                        <span className="text-[10px] uppercase tracking-widest font-display text-admin-accent">
                          {o.delivery_status}
                        </span>
                      </div>
                      <ServiceProgressBar kind={svc?.kind} status={o.delivery_status} />
                    </li>
                  );
                })}
              </ul>
            </BentoCard>
          )}

          <BentoCard title="Carteira de vouchers" padded>
            <MyServicesPanel />
          </BentoCard>
        </div>
      )}
    </div>
  );
}

function EmptyServices() {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Link
        to="/portal/loja"
        className="rounded-2xl border border-dashed border-admin-border hover:border-admin-accent bg-admin-surface-2 hover:bg-admin-accent-soft/40 p-8 transition-colors group"
      >
        <ShoppingBag className="h-6 w-6 text-admin-accent mb-3" />
        <div className="font-display text-lg text-admin-ink">Descubra o Tour Raiz</div>
        <p className="text-sm text-admin-ink-muted mt-1 font-body">
          Caminhe por Madrid com nossos hosts e descubra a cidade pelos olhos de quem mora aqui.
        </p>
        <span className="inline-flex items-center gap-1 mt-4 text-xs font-display uppercase tracking-wider text-admin-accent">
          Ver tours <ArrowRight className="h-3 w-3" />
        </span>
      </Link>
      <Link
        to="/portal/loja"
        className="rounded-2xl border border-dashed border-admin-border hover:border-admin-accent bg-admin-surface-2 hover:bg-admin-accent-soft/40 p-8 transition-colors"
      >
        <Wallet className="h-6 w-6 text-admin-accent mb-3" />
        <div className="font-display text-lg text-admin-ink">Já tem sua documentação pronta?</div>
        <p className="text-sm text-admin-ink-muted mt-1 font-body">
          Agende uma análise com nosso time e dê o próximo passo do seu processo migratório.
        </p>
        <span className="inline-flex items-center gap-1 mt-4 text-xs font-display uppercase tracking-wider text-admin-accent">
          Agendar análise <ArrowRight className="h-3 w-3" />
        </span>
      </Link>
    </div>
  );
}
