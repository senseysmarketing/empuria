import { useEffect, useState, useMemo, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { summarizePendingPayments } from "@/lib/admin/esteira-pending";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listOrders,
  updateOrder,
  markOrderPaidManual,
  deleteOrder,
  reverseOrderPayment,
} from "@/lib/admin/esteira.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  Plus,
  RotateCcw,
  Trash2,
  ShoppingCart,
  Clock,
  Loader2,
  WalletCards,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { toast } from "sonner";

import { NewOrderWizard } from "@/components/admin/esteira/NewOrderWizard";
import { getEurBrlReferenceRate } from "@/lib/finance/fx.functions";

export const Route = createFileRoute("/_authenticated/admin/esteira")({
  component: EsteiraPage,
});

const formatMoney = (cents: number | null | undefined, currency = "EUR") =>
  new Intl.NumberFormat(currency === "EUR" ? "pt-PT" : "pt-BR", {
    style: "currency",
    currency,
  }).format((cents ?? 0) / 100);

const STATUS_COLOR: Record<string, string> = {
  pendente: "bg-amber-100 text-amber-900",
  aprovado: "bg-emerald-100 text-emerald-900",
};

const isCourtesy = (order: Order) => (order.payment_amount_cents ?? order.amount_cents ?? 0) === 0;

function paymentLabel(order: Order) {
  if (isCourtesy(order)) return "Cortesia";
  if (order.payment_status === "aprovado") return "Recebido";
  return "Pendente";
}

const clipped = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

const DELIVERY_COLOR: Record<string, string> = {
  aguardando_pagamento: "bg-amber-50 text-amber-800",
  aguardando_documentos: "bg-blue-50 text-blue-800",
  processando: "bg-indigo-50 text-indigo-800",
  agendado: "bg-purple-50 text-purple-800",
  concluido: "bg-emerald-50 text-emerald-800",
};

const PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Todos pagamentos" },
  { value: "pendente", label: "Pendente" },
  { value: "aprovado", label: "Recebido" },
  { value: "courtesy", label: "Cortesia" },
];

const DELIVERY_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Todas execuções" },
  { value: "aguardando_pagamento", label: "Aguardando pagamento" },
  { value: "aguardando_documentos", label: "Aguardando documentos" },
  { value: "processando", label: "Processando" },
  { value: "agendado", label: "Agendado" },
  { value: "concluido", label: "Concluído" },
];

type Order = {
  id: string;
  user_id?: string | null;
  customer_name: string;
  customer_email: string | null;
  service_title: string;
  payment_status: "pendente" | "aprovado" | "recusado" | "estornado";
  delivery_status?:
    | "aguardando_pagamento"
    | "aguardando_documentos"
    | "processando"
    | "agendado"
    | "concluido";
  created_at: string;
  executed_at: string | null;
  amount_cents?: number;
  currency?: string;
  payment_amount_cents?: number | null;
  payment_currency?: string | null;
  settled_amount_cents?: number | null;
  settled_currency?: string | null;
  payment_account_id?: string | null;
  paid_at?: string | null;
  fx_reference_rate?: number | null;
  fx_reference_date?: string | null;
  fx_rate?: number | null;
  fx_source?: string | null;
  payment_method?: string | null;
  payment_provider_payment_id?: string | null;
  notes?: string | null;
};

