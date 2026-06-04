import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BentoCard } from "@/components/admin/BentoCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listServicePrices } from "@/lib/admin/service-prices.functions";
import { Loader2, Pencil } from "lucide-react";
import { EditServicePriceDialog, type ServiceRow } from "./EditServicePriceDialog";

function money(cents: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

function rulesSummary(s: ServiceRow): string {
  const parts: string[] = [];
  if (s.requires_slot) {
    const dur = s.duration_minutes && s.duration_minutes > 0 ? ` · ${s.duration_minutes} min` : "";
    parts.push(`Agenda obrigatória${dur}`);
  } else {
    parts.push("Compra direta");
  }
  parts.push(s.requires_documents ? "Documentos obrigatórios" : "Sem documentos");
  return parts.join(" · ");
}

export function ServicosPrecosTab() {
  const fetchServices = useServerFn(listServicePrices);
  const [editing, setEditing] = useState<ServiceRow | null>(null);

  const servicesQ = useQuery({
    queryKey: ["config-service-prices"],
    queryFn: () => fetchServices(),
  });

  const services = useMemo(() => (servicesQ.data ?? []) as ServiceRow[], [servicesQ.data]);
  const totalActive = useMemo(
    () => services.filter((s) => s.is_active).length,
    [services],
  );

  return (
    <BentoCard>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-admin-ink">Serviços & Valores</h2>
          <p className="mt-1 text-sm text-admin-ink-muted">
            Gerencie os valores exibidos no site e cobrados no checkout em reais.
          </p>
        </div>
        <Badge variant="outline">{totalActive} ativos</Badge>
      </div>

      {servicesQ.isLoading ? (
        <div className="flex items-center gap-2 text-admin-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando serviços...
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-admin-border p-8 text-center text-admin-ink-muted">
          Nenhum serviço cadastrado.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-admin-border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-admin-surface-2 text-left text-xs uppercase tracking-wide text-admin-ink-muted">
              <tr>
                <th className="px-4 py-3">Serviço</th>
                <th className="px-4 py-3">Valor no site</th>
                <th className="px-4 py-3">Regras de venda</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => {
                const cents = s.online_price_cents ?? s.price_cents;
                const showZeroWarn = s.is_active && cents === 0;
                return (
                  <tr key={s.id} className="border-t border-admin-border align-middle">
                    <td className="px-4 py-3">
                      <div className="font-medium text-admin-ink">{s.title}</div>
                      <div className="mt-0.5 text-xs text-admin-ink-muted">
                        {s.slug}
                        {s.category ? ` · ${s.category}` : ""}
                      </div>
                      {s.display_price_note && (
                        <div className="mt-1 text-xs italic text-admin-ink-muted">
                          “{s.display_price_note}”
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-display text-base text-admin-ink">
                        {money(cents, "BRL")}
                      </div>
                      {showZeroWarn && (
                        <div className="mt-1 text-[11px] text-amber-600">
                          Valor zerado em serviço ativo
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-admin-ink-muted">{rulesSummary(s)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={s.is_active ? "default" : "outline"}>
                        {s.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => setEditing(s)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <EditServicePriceDialog
        service={editing}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await servicesQ.refetch();
        }}
      />
    </BentoCard>
  );
}
