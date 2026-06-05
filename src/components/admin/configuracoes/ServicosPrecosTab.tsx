import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  listServicePrices,
  toggleServiceActive,
} from "@/lib/admin/service-prices.functions";
import { getServiceImage } from "@/lib/service-images";
import { Pencil, Search } from "lucide-react";
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
  const toggleFn = useServerFn(toggleServiceActive);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [search, setSearch] = useState("");

  const servicesQ = useQuery({
    queryKey: ["config-service-prices"],
    queryFn: () => fetchServices(),
  });

  const services = useMemo(() => (servicesQ.data ?? []) as ServiceRow[], [servicesQ.data]);
  const totalActive = useMemo(
    () => services.filter((s) => s.is_active).length,
    [services],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return services;
    return services.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.category ?? "").toLowerCase().includes(q),
    );
  }, [services, search]);

  const toggleMutation = useMutation({
    mutationFn: (vars: { id: string; is_active: boolean }) =>
      toggleFn({ data: vars }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["config-service-prices"] });
      const prev = qc.getQueryData<ServiceRow[]>(["config-service-prices"]);
      qc.setQueryData<ServiceRow[]>(["config-service-prices"], (old) =>
        (old ?? []).map((s) => (s.id === vars.id ? { ...s, is_active: vars.is_active } : s)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["config-service-prices"], ctx.prev);
      toast.error("Não foi possível atualizar o status");
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.is_active ? "Serviço ativado" : "Serviço desativado");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["config-service-prices"] });
    },
  });

  return (
    <BentoCard padded={false}>
      <div className="p-5 border-b border-admin-border space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-display text-lg text-admin-ink">Serviços & Valores</h3>
            <p className="text-xs text-admin-ink-muted mt-1">
              {services.length} serviços · {totalActive} ativos
            </p>
          </div>
          <span className="text-xs text-admin-ink-muted tabular-nums mt-1">
            {filtered.length} de {services.length} {services.length === 1 ? "serviço" : "serviços"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-admin-ink-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título, slug ou categoria…"
              className="pl-8 bg-admin-bg border-admin-border h-9"
            />
          </div>
        </div>
      </div>

      {servicesQ.isLoading ? (
        <div className="p-8 text-center text-admin-ink-muted text-sm">Carregando…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-admin-bg text-[10px] uppercase tracking-wider text-admin-ink-muted">
              <tr>
                <th className="text-left p-3 font-display">Serviço</th>
                <th className="text-right p-3 font-display">Valor</th>
                <th className="text-left p-3 font-display">Regras</th>
                <th className="text-center p-3 font-display">Status</th>
                <th className="text-right p-3 font-display">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const cents = s.online_price_cents ?? s.price_cents;
                const showZeroWarn = s.is_active && cents === 0;
                const img = getServiceImage({ image_url: s.image_url, kind: s.kind });
                return (
                  <tr key={s.id} className="border-t border-admin-border hover:bg-admin-bg/50 align-middle">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-admin-border bg-admin-bg">
                          <img src={img} alt={s.title} className="h-full w-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-admin-ink">{s.title}</div>
                          <div className="mt-0.5 truncate text-[11px] text-admin-ink-muted">
                            {s.slug}
                            {s.category ? ` · ${s.category}` : ""}
                          </div>
                          {s.display_price_note && (
                            <div className="mt-0.5 truncate text-[11px] italic text-admin-ink-muted">
                              "{s.display_price_note}"
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      <div className="text-admin-ink">{money(cents, "BRL")}</div>
                      {showZeroWarn && (
                        <div className="mt-0.5 text-[10px] text-amber-600">
                          Valor zerado
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-admin-ink-muted">{rulesSummary(s)}</td>
                    <td className="p-3 text-center">
                      <div className="inline-flex items-center gap-2">
                        <Switch
                          checked={s.is_active}
                          onCheckedChange={(v) =>
                            toggleMutation.mutate({ id: s.id, is_active: v })
                          }
                          disabled={toggleMutation.isPending}
                        />
                        <span className="text-[11px] text-admin-ink-muted">
                          {s.is_active ? "Ativo" : "Inativo"}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(s)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-admin-ink-muted text-sm">
                    {services.length === 0
                      ? "Nenhum serviço cadastrado."
                      : "Nenhum serviço corresponde à busca."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <EditServicePriceDialog
        service={editing}
        open={!!editing}
        onOpenChange={(o: boolean) => !o && setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await servicesQ.refetch();
        }}
      />
    </BentoCard>
  );
}