function EsteiraPage() {
  const fetchOrders = useServerFn(listOrders);
  const update = useServerFn(updateOrder);
  const markManual = useServerFn(markOrderPaidManual);
  const remove = useServerFn(deleteOrder);
  const reverse = useServerFn(reverseOrderPayment);
  const fetchFx = useServerFn(getEurBrlReferenceRate);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [deliveryFilter, setDeliveryFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [actionPrompt, setActionPrompt] = useState<{
    kind: "manual" | "delete" | "reverse";
    order: Order;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const actionBusyRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [reasonInput, setReasonInput] = useState("");
  const [settledAmount, setSettledAmount] = useState("");
  const [settledCurrency, setSettledCurrency] = useState<"BRL" | "EUR">("EUR");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [settlementFxReferenceRate, setSettlementFxReferenceRate] = useState<number | null>(null);
  const [settlementFxReferenceDate, setSettlementFxReferenceDate] = useState<string | null>(null);
  const [settlementFxRate, setSettlementFxRate] = useState("");
  const [settlementFxSource, setSettlementFxSource] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => fetchOrders() as unknown as Promise<Order[]>,
  });
  const settlementOrder = actionPrompt?.kind === "manual" ? actionPrompt.order : null;
  const settlementBaseCurrency = (settlementOrder?.payment_currency ??
    settlementOrder?.currency ??
    "EUR") as "BRL" | "EUR";
  const settlementBaseAmountCents =
    settlementOrder?.payment_amount_cents ?? settlementOrder?.amount_cents ?? 0;
  const settlementConversion = !!settlementOrder && settlementBaseCurrency !== settledCurrency;
  const settlementFxQ = useQuery({
    queryKey: [
      "order-settlement-eur-brl-reference",
      settlementOrder?.id,
      paidAt,
      settlementBaseCurrency,
      settledCurrency,
    ],
    queryFn: () => fetchFx({ data: { date: paidAt } }),
    enabled: settlementConversion,
    staleTime: 30 * 60 * 1000,
  });

  useEffect(() => {
    if (!settlementConversion) {
      setSettlementFxReferenceRate(null);
      setSettlementFxReferenceDate(null);
      setSettlementFxRate("");
      setSettlementFxSource(null);
      if (settlementOrder) setSettledAmount((settlementBaseAmountCents / 100).toFixed(2));
      return;
    }
    if (settlementFxQ.data?.ok) {
      setSettlementFxReferenceRate(settlementFxQ.data.rate);
      setSettlementFxReferenceDate(settlementFxQ.data.date);
      setSettlementFxRate(String(settlementFxQ.data.rate));
      setSettlementFxSource(settlementFxQ.data.source);
    } else if (settlementFxQ.data && !settlementFxQ.data.ok) {
      setSettlementFxReferenceRate(null);
      setSettlementFxReferenceDate(null);
      setSettlementFxSource("MANUAL");
    }
  }, [settlementBaseAmountCents, settlementConversion, settlementFxQ.data, settlementOrder]);

  useEffect(() => {
    const rate = Number(settlementFxRate);
    if (!settlementConversion || !rate) return;
    const baseAmount = settlementBaseAmountCents / 100;
    const converted = settlementBaseCurrency === "EUR" ? baseAmount * rate : baseAmount / rate;
    setSettledAmount(converted.toFixed(2));
  }, [settlementBaseAmountCents, settlementBaseCurrency, settlementConversion, settlementFxRate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (paymentFilter === "courtesy" && !isCourtesy(o)) return false;
      if (
        paymentFilter !== "all" &&
        paymentFilter !== "courtesy" &&
        (o.payment_status !== paymentFilter || isCourtesy(o))
      )
        return false;
      if (deliveryFilter !== "all" && o.delivery_status !== deliveryFilter) return false;
      if (q) {
        const hay = `${o.customer_name} ${o.customer_email ?? ""} ${o.service_title}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, search, paymentFilter, deliveryFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  const resetFilters = () => {
    setSearch("");
    setPaymentFilter("all");
    setDeliveryFilter("all");
    setPage(1);
  };

  const onFilterChange =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };

  const refresh = async () => {
    await Promise.all(
      [
        "orders",
        "finance-transactions",
        "finance-dashboard",
        "member-dossier",
        "reports-historico",
        "reports-overview",
        "reports-vendas",
        "reports-servicos",
      ].map((key) => qc.invalidateQueries({ queryKey: [key], refetchType: "active" })),
    );
  };

  // Summary tiles
  const summary = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isToday = (value: string) => {
      const time = new Date(value).getTime();
      return time >= today.getTime() && time < tomorrow.getTime();
    };
    const todayCount = orders.filter((o) => isToday(o.created_at)).length;
    const pending = summarizePendingPayments(orders);
    const waiting = pending.count;
    const paidToday = orders.filter(
      (o) => o.payment_status === "aprovado" && !!o.paid_at && isToday(o.paid_at),
    ).length;
    const inExec = orders.filter((o) => o.delivery_status === "processando").length;
    let eur = 0;
    let brl = 0;
    for (const o of orders) {
      if (o.payment_status !== "aprovado") continue;
      const amount = o.settled_amount_cents ?? o.payment_amount_cents ?? o.amount_cents ?? 0;
      const currency = o.settled_currency ?? o.payment_currency ?? o.currency;
      if (currency === "BRL") brl += amount;
      if (currency === "EUR") eur += amount;
    }
    return {
      todayCount,
      waiting,
      paidToday,
      inExec,
      eur,
      brl,
      pendingEur: pending.EUR,
      pendingBrl: pending.BRL,
    };
  }, [orders]);

  const markExecuted = async (id: string) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await update({ data: { id, executed: true } });
      toast.success("Marcado como executado");
      setSelected(null);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao marcar execução");
    } finally {
      setActionBusy(false);
    }
  };

  const runPrompt = async () => {
    if (!actionPrompt || actionBusyRef.current || actionSuccess) return;
    if (actionPrompt.kind === "reverse" && reasonInput.trim().length < 3) {
      setActionError("Motivo do estorno obrigatório (mín. 3 caracteres).");
      return;
    }
    if (
      actionPrompt.kind === "manual" &&
      (!paidAt ||
        !(Number(settledAmount) > 0) ||
        (settlementConversion && !(Number(settlementFxRate) > 0)))
    ) {
      setActionError("Informe data, valor e cotação válida quando houver conversão.");
      return;
    }
    actionBusyRef.current = true;
    setActionError(null);
    setActionBusy(true);
    try {
      const { kind, order } = actionPrompt;
      if (kind === "manual")
        await markManual({
          data: {
            id: order.id,
            reason: reasonInput || undefined,
            settledAmountCents: Math.round(Number(settledAmount) * 100),
            settledCurrency,
            paidAt,
            fxReferenceRate: settlementConversion ? settlementFxReferenceRate : undefined,
            fxReferenceDate: settlementConversion ? settlementFxReferenceDate : undefined,
            fxRate: settlementConversion && settlementFxRate ? Number(settlementFxRate) : undefined,
            fxSource: settlementConversion ? (settlementFxSource ?? "MANUAL") : undefined,
          },
        });
      if (kind === "delete")
        await remove({ data: { id: order.id, reason: reasonInput || undefined } });
      if (kind === "reverse") await reverse({ data: { id: order.id, reason: reasonInput } });
      const success =
        kind === "manual"
          ? "Baixa confirmada"
          : kind === "reverse"
            ? "Baixa estornada"
            : "Pedido excluído";
      setActionSuccess(success);
      toast.success(success);
      setReasonInput("");
      try {
        await refresh();
      } catch {
        setActionError(
          "A ação foi concluída, mas a atualização automática falhou. Recarregue a página.",
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Não foi possível concluir a ação.";
      setActionError(message);
      toast.error(message);
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Central de Pedidos</h1>
          <p className="text-admin-ink-muted text-sm mt-1">
            Pedidos do site, vendas no WhatsApp, consultorias e compromissos comerciais.
          </p>
        </div>
        <Button
          className="bg-admin-accent hover:bg-admin-accent/90 gap-2"
          onClick={() => setWizardOpen(true)}
        >
          <Plus className="h-4 w-4" /> Criar pedido
        </Button>
      </header>

      {summary.waiting > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 border-red-600 bg-red-50 p-5 text-red-950"
        >
          <div>
            <p className="font-display text-lg font-bold">
              ⚠ {summary.waiting} pedido(s) aguardando definição de pagamento
            </p>
            <p className="text-sm">
              Dê baixa nos pedidos pagos ou exclua os que não serão concluídos.
            </p>
            <p className="mt-1 text-sm font-semibold">
              BRL pendente: {formatMoney(summary.pendingBrl, "BRL")} · EUR pendente:{" "}
              {formatMoney(summary.pendingEur, "EUR")}
            </p>
          </div>
          <Button
            variant="destructive"
            onClick={() => {
              setPaymentFilter("pendente");
              setPage(1);
            }}
          >
            Ver pendentes
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <AdminStatCard
          label="Pedidos hoje"
          value={summary.todayCount}
          icon={ShoppingCart}
          tone="blue"
        />
        <AdminStatCard
          label="Aguardando pagamento"
          value={summary.waiting}
          icon={Clock}
          tone="amber"
        />
        <AdminStatCard
          label="Pagos hoje"
          value={summary.paidToday}
          icon={CheckCircle2}
          tone="green"
        />
        <AdminStatCard label="Em execução" value={summary.inExec} icon={Loader2} tone="blue" />
        <AdminStatCard
          label="Receita BRL"
          value={formatMoney(summary.brl, "BRL")}
          icon={WalletCards}
          tone="green"
        />
        <AdminStatCard
          label="Receita EUR"
          value={formatMoney(summary.eur, "EUR")}
          icon={WalletCards}
          tone="green"
        />
      </div>

      <BentoCard padded={false}>
        <div className="p-5 border-b border-admin-border space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-display text-lg text-admin-ink">Pedidos</h3>
              <p className="text-xs text-admin-ink-muted mt-1">
                {orders.length} pedidos cadastrados
              </p>
            </div>
            <span className="text-xs text-admin-ink-muted tabular-nums mt-1">
              {filtered.length} de {orders.length} {orders.length === 1 ? "pedido" : "pedidos"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-admin-ink-muted" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar por cliente, e-mail ou serviço…"
                className="pl-8 bg-admin-bg border-admin-border h-9"
              />
            </div>
            <Select value={paymentFilter} onValueChange={onFilterChange(setPaymentFilter)}>
              <SelectTrigger className="w-[180px] h-9 bg-admin-bg border-admin-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={deliveryFilter} onValueChange={onFilterChange(setDeliveryFilter)}>
              <SelectTrigger className="w-[200px] h-9 bg-admin-bg border-admin-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIVERY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-admin-ink-muted text-sm">Carregando…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-admin-ink-muted">
                <tr className="border-b border-admin-border">
                  <th className="py-3 pl-3 pr-3">Cliente</th>
                  <th className="py-3 pr-3">Serviço</th>
                  <th className="py-3 pr-3 text-right">Valor</th>
                  <th className="py-3 pr-3">Pagamento</th>
                  <th className="py-3 pr-3">Execução</th>
                  <th className="py-3 pr-3">Data</th>
                  <th className="py-3 pl-3 pr-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-admin-border last:border-0 hover:bg-admin-bg/50 cursor-pointer"
                    onClick={() => setSelected(o)}
                  >
                    <td className="max-w-[230px] py-3 pl-3 pr-3">
                      <div
                        className="text-admin-ink flex min-w-0 items-center gap-2 whitespace-nowrap"
                        title={o.customer_name}
                      >
                        <span className="truncate font-medium">{clipped(o.customer_name, 28)}</span>
                        {!o.user_id && (
                          <span className="text-[9px] uppercase bg-amber-100 text-amber-800 px-1.5 rounded">
                            sem conta
                          </span>
                        )}
                      </div>
                      {o.customer_email && (
                        <div
                          className="truncate whitespace-nowrap text-xs text-admin-ink-muted"
                          title={o.customer_email}
                        >
                          {clipped(o.customer_email, 32)}
                        </div>
                      )}
                    </td>
                    <td
                      className="max-w-[260px] py-3 pr-3 text-admin-ink-soft"
                      title={o.service_title}
                    >
                      <span className="block truncate whitespace-nowrap">
                        {clipped(o.service_title, 40)}
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">
                      <div>{formatMoney(o.amount_cents, o.currency)}</div>
                      {o.settled_amount_cents != null && (
                        <div className="text-xs text-admin-ink-muted">
                          Recebido:{" "}
                          {formatMoney(
                            o.settled_amount_cents,
                            o.settled_currency ?? o.payment_currency ?? o.currency,
                          )}
                          {o.fx_rate ? ` · EUR → BRL · ${Number(o.fx_rate).toFixed(4)}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-3" onClick={(e) => e.stopPropagation()}>
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs whitespace-nowrap ${
                          isCourtesy(o)
                            ? "bg-slate-100 text-slate-700"
                            : STATUS_COLOR[o.payment_status]
                        }`}
                      >
                        {paymentLabel(o)}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      {o.delivery_status && (
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-[10px] whitespace-nowrap ${
                            DELIVERY_COLOR[o.delivery_status] ?? "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {o.delivery_status.replace(/_/g, " ")}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-xs text-admin-ink-muted whitespace-nowrap">
                      {new Date(o.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="py-3 pl-3 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-2 whitespace-nowrap">
                        {o.payment_status === "pendente" &&
                          !isCourtesy(o) &&
                          !o.payment_provider_payment_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionBusy}
                              className="whitespace-nowrap"
                              onClick={() => {
                                setActionPrompt({ kind: "manual", order: o });
                                setActionError(null);
                                setActionSuccess(null);
                                setReasonInput("");
                                setSettledCurrency(
                                  (o.payment_currency ?? o.currency ?? "EUR") as "BRL" | "EUR",
                                );
                                setSettledAmount(
                                  String((o.payment_amount_cents ?? o.amount_cents ?? 0) / 100),
                                );
                                setPaidAt(new Date().toISOString().slice(0, 10));
                                setSettlementFxReferenceRate(o.fx_reference_rate ?? null);
                                setSettlementFxReferenceDate(o.fx_reference_date ?? null);
                                setSettlementFxRate(o.fx_rate ? String(o.fx_rate) : "");
                                setSettlementFxSource(o.fx_source ?? null);
                              }}
                            >
                              <CheckCircle2 className="mr-1 h-4 w-4" />
                              Dar baixa
                            </Button>
                          )}
                        {o.payment_status === "aprovado" &&
                          !isCourtesy(o) &&
                          !o.payment_provider_payment_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionBusy}
                              className="whitespace-nowrap"
                              onClick={() => {
                                setActionPrompt({ kind: "reverse", order: o });
                                setActionError(null);
                                setActionSuccess(null);
                                setReasonInput("");
                              }}
                            >
                              <RotateCcw className="mr-1 h-4 w-4" />
                              Estornar baixa
                            </Button>
                          )}
                        {!o.payment_provider_payment_id &&
                          !o.executed_at &&
                          o.delivery_status !== "concluido" &&
                          (o.payment_status === "pendente" ||
                            (o.payment_status === "aprovado" && isCourtesy(o))) && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionBusy}
                              className="whitespace-nowrap"
                              onClick={() => {
                                setActionPrompt({ kind: "delete", order: o });
                                setActionError(null);
                                setActionSuccess(null);
                                setReasonInput("");
                              }}
                            >
                              <Trash2 className="mr-1 h-4 w-4" />
                              Excluir
                            </Button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-admin-ink-muted text-sm">
                      {orders.length === 0 ? (
                        "Nenhum pedido ainda"
                      ) : (
                        <>
                          Nenhum pedido corresponde aos filtros.{" "}
                          <button onClick={resetFilters} className="text-admin-accent underline">
                            Limpar filtros
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {filtered.length > 0 && (
              <div className="flex items-center justify-between gap-3 p-3 border-t border-admin-border flex-wrap">
                <div className="flex items-center gap-2 text-xs text-admin-ink-muted">
                  <span>Por página:</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(parseInt(v, 10));
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[80px] bg-admin-bg border-admin-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 text-xs text-admin-ink-muted">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-8"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                  </Button>
                  <span className="tabular-nums">
                    Página {safePage} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="h-8"
                  >
                    Próximo <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </BentoCard>

      <NewOrderWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={refresh} />

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pedido · {selected?.service_title}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <Row label="Cliente" value={selected.customer_name} />
              <Row label="E-mail" value={selected.customer_email ?? "—"} />
              <Row
                label="Conta vinculada"
                value={selected.user_id ? "sim" : "não — pedido não aparece no portal"}
              />
              <Row
                label="Valor comercial"
                value={formatMoney(selected.amount_cents, selected.currency)}
              />
              <Row
                label="Cobrança prevista"
                value={formatMoney(
                  selected.payment_amount_cents,
                  selected.payment_currency ?? selected.currency,
                )}
              />
              {selected.settled_amount_cents != null && (
                <Row
                  label="Recebido"
                  value={formatMoney(
                    selected.settled_amount_cents,
                    selected.settled_currency ?? selected.payment_currency ?? selected.currency,
                  )}
                />
              )}
              {selected.fx_reference_rate && (
                <Row
                  label="PTAX referência"
                  value={Number(selected.fx_reference_rate).toFixed(4)}
                />
              )}
              {selected.fx_rate && (
                <Row label="Cotação aplicada" value={Number(selected.fx_rate).toFixed(4)} />
              )}
              <Row label="Método" value={selected.payment_method ?? "—"} />
              <Row label="Pagamento" value={paymentLabel(selected)} />
              <Row label="Execução" value={selected.delivery_status ?? "—"} />
              {selected.notes && <Row label="Notas" value={selected.notes} />}
              {!selected.executed_at && selected.payment_status === "aprovado" && (
                <Button
                  variant="outline"
                  disabled={actionBusy}
                  onClick={() => markExecuted(selected.id)}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Marcar executado
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!actionPrompt}
        onOpenChange={(o) => !o && !actionBusy && setActionPrompt(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionPrompt?.kind === "manual"
                ? "Dar baixa"
                : actionPrompt?.kind === "delete"
                  ? "Excluir pedido"
                  : "Estornar baixa"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {actionError && (
              <p
                role="alert"
                className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
              >
                {actionError}
              </p>
            )}
            {actionSuccess && (
              <p
                role="status"
                className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"
              >
                {actionSuccess}. A tabela e o Financeiro foram atualizados.
              </p>
            )}
            {actionPrompt?.kind === "manual" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Data</Label>
                    <Input
                      type="date"
                      value={paidAt}
                      onChange={(event) => setPaidAt(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Valor realizado</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={settledAmount}
                      onChange={(event) => setSettledAmount(event.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label>Moeda</Label>
                  <Select
                    value={settledCurrency}
                    onValueChange={(value) => {
                      setSettledCurrency(value as "BRL" | "EUR");
                      setSettlementFxReferenceRate(null);
                      setSettlementFxReferenceDate(null);
                      setSettlementFxRate("");
                      setSettlementFxSource(value === settlementBaseCurrency ? null : "MANUAL");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BRL">BRL</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {settlementConversion && (
                  <div className="space-y-2 rounded-lg bg-muted p-3 text-sm">
                    <div>
                      Valor de referência:{" "}
                      {formatMoney(settlementBaseAmountCents, settlementBaseCurrency)}
                    </div>
                    <div>
                      <Label>PTAX EUR/BRL</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {settlementFxQ.isFetching
                          ? "Buscando referência…"
                          : settlementFxReferenceRate
                            ? `${settlementFxReferenceRate.toFixed(4)} em ${settlementFxReferenceDate}`
                            : "Referência indisponível — informe a cotação manualmente."}
                      </p>
                    </div>
                    <div>
                      <Label>Cotação aplicada</Label>
                      <Input
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={settlementFxRate}
                        onChange={(event) => {
                          setSettlementFxRate(event.target.value);
                          if (!settlementFxReferenceRate) setSettlementFxSource("MANUAL");
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
            <p className="text-sm text-muted-foreground">
              {actionPrompt?.kind === "delete"
                ? "O pedido sairá da operação e das pendências, mas seu histórico e documentos serão preservados. Pedidos recebidos exigem estorno antes da exclusão."
                : actionPrompt?.kind === "reverse"
                  ? "Informe o motivo obrigatório do estorno. O pedido voltará a pendente."
                  : "Observação opcional da baixa."}
            </p>
            {actionPrompt?.kind !== "delete" && (
              <textarea
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                rows={3}
                className="w-full border rounded p-2 text-sm"
                placeholder={
                  actionPrompt?.kind === "reverse" ? "Motivo do estorno" : "Observação opcional"
                }
              />
            )}
            <Button
              disabled={
                actionBusy ||
                !!actionSuccess ||
                (actionPrompt?.kind === "manual" &&
                  (!settledAmount ||
                    (settlementConversion && !settlementFxRate) ||
                    settlementFxQ.isFetching)) ||
                (actionPrompt?.kind === "reverse" && reasonInput.trim().length < 3)
              }
              onClick={runPrompt}
              className="w-full bg-admin-accent hover:bg-admin-accent/90"
            >
              {actionBusy
                ? "Processando..."
                : actionPrompt?.kind === "delete"
                  ? "Confirmar exclusão"
                  : "Confirmar"}
            </Button>
            {actionSuccess && (
              <Button variant="outline" className="w-full" onClick={() => setActionPrompt(null)}>
                Concluir
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b last:border-0 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-admin-ink text-right">{value}</span>
    </div>
  );
}
