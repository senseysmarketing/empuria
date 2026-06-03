import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BentoCard } from "@/components/admin/BentoCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { listServicePrices, updateServicePrice } from "@/lib/admin/service-prices.functions";
import { Loader2, Save } from "lucide-react";

type ServiceRow = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  kind: string | null;
  price_cents: number;
  currency: string;
  online_price_cents: number | null;
  online_currency: string | null;
  display_price_note: string | null;
  is_active: boolean;
  requires_slot: boolean;
  requires_documents: boolean;
  duration_minutes: number | null;
};

function centsToInput(cents: number | null | undefined) {
  return ((cents ?? 0) / 100).toFixed(2);
}

function money(cents: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

export function ServicosPrecosTab() {
  const fetchServices = useServerFn(listServicePrices);
  const updateService = useServerFn(updateServicePrice);
  const [drafts, setDrafts] = useState<
    Record<string, Partial<ServiceRow> & { priceInput?: string }>
  >({});

  const servicesQ = useQuery({
    queryKey: ["config-service-prices"],
    queryFn: () => fetchServices(),
  });

  const mutation = useMutation({
    mutationFn: (service: ServiceRow) => {
      const draft = drafts[service.id] ?? {};
      const priceNumber = Number(
        String(
          draft.priceInput ?? centsToInput(service.online_price_cents ?? service.price_cents),
        ).replace(",", "."),
      );
      return updateService({
        data: {
          id: service.id,
          online_price_cents: Math.round((Number.isFinite(priceNumber) ? priceNumber : 0) * 100),
          online_currency: (draft.online_currency ?? service.online_currency ?? "BRL") as
            | "BRL"
            | "EUR"
            | "USD",
          display_price_note:
            String(draft.display_price_note ?? service.display_price_note ?? "").trim() || null,
          is_active: Boolean(draft.is_active ?? service.is_active),
          requires_slot: Boolean(draft.requires_slot ?? service.requires_slot),
          requires_documents: Boolean(draft.requires_documents ?? service.requires_documents),
          duration_minutes:
            draft.duration_minutes === null || draft.duration_minutes === undefined
              ? service.duration_minutes
              : Number(draft.duration_minutes),
        },
      });
    },
    onSuccess: async () => {
      toast.success("Servico atualizado");
      setDrafts({});
      await servicesQ.refetch();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao salvar servico"),
  });

  const services = useMemo(() => (servicesQ.data ?? []) as ServiceRow[], [servicesQ.data]);
  const totalActive = useMemo(
    () => services.filter((service) => service.is_active).length,
    [services],
  );

  return (
    <BentoCard>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-admin-ink">Servicos & Precos</h2>
          <p className="mt-1 text-sm text-admin-ink-muted">
            Valores cobrados no checkout interno, especialmente Mercado Pago em BRL.
          </p>
        </div>
        <Badge variant="outline">{totalActive} ativos</Badge>
      </div>

      {servicesQ.isLoading ? (
        <div className="flex items-center gap-2 text-admin-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando servicos...
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-admin-border p-8 text-center text-admin-ink-muted">
          Nenhum servico cadastrado.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-admin-border">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-admin-surface-2 text-left text-xs uppercase tracking-wide text-admin-ink-muted">
              <tr>
                <th className="px-4 py-3">Servico</th>
                <th className="px-4 py-3">Preco atual</th>
                <th className="px-4 py-3">Preco online</th>
                <th className="px-4 py-3">Nota</th>
                <th className="px-4 py-3">Regras</th>
                <th className="px-4 py-3 text-right">Acao</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => {
                const draft = drafts[service.id] ?? {};
                const onlineCents = service.online_price_cents ?? service.price_cents;
                return (
                  <tr key={service.id} className="border-t border-admin-border align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-admin-ink">{service.title}</div>
                      <div className="mt-1 text-xs text-admin-ink-muted">
                        {service.slug} · {service.category}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Switch
                          checked={Boolean(draft.is_active ?? service.is_active)}
                          onCheckedChange={(value) =>
                            setDrafts((old) => ({
                              ...old,
                              [service.id]: { ...old[service.id], is_active: value },
                            }))
                          }
                        />
                        <span className="text-xs text-admin-ink-muted">Ativo</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-admin-ink-muted">
                      {money(service.price_cents, service.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="grid grid-cols-[1fr_84px] gap-2">
                        <Input
                          value={draft.priceInput ?? centsToInput(onlineCents)}
                          onChange={(event) =>
                            setDrafts((old) => ({
                              ...old,
                              [service.id]: { ...old[service.id], priceInput: event.target.value },
                            }))
                          }
                        />
                        <Input value="BRL" readOnly />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Input
                        value={String(draft.display_price_note ?? service.display_price_note ?? "")}
                        onChange={(event) =>
                          setDrafts((old) => ({
                            ...old,
                            [service.id]: {
                              ...old[service.id],
                              display_price_note: event.target.value,
                            },
                          }))
                        }
                        placeholder="Ex.: valor promocional"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-2">
                        <ToggleLine
                          label="Agenda"
                          checked={Boolean(draft.requires_slot ?? service.requires_slot)}
                          onChange={(value) =>
                            setDrafts((old) => ({
                              ...old,
                              [service.id]: { ...old[service.id], requires_slot: value },
                            }))
                          }
                        />
                        <ToggleLine
                          label="Documentos"
                          checked={Boolean(draft.requires_documents ?? service.requires_documents)}
                          onChange={(value) =>
                            setDrafts((old) => ({
                              ...old,
                              [service.id]: { ...old[service.id], requires_documents: value },
                            }))
                          }
                        />
                        <Label className="text-xs text-admin-ink-muted">Duracao min</Label>
                        <Input
                          type="number"
                          min={0}
                          value={Number(draft.duration_minutes ?? service.duration_minutes ?? 0)}
                          onChange={(event) =>
                            setDrafts((old) => ({
                              ...old,
                              [service.id]: {
                                ...old[service.id],
                                duration_minutes: Number(event.target.value || 0),
                              },
                            }))
                          }
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        onClick={() => mutation.mutate(service)}
                        disabled={mutation.isPending}
                        className="gap-2"
                      >
                        <Save className="h-4 w-4" />
                        Salvar
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </BentoCard>
  );
}

function ToggleLine({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-admin-ink-muted">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
