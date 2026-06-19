import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Copy,
  Eye,
  Loader2,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ignoreWiseEvent,
  listOpenPaymentTargets,
  listWiseEvents,
  manuallyMatchWiseEvent,
  manuallyMatchWisePdvAttempt,
  markWiseEventDuplicate,
} from "@/lib/wise/wise.functions";

type WiseEventRow = {
  id: string;
  event_id: string | null;
  event_type: string;
  match_status: string;
  signature_valid: boolean;
  payload: Record<string, unknown>;
  matched_payment_id: string | null;
  matched_order_id: string | null;
  processed_at: string | null;
  notes: string | null;
  created_at: string;
};

type OrderTarget = {
  id: string;
  external_reference: string | null;
  service_title: string | null;
  customer_name: string | null;
  customer_email: string | null;
  payment_amount_cents: number | null;
  payment_currency: string | null;
  amount_cents: number | null;
  currency: string | null;
  payment_status: string;
  created_at: string;
};

type PdvTarget = {
  id: string;
  tab_id: string;
  reference: string;
  amount_eur_cents: number | null;
  currency: string | null;
  status: string;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
  created_at: string;
};

const FILTERS = [
  { key: "attention", label: "Precisa atenção" },
  { key: "no_reference", label: "Sem referência" },
  { key: "divergent", label: "Valor divergente" },
  { key: "duplicate", label: "Duplicados" },
  { key: "matched", label: "Conferidos" },
  { key: "ignored", label: "Ignorados" },
  { key: "all", label: "Todos" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function pickRef(payload: Record<string, unknown>): string | null {
  const r =
    (payload?.reference as string | undefined) ??
    ((payload?.data as Record<string, unknown> | undefined)?.reference as
      | string
      | undefined) ??
    null;
  return r && r.trim().length > 0 ? r : null;
}

function pickAmount(payload: Record<string, unknown>): number | null {
  const a =
    (payload?.amount as number | undefined) ??
    ((payload?.data as Record<string, unknown> | undefined)?.amount as
      | number
      | undefined);
  return typeof a === "number" ? a : null;
}

function pickCurrency(payload: Record<string, unknown>): string | null {
  const c =
    (payload?.currency as string | undefined) ??
    ((payload?.data as Record<string, unknown> | undefined)?.currency as
      | string
      | undefined) ??
    null;
  return c ?? null;
}

function pickPayer(payload: Record<string, unknown>): string | null {
  const data = (payload?.data as Record<string, unknown> | undefined) ?? {};
  const sender = (data?.sender as Record<string, unknown> | undefined) ?? {};
  const senderName =
    (sender?.name as string | undefined) ??
    (data?.sender_name as string | undefined) ??
    (payload?.payer_name as string | undefined) ??
    null;
  return senderName ?? null;
}

function reasonFor(row: WiseEventRow): { label: string; tone: string } {
  const ref = pickRef(row.payload);
  switch (row.match_status) {
    case "pending":
      return ref
        ? { label: "Referência não encontrada", tone: "bg-amber-100 text-amber-800" }
        : { label: "Sem referência", tone: "bg-amber-100 text-amber-800" };
    case "pdv_pending":
      return { label: "PDV não casou", tone: "bg-amber-100 text-amber-800" };
    case "underpaid":
      return { label: "Valor menor", tone: "bg-orange-100 text-orange-800" };
    case "overpaid":
      return { label: "Valor maior", tone: "bg-violet-100 text-violet-800" };
    case "duplicate":
      return { label: "Duplicado", tone: "bg-rose-100 text-rose-800" };
    case "ignored":
      return { label: "Ignorado", tone: "bg-gray-100 text-gray-700" };
    case "auto_matched":
      return { label: "Auto conciliado", tone: "bg-emerald-100 text-emerald-800" };
    case "manual_matched":
      return { label: "Manual", tone: "bg-blue-100 text-blue-800" };
    case "pdv_matched":
      return { label: "PDV conciliado", tone: "bg-emerald-100 text-emerald-800" };
    default:
      return { label: row.match_status, tone: "" };
  }
}

function fmtMoney(cents: number | null | undefined, currency?: string | null) {
  if (cents == null) return "—";
  const v = (cents / 100).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v} ${currency ?? "EUR"}`;
}

function fmtAmount(amount: number | null, currency?: string | null) {
  if (amount == null) return "—";
  return `${amount.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ""}`;
}

export function ConciliacoesWiseTab() {
  const list = useServerFn(listWiseEvents);
  const ignore = useServerFn(ignoreWiseEvent);
  const markDup = useServerFn(markWiseEventDuplicate);

  const [filter, setFilter] = useState<FilterKey>("attention");
  const [search, setSearch] = useState("");
  const [openRow, setOpenRow] = useState<WiseEventRow | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const q = useQuery({
    queryKey: ["wise-events-conciliacoes"],
    queryFn: () => list({ data: { limit: 200 } }),
  });

  const rawEvents = (q.data?.events ?? []) as WiseEventRow[];
  // Mostrar apenas eventos com valor (balances#credit, payment-link#payment-received).
  // Os demais (transfers#state-change etc.) não trazem dados suficientes para conciliar.
  const events = useMemo(
    () => rawEvents.filter((e) => pickAmount(e.payload) != null),
    [rawEvents],
  );

  const filtered = useMemo(() => {
    const bySearch = (e: WiseEventRow) => {
      if (!search.trim()) return true;
      const s = search.trim().toLowerCase();
      const ref = pickRef(e.payload)?.toLowerCase() ?? "";
      const amt = String(pickAmount(e.payload) ?? "");
      const payer = pickPayer(e.payload)?.toLowerCase() ?? "";
      return ref.includes(s) || amt.includes(s) || payer.includes(s);
    };
    return events.filter((e) => {
      if (!bySearch(e)) return false;
      switch (filter) {
        case "all":
          return true;
        case "attention":
          return ["pending", "pdv_pending", "underpaid", "overpaid"].includes(e.match_status);
        case "no_reference":
          return e.match_status === "pending" && !pickRef(e.payload);
        case "divergent":
          return ["underpaid", "overpaid"].includes(e.match_status);
        case "duplicate":
          return e.match_status === "duplicate";
        case "matched":
          return ["auto_matched", "manual_matched", "pdv_matched"].includes(e.match_status);
        case "ignored":
          return e.match_status === "ignored";
        default:
          return true;
      }
    });
  }, [events, filter, search]);

  const counts = useMemo(() => {
    return {
      attention: events.filter((e) =>
        ["pending", "pdv_pending", "underpaid", "overpaid"].includes(e.match_status),
      ).length,
      no_reference: events.filter(
        (e) => e.match_status === "pending" && !pickRef(e.payload),
      ).length,
      divergent: events.filter((e) =>
        ["underpaid", "overpaid"].includes(e.match_status),
      ).length,
      duplicate: events.filter((e) => e.match_status === "duplicate").length,
    };
  }, [events]);

  const ignoreMut = useMutation({
    mutationFn: (eventId: string) => ignore({ data: { eventId } }),
    onSuccess: () => {
      toast.success("Evento ignorado");
      q.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const dupMut = useMutation({
    mutationFn: (eventId: string) => markDup({ data: { eventId } }),
    onSuccess: () => {
      toast.success("Marcado como duplicado");
      q.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  useEffect(() => {
    setPage(1);
  }, [filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-admin-surface border border-admin-border flex items-center justify-center">
            <ShieldAlert className="h-5 w-5 text-admin-accent" />
          </div>
          <div>
            <h2 className="font-display text-2xl">Conciliações Wise</h2>
            <p className="text-sm text-admin-ink-muted">
              Pagamentos Wise sem match automático. Vincule manualmente a pedidos da
              esteira ou comandas PDV em aberto.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          Atualizar
        </Button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Precisam atenção" value={counts.attention} tone="amber" />
        <SummaryCard label="Sem referência" value={counts.no_reference} tone="amber" />
        <SummaryCard label="Valor divergente" value={counts.divergent} tone="orange" />
        <SummaryCard label="Duplicados" value={counts.duplicate} tone="rose" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-md bg-admin-surface-muted/40 p-1 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded px-3 py-1.5 ${
                filter === f.key
                  ? "bg-admin-surface text-admin-ink shadow-sm"
                  : "text-admin-ink-muted hover:text-admin-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-admin-ink-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por referência, valor ou pagador"
            className="pl-8 w-72"
          />
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-admin-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-admin-border p-10 text-center text-admin-ink-muted">
          Nenhum evento neste filtro.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-admin-border bg-admin-surface">
          <table className="w-full text-sm">
            <thead className="bg-admin-surface-muted/40 text-admin-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Data</th>
                <th className="px-3 py-2 text-left font-medium">Valor</th>
                <th className="px-3 py-2 text-left font-medium">Referência</th>
                <th className="px-3 py-2 text-left font-medium">Pagador</th>
                <th className="px-3 py-2 text-left font-medium">Motivo</th>
                <th className="px-3 py-2 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((e) => {
                const ref = pickRef(e.payload);
                const amount = pickAmount(e.payload);
                const currency = pickCurrency(e.payload);
                const payer = pickPayer(e.payload);
                const reason = reasonFor(e);
                const canTreat = [
                  "pending",
                  "pdv_pending",
                  "underpaid",
                  "overpaid",
                ].includes(e.match_status);
                return (
                  <tr key={e.id} className="border-t border-admin-border">
                    <td className="px-3 py-2 text-admin-ink-muted">
                      {new Date(e.created_at).toLocaleString("pt-PT")}
                    </td>
                    <td className="px-3 py-2">{fmtAmount(amount, currency)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {ref ?? <span className="text-admin-ink-muted italic">sem ref</span>}
                    </td>
                    <td className="px-3 py-2">{payer ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge className={reason.tone}>{reason.label}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setOpenRow(e)}>
                          <Eye className="h-4 w-4 mr-1" /> Detalhes
                        </Button>
                        {canTreat && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => dupMut.mutate(e.id)}
                              title="Marcar duplicado"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => ignoreMut.mutate(e.id)}
                              title="Ignorar"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-border px-3 py-2 text-xs text-admin-ink-muted">
            <span>
              Mostrando {filtered.length === 0 ? 0 : pageStart + 1}–
              {Math.min(pageStart + PAGE_SIZE, filtered.length)} de {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <span>
                Página {safePage} de {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Próxima
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConciliacaoDrawer
        row={openRow}
        onClose={() => setOpenRow(null)}
        onDone={() => {
          setOpenRow(null);
          q.refetch();
        }}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "orange" | "rose";
}) {
  const toneCls =
    tone === "amber"
      ? "text-amber-700"
      : tone === "orange"
        ? "text-orange-700"
        : "text-rose-700";
  return (
    <div className="rounded-lg border border-admin-border bg-admin-surface p-4">
      <div className="text-xs uppercase tracking-wide text-admin-ink-muted">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneCls}`}>{value}</div>
    </div>
  );
}

