import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  listOrders,
  updateOrder,
  markOrderPaidManual,
  listPaymentAccounts,
  cancelOrder,
  refundOrder,
} from "@/lib/admin/esteira.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
  QrCode,
  MoreHorizontal,
  Link2,
  Copy,
  Ban,
  RotateCcw,
  AlertTriangle,
  ShoppingCart,
  Clock,
  Loader2,
  WalletCards,
  Search,
  ChevronLeft,
  ChevronRight,
  Landmark,
} from "lucide-react";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { toast } from "sonner";

import { NewOrderWizard } from "@/components/admin/esteira/NewOrderWizard";

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
  recusado: "bg-red-100 text-red-900",
  estornado: "bg-slate-200 text-slate-700",
};

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
  { value: "aprovado", label: "Aprovado" },
  { value: "recusado", label: "Recusado" },
  { value: "estornado", label: "Estornado" },
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
  voucher_code: string | null;
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
  payment_url?: string | null;
  payment_provider_reference?: string | null;
  notes?: string | null;
};

function EsteiraPage() {
  // Módulo Esteira já é validado pelo middleware — qualquer staff com acesso pode cancelar/estornar.
  const canAction = (_key: string) => true;

  const fetchOrders = useServerFn(listOrders);
  const update = useServerFn(updateOrder);
  const markManual = useServerFn(markOrderPaidManual);
  const cancel = useServerFn(cancelOrder);
  const refund = useServerFn(refundOrder);
  const fetchAccounts = useServerFn(listPaymentAccounts);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [deliveryFilter, setDeliveryFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [voucherUrl, setVoucherUrl] = useState<string | null>(null);
  const [voucherCode, setVoucherCode] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [actionPrompt, setActionPrompt] = useState<{
    kind: "manual" | "cancel" | "refund";
    order: Order;
  } | null>(null);
  const [reasonInput, setReasonInput] = useState("");
  const [settledAmount, setSettledAmount] = useState("");
  const [settledCurrency, setSettledCurrency] = useState<"BRL" | "EUR">("EUR");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [linkModal, setLinkModal] = useState<{
    order: Order;
    loading: boolean;
    reference: string | null;
    paymentUrl: string | null;
    error: string | null;
  } | null>(null);
  const [bankModal, setBankModal] = useState<{
    order: Order;
    loading: boolean;
    error: string | null;
    reference: string | null;
    iban: string | null;
    bic: string | null;
    beneficiaryName: string | null;
  } | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => fetchOrders() as unknown as Promise<Order[]>,
  });
  const { data: paymentAccounts = [] } = useQuery({
    queryKey: ["payment-accounts"],
    queryFn: () => fetchAccounts(),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (paymentFilter !== "all" && o.payment_status !== paymentFilter) return false;
      if (deliveryFilter !== "all" && o.delivery_status !== deliveryFilter) return false;
      if (q) {
        const hay =
          `${o.customer_name} ${o.customer_email ?? ""} ${o.service_title} ${o.voucher_code ?? ""}`.toLowerCase();
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

  const refresh = () => qc.invalidateQueries({ queryKey: ["orders"] });

  // Summary tiles
  const summary = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isToday = (value: string) => new Date(value).getTime() >= today.getTime();
    const todayCount = orders.filter((o) => isToday(o.created_at)).length;
    const waiting = orders.filter((o) => o.payment_status === "pendente").length;
    const paidToday = orders.filter(
      (o) => o.payment_status === "aprovado" && isToday(o.created_at),
    ).length;
    const inExec = orders.filter((o) => o.delivery_status === "processando").length;
    const late = orders.filter(
      (o) =>
        o.payment_status === "pendente" &&
        new Date(o.created_at).getTime() < Date.now() - 1000 * 60 * 60 * 48,
    ).length;
    let eur = 0;
    let brl = 0;
    for (const o of orders) {
      if (o.payment_status !== "aprovado") continue;
      const amount = o.settled_amount_cents ?? o.payment_amount_cents ?? o.amount_cents ?? 0;
      const currency = o.settled_currency ?? o.payment_currency ?? o.currency;
      if (currency === "BRL") brl += amount;
      if (currency === "EUR") eur += amount;
    }
    return { todayCount, waiting, paidToday, inExec, late, eur, brl };
  }, [orders]);

  const showVoucher = async (code: string) => {
    const dataUrl = await QRCode.toDataURL(code, { width: 320, margin: 2 });
    setVoucherUrl(dataUrl);
    setVoucherCode(code);
  };

  const markExecuted = async (id: string) => {
    await update({ data: { id, executed: true } });
    toast.success("Marcado como executado");
    refresh();
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  const runPrompt = async () => {
    if (!actionPrompt || reasonInput.trim().length < 3) {
      toast.error("Motivo obrigatório (mín. 3 caracteres)");
      return;
    }
    try {
      const { kind, order } = actionPrompt;
      if (kind === "manual")
        await markManual({
          data: {
            id: order.id,
            reason: reasonInput,
            settledAmountCents: Math.round(Number(settledAmount) * 100),
            settledCurrency,
            paymentAccountId,
            paidAt,
            fxReferenceRate: order.fx_reference_rate ?? null,
            fxReferenceDate: order.fx_reference_date ?? null,
            fxRate: order.fx_rate ?? null,
            fxSource: order.fx_source ?? (order.fx_rate ? "MANUAL" : null),
          },
        });
      if (kind === "cancel") await cancel({ data: { id: order.id, reason: reasonInput } });
      if (kind === "refund") await refund({ data: { id: order.id, reason: reasonInput } });
      toast.success("Ação registrada");
      setActionPrompt(null);
      setReasonInput("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
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
        <AdminStatCard label="Atrasados" value={summary.late} icon={AlertTriangle} tone="red" />
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
                placeholder="Buscar por cliente, e-mail, serviço ou voucher…"
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
            <table className="min-w-full text-sm">
              <thead className="bg-admin-bg text-[10px] uppercase tracking-wider text-admin-ink-muted">
                <tr>
                  <th className="text-left p-3 font-display">Cliente</th>
                  <th className="text-left p-3 font-display">Serviço</th>
                  <th className="text-right p-3 font-display">Valor</th>
                  <th className="text-left p-3 font-display">Pagamento</th>
                  <th className="text-left p-3 font-display">Execução</th>
                  <th className="text-left p-3 font-display">Voucher</th>
                  <th className="text-left p-3 font-display">Data</th>
                  <th className="text-right p-3 font-display">Ações</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((o) => (
                  <tr
                    key={o.id}
                    className="border-t border-admin-border hover:bg-admin-bg/50 cursor-pointer"
                    onClick={() => setSelected(o)}
                  >
                    <td className="p-3">
                      <div className="text-admin-ink flex items-center gap-2">
                        {o.customer_name}
                        {!o.user_id && (
                          <span className="text-[9px] uppercase bg-amber-100 text-amber-800 px-1.5 rounded">
                            sem conta
                          </span>
                        )}
                      </div>
                      {o.customer_email && (
                        <div className="text-xs text-admin-ink-muted">{o.customer_email}</div>
                      )}
                    </td>
                    <td className="p-3 text-admin-ink-soft">{o.service_title}</td>
                    <td className="p-3 text-right tabular-nums">
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
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs uppercase tracking-wider ${
                          STATUS_COLOR[o.payment_status]
                        }`}
                      >
                        {o.payment_status}
                      </span>
                    </td>
                    <td className="p-3">
                      {o.delivery_status && (
                        <span
                          className={`inline-block px-2 py-1 rounded text-[10px] uppercase tracking-wider ${
                            DELIVERY_COLOR[o.delivery_status] ?? "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {o.delivery_status.replace(/_/g, " ")}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {o.voucher_code ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            showVoucher(o.voucher_code!);
                          }}
                          className="text-xs font-mono text-admin-accent hover:underline inline-flex items-center gap-1"
                        >
                          <QrCode className="h-3 w-3" /> {o.voucher_code}
                        </button>
                      ) : (
                        <span className="text-xs text-admin-ink-muted">—</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-admin-ink-muted">
                      {new Date(o.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {o.payment_provider_reference && (
                            <DropdownMenuItem
                              onClick={() => {
                                navigator.clipboard.writeText(o.payment_provider_reference ?? "");
                                toast.success("Referência copiada");
                              }}
                            >
                              <Copy className="h-4 w-4 mr-2" /> Copiar referência
                            </DropdownMenuItem>
                          )}
                          {o.payment_status !== "aprovado" && (
                            <DropdownMenuItem
                              onClick={() => {
                                setActionPrompt({ kind: "manual", order: o });
                                setReasonInput("");
                                setSettledCurrency(
                                  (o.payment_currency ?? o.currency ?? "EUR") as "BRL" | "EUR",
                                );
                                setSettledAmount(
                                  String((o.payment_amount_cents ?? o.amount_cents ?? 0) / 100),
                                );
                                setPaymentAccountId(o.payment_account_id ?? "");
                                setPaidAt(new Date().toISOString().slice(0, 10));
                              }}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar pagamento
                            </DropdownMenuItem>
                          )}
                          {!o.executed_at && o.payment_status === "aprovado" && (
                            <DropdownMenuItem onClick={() => markExecuted(o.id)}>
                              <CheckCircle2 className="h-4 w-4 mr-2" /> Marcar executado
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {canAction("esteira.cancel_order") && (
                            <DropdownMenuItem
                              onClick={() => {
                                setActionPrompt({ kind: "cancel", order: o });
                                setReasonInput("");
                              }}
                            >
                              <Ban className="h-4 w-4 mr-2" /> Cancelar
                            </DropdownMenuItem>
                          )}
                          {canAction("esteira.refund_order") && (
                            <DropdownMenuItem
                              onClick={() => {
                                setActionPrompt({ kind: "refund", order: o });
                                setReasonInput("");
                              }}
                            >
                              <RotateCcw className="h-4 w-4 mr-2" /> Estornar
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-admin-ink-muted text-sm">
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

      <Dialog open={!!voucherUrl} onOpenChange={(o) => !o && setVoucherUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voucher {voucherCode}</DialogTitle>
          </DialogHeader>
          {voucherUrl && (
            <div className="flex flex-col items-center gap-3">
              <img src={voucherUrl} alt="QR Code" className="rounded-lg" />
              <a
                href={voucherUrl}
                download={`${voucherCode}.png`}
                className="text-sm text-admin-accent hover:underline"
              >
                Baixar PNG
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkModal} onOpenChange={(o) => !o && setLinkModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link de pagamento Wise</DialogTitle>
          </DialogHeader>
          {linkModal && (
            <div className="space-y-3 text-sm">
              <div className="text-xs text-muted-foreground">
                Pedido · {linkModal.order.customer_name} · {linkModal.order.service_title}
              </div>
              {linkModal.error && (
                <div className="border border-amber-300 bg-amber-50 rounded p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-700 shrink-0" />
                  <div>{linkModal.error}</div>
                </div>
              )}
              {linkModal.loading && <div className="text-muted-foreground">Preparando link...</div>}
              {linkModal.paymentUrl && (
                <div>
                  <Label>Link de pagamento</Label>
                  <div className="flex gap-2 mt-1">
                    <Input readOnly value={linkModal.paymentUrl} className="font-mono text-xs" />
                    <Button variant="outline" onClick={() => copy(linkModal.paymentUrl!, "Link")}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button asChild variant="outline">
                      <a href={linkModal.paymentUrl} target="_blank" rel="noreferrer">
                        <Link2 className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Envie ao cliente. Ele conclui o pagamento via Wise (EUR).
                  </p>
                </div>
              )}
              <div className="flex justify-end pt-2">
                <Button onClick={() => setLinkModal(null)}>Fechar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!bankModal} onOpenChange={(o) => !o && setBankModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dados para transferência bancária</DialogTitle>
          </DialogHeader>
          {bankModal && (
            <div className="space-y-3 text-sm">
              <div className="text-xs text-muted-foreground">
                Pedido · {bankModal.order.customer_name} · {bankModal.order.service_title}
              </div>
              {bankModal.loading && (
                <div className="text-muted-foreground">Preparando dados...</div>
              )}
              {bankModal.error && (
                <div className="border border-amber-300 bg-amber-50 rounded p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-700 shrink-0" />
                  <div>{bankModal.error}</div>
                </div>
              )}
              {!bankModal.loading && (bankModal.iban || bankModal.bic) && (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-2">
                  {bankModal.beneficiaryName && (
                    <BankRow
                      label="Beneficiário"
                      value={bankModal.beneficiaryName}
                      onCopy={() => copy(bankModal.beneficiaryName!, "Beneficiário")}
                    />
                  )}
                  {bankModal.iban && (
                    <BankRow
                      label="IBAN"
                      value={bankModal.iban}
                      mono
                      onCopy={() => copy(bankModal.iban!, "IBAN")}
                    />
                  )}
                  {bankModal.bic && (
                    <BankRow
                      label="BIC/SWIFT"
                      value={bankModal.bic}
                      mono
                      onCopy={() => copy(bankModal.bic!, "BIC")}
                    />
                  )}
                  <BankRow
                    label="Valor"
                    value={new Intl.NumberFormat("pt-PT", {
                      style: "currency",
                      currency:
                        bankModal.order.payment_currency ?? bankModal.order.currency ?? "EUR",
                    }).format(
                      (bankModal.order.payment_amount_cents ?? bankModal.order.amount_cents ?? 0) /
                        100,
                    )}
                    onCopy={() =>
                      copy(
                        (
                          (bankModal.order.payment_amount_cents ??
                            bankModal.order.amount_cents ??
                            0) / 100
                        ).toFixed(2),
                        "Valor",
                      )
                    }
                  />
                  {bankModal.reference && (
                    <BankRow
                      label="Referência"
                      value={bankModal.reference}
                      mono
                      onCopy={() => copy(bankModal.reference!, "Referência")}
                    />
                  )}
                  {bankModal.reference && (
                    <p className="text-[11px] text-muted-foreground pt-1">
                      Inclua a referência <strong>{bankModal.reference}</strong> na transferência
                      para conciliação automática.
                    </p>
                  )}
                </div>
              )}
              <div className="flex justify-end pt-2">
                <Button onClick={() => setBankModal(null)}>Fechar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
              <Row label="Pagamento" value={selected.payment_status} />
              <Row label="Execução" value={selected.delivery_status ?? "—"} />
              <Row label="Voucher" value={selected.voucher_code ?? "—"} />
              <Row
                label="Referência pagamento"
                value={selected.payment_provider_reference ?? "—"}
              />
              {selected.notes && <Row label="Notas" value={selected.notes} />}
              <p className="text-xs text-muted-foreground border-t pt-3">
                Aba de Agenda / Documentos / Histórico chega quando a migração de campos for
                aplicada.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionPrompt} onOpenChange={(o) => !o && setActionPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionPrompt?.kind === "manual"
                ? "Confirmar pagamento"
                : actionPrompt?.kind === "cancel"
                  ? "Cancelar pedido"
                  : "Estornar pedido"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
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
                      setPaymentAccountId("");
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
                <div>
                  <Label>Conta</Label>
                  <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {paymentAccounts
                        .filter((account) => account.currency === settledCurrency)
                        .map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <p className="text-sm text-muted-foreground">
              Informe o motivo (ficará registrado em audit_logs).
            </p>
            <textarea
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              rows={3}
              className="w-full border rounded p-2 text-sm"
            />
            <Button
              disabled={actionPrompt?.kind === "manual" && (!paymentAccountId || !settledAmount)}
              onClick={runPrompt}
              className="w-full bg-admin-accent hover:bg-admin-accent/90"
            >
              Confirmar
            </Button>
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

function BankRow({
  label,
  value,
  onCopy,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="font-display text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className={`break-all text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="mt-3 shrink-0 text-admin-accent"
        aria-label="Copiar"
      >
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
}
