import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BentoCard } from "@/components/admin/BentoCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  listServicePrices,
  toggleServiceActive,
} from "@/lib/admin/service-prices.functions";
import { getServiceImage } from "@/lib/service-images";
import { Loader2, Pencil, Search, Tags } from "lucide-react";
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
    <BentoCard>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-admin-accent/10 text-admin-accent">
            <Tags className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold text-admin-ink">Serviços & Valores</h2>
            <p className="mt-1 text-sm text-admin-ink-muted">
              Gerencie os valores exibidos no site, conteúdo público e regras de venda.
            </p>
          </div>
        </div>
        <Badge variant="outline">{totalActive} ativos</Badge>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-ink-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título, slug ou categoria..."
            className="pl-9"
          />
        </div>
      </div>

      {servicesQ.isLoading ? (
        <div className="flex items-center gap-2 text-admin-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando serviços...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-admin-border p-8 text-center text-admin-ink-muted">
          {services.length === 0 ? "Nenhum serviço cadastrado." : "Nenhum serviço encontrado."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-admin-border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-admin-surface-2 text-left text-xs uppercase tracking-wide text-admin-ink-muted">
              <tr>
                <th className="px-4 py-3">Serviço</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Regras</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const cents = s.online_price_cents ?? s.price_cents;
                const showZeroWarn = s.is_active && cents === 0;
                const img = getServiceImage({ image_url: s.image_url, kind: s.kind });
                return (
                  <tr key={s.id} className="border-t border-admin-border align-middle">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-admin-border bg-admin-surface-2">
                          <img src={img} alt={s.title} className="h-full w-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-admin-ink">{s.title}</div>
                          <div className="mt-0.5 truncate text-xs text-admin-ink-muted">
                            {s.slug}
                            {s.category ? ` · ${s.category}` : ""}
                          </div>
                          {s.display_price_note && (
                            <div className="mt-1 truncate text-xs italic text-admin-ink-muted">
                              “{s.display_price_note}”
                            </div>
                          )}
                        </div>
                      </div>
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
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={s.is_active}
                          onCheckedChange={(v) =>
                            toggleMutation.mutate({ id: s.id, is_active: v })
                          }
                          disabled={toggleMutation.isPending}
                        />
                        <span className="text-xs text-admin-ink-muted">
                          {s.is_active ? "Ativo" : "Inativo"}
                        </span>
                      </div>
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
        onOpenChange={(o: boolean) => !o && setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await servicesQ.refetch();
        }}
      />
    </BentoCard>
  );
}