function ConciliacaoDrawer({
  row,
  onClose,
  onDone,
}: {
  row: WiseEventRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const listTargets = useServerFn(listOpenPaymentTargets);
  const matchOrder = useServerFn(manuallyMatchWiseEvent);
  const matchPdv = useServerFn(manuallyMatchWisePdvAttempt);

  const [kind, setKind] = useState<"orders" | "pdv">("orders");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<
    | { type: "order"; id: string; label: string; amountCents: number | null; currency: string | null }
    | { type: "pdv"; id: string; label: string; amountCents: number | null; currency: string | null }
    | null
  >(null);
  const [notes, setNotes] = useState("");

  const targets = useQuery({
    queryKey: ["wise-targets", kind, search, row?.id ?? ""],
    enabled: !!row,
    queryFn: () => listTargets({ data: { kind, search: search.trim() || undefined, limit: 40 } }),
  });

  const matchOrderMut = useMutation({
    mutationFn: () =>
      matchOrder({
        data: {
          eventId: row!.id,
          orderId: (confirm as { type: "order"; id: string }).id,
          approve: true,
          notes: notes || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Pedido vinculado e aprovado");
      setConfirm(null);
      setNotes("");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const matchPdvMut = useMutation({
    mutationFn: () =>
      matchPdv({
        data: {
          eventId: row!.id,
          attemptId: (confirm as { type: "pdv"; id: string }).id,
          notes: notes || undefined,
        },
      }),
    onSuccess: (res: { duplicate?: boolean }) => {
      toast.success(res?.duplicate ? "Marcado como duplicado" : "Comanda PDV conciliada");
      setConfirm(null);
      setNotes("");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  if (!row) return null;

  const ref = pickRef(row.payload);
  const amount = pickAmount(row.payload);
  const currency = pickCurrency(row.payload);
  const payer = pickPayer(row.payload);
  const amountCents = amount != null ? Math.round(amount * 100) : null;

  const orders = (targets.data?.orders ?? []) as OrderTarget[];
  const pdv = (targets.data?.pdvAttempts ?? []) as PdvTarget[];

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Conciliar evento Wise</SheetTitle>
          <SheetDescription>
            Vincule este recebimento a um pedido da esteira ou comanda PDV em aberto.
          </SheetDescription>
        </SheetHeader>

        <div className="grid md:grid-cols-2 gap-5 mt-4">
          <section className="space-y-3 rounded-lg border border-admin-border bg-admin-surface-muted/30 p-4">
            <h3 className="font-medium text-admin-ink">Recebimento Wise</h3>
            <dl className="text-sm space-y-1">
              <Field label="Data" value={new Date(row.created_at).toLocaleString("pt-PT")} />
              <Field label="Valor" value={fmtAmount(amount, currency)} />
              <Field label="Moeda" value={currency ?? "—"} />
              <Field
                label="Referência"
                value={ref ?? <span className="italic text-admin-ink-muted">sem ref</span>}
              />
              <Field label="Pagador" value={payer ?? "—"} />
              <Field label="Status" value={reasonFor(row).label} />
            </dl>
            <details className="text-xs">
              <summary className="cursor-pointer text-admin-ink-muted">Payload bruto</summary>
              <pre className="mt-2 max-h-60 overflow-auto rounded bg-admin-bg p-2 text-[11px]">
                {JSON.stringify(row.payload, null, 2)}
              </pre>
            </details>
          </section>

          <section className="space-y-3">
            <Tabs value={kind} onValueChange={(v) => setKind(v as "orders" | "pdv")}>
              <TabsList className="w-full">
                <TabsTrigger value="orders" className="flex-1">
                  Pedidos da esteira
                </TabsTrigger>
                <TabsTrigger value="pdv" className="flex-1">
                  Comandas PDV
                </TabsTrigger>
              </TabsList>

              <div className="relative mt-3">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-admin-ink-muted" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por referência, nome, e-mail ou valor"
                  className="pl-8"
                />
              </div>

              <TabsContent value="orders" className="mt-3 space-y-2">
                {targets.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : orders.length === 0 ? (
                  <EmptyHint text="Nenhum pedido em aberto encontrado." />
                ) : (
                  orders.map((o) => {
                    const oAmount = o.payment_amount_cents ?? o.amount_cents;
                    const oCurr = o.payment_currency ?? o.currency ?? "EUR";
                    const matchLevel = matchScore(amountCents, currency, oAmount, oCurr);
                    return (
                      <TargetCard
                        key={o.id}
                        title={o.external_reference ?? o.service_title ?? o.id.slice(0, 8)}
                        subtitle={`${o.customer_name ?? o.customer_email ?? "—"} · ${o.service_title ?? ""}`}
                        amount={fmtMoney(oAmount, oCurr)}
                        status={o.payment_status}
                        matchLevel={matchLevel}
                        onClick={() =>
                          setConfirm({
                            type: "order",
                            id: o.id,
                            label: o.external_reference ?? o.id.slice(0, 8),
                            amountCents: oAmount,
                            currency: oCurr,
                          })
                        }
                      />
                    );
                  })
                )}
              </TabsContent>

              <TabsContent value="pdv" className="mt-3 space-y-2">
                {targets.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : pdv.length === 0 ? (
                  <EmptyHint text="Nenhuma comanda PDV aguardando Wise." />
                ) : (
                  pdv.map((p) => {
                    const matchLevel = matchScore(amountCents, currency, p.amount_eur_cents, "EUR");
                    return (
                      <TargetCard
                        key={p.id}
                        title={p.reference}
                        subtitle={`${p.customer_name_snapshot ?? "—"} · ${p.customer_phone_snapshot ?? ""}`}
                        amount={fmtMoney(p.amount_eur_cents, "EUR")}
                        status={p.status}
                        matchLevel={matchLevel}
                        onClick={() =>
                          setConfirm({
                            type: "pdv",
                            id: p.id,
                            label: p.reference,
                            amountCents: p.amount_eur_cents,
                            currency: "EUR",
                          })
                        }
                      />
                    );
                  })
                )}
              </TabsContent>
            </Tabs>
          </section>
        </div>

        <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" /> Confirmar conciliação
              </DialogTitle>
            </DialogHeader>
            {confirm && (
              <div className="space-y-3 text-sm">
                <p>
                  Você está vinculando este recebimento Wise (
                  <strong>{fmtAmount(amount, currency)}</strong>) a{" "}
                  <strong>{confirm.label}</strong> (
                  {fmtMoney(confirm.amountCents, confirm.currency)}).
                </p>
                <p className="text-admin-ink-muted">
                  Essa ação marcará o destino como pago, registrará financeiro e encerrará a
                  pendência. Se o destino já estiver pago, o evento será marcado como
                  duplicado.
                </p>
                <div>
                  <Label htmlFor="notes">Notas (opcional)</Label>
                  <Input
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Motivo / observação para o log de auditoria"
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(null)}>
                Cancelar
              </Button>
              <Button
                disabled={matchOrderMut.isPending || matchPdvMut.isPending}
                onClick={() =>
                  confirm?.type === "order" ? matchOrderMut.mutate() : matchPdvMut.mutate()
                }
              >
                {matchOrderMut.isPending || matchPdvMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Vincular e aprovar"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-admin-ink-muted">{label}</dt>
      <dd className="text-admin-ink font-medium text-right">{value}</dd>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-admin-border p-4 text-center text-xs text-admin-ink-muted">
      {text}
    </div>
  );
}

function matchScore(
  eventAmountCents: number | null,
  eventCurrency: string | null,
  targetAmountCents: number | null,
  targetCurrency: string | null,
): "perfect" | "likely" | "divergent" {
  if (eventAmountCents == null || targetAmountCents == null) return "likely";
  const sameCurr =
    !eventCurrency ||
    !targetCurrency ||
    eventCurrency.toUpperCase() === targetCurrency.toUpperCase();
  if (sameCurr && eventAmountCents === targetAmountCents) return "perfect";
  if (sameCurr && Math.abs(eventAmountCents - targetAmountCents) <= 100) return "likely";
  return "divergent";
}

function TargetCard({
  title,
  subtitle,
  amount,
  status,
  matchLevel,
  onClick,
}: {
  title: string;
  subtitle: string;
  amount: string;
  status: string;
  matchLevel: "perfect" | "likely" | "divergent";
  onClick: () => void;
}) {
  const tone =
    matchLevel === "perfect"
      ? "bg-emerald-100 text-emerald-800"
      : matchLevel === "likely"
        ? "bg-amber-100 text-amber-800"
        : "bg-rose-100 text-rose-800";
  const label =
    matchLevel === "perfect" ? "Match perfeito" : matchLevel === "likely" ? "Provável" : "Divergente";
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-admin-border bg-admin-surface px-3 py-2">
      <div className="min-w-0">
        <div className="font-mono text-xs text-admin-ink">{title}</div>
        <div className="truncate text-xs text-admin-ink-muted">{subtitle}</div>
        <div className="text-xs text-admin-ink-muted">
          {amount} · {status}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Badge className={tone}>{label}</Badge>
        <Button size="sm" onClick={onClick}>
          Vincular
        </Button>
      </div>
    </div>
  );
}
