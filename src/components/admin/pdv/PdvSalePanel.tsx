import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  Banknote,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  QrCode,
  ReceiptText,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { BentoCard } from "@/components/admin/BentoCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { listPdvCatalog } from "@/lib/admin/pdv-sales.functions";
import {
  addPdvTabItem,
  cancelPdvTab,
  cancelPdvTabItem,
  closePdvTab,
  listOpenPdvTabsForCustomer,
  openPdvTab,
  updatePdvTabItemQty,
  type PdvTabItemRecord,
  type PdvTabPaymentMethod,
  type PdvTabWithRelations,
} from "@/lib/admin/pdv-tabs.functions";
import { CustomerSearchPanel, type PdvCustomer } from "./CustomerSearchPanel";
import { SaleCatalogGrid, type PdvCatalogItem } from "./SaleCatalogGrid";
import { SaleSuccessOverlay } from "./SaleSuccessOverlay";

type DiscountState = { type: "none" | "amount" | "percent"; value: number };

function money(cents: number, currency: "BRL" | "EUR" = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format((cents ?? 0) / 100);
}

function shortTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function activeItems(tab: PdvTabWithRelations) {
  return tab.items.filter((item) => item.cancelled_at === null);
}

function tabTotals(tab: PdvTabWithRelations) {
  return activeItems(tab).reduce(
    (acc, item) => ({
      brl: acc.brl + item.total_brl_cents,
      eur: acc.eur + item.total_eur_cents,
      qty: acc.qty + item.qty,
      lines: acc.lines + 1,
    }),
    { brl: 0, eur: 0, qty: 0, lines: 0 },
  );
}

export function PdvSalePanel() {
  const qc = useQueryClient();
  const fetchCatalog = useServerFn(listPdvCatalog);
  const fetchCustomerTabs = useServerFn(listOpenPdvTabsForCustomer);
  const openTab = useServerFn(openPdvTab);
  const addItem = useServerFn(addPdvTabItem);
  const updateQty = useServerFn(updatePdvTabItemQty);
  const cancelItem = useServerFn(cancelPdvTabItem);
  const closeTab = useServerFn(closePdvTab);
  const cancelTabFn = useServerFn(cancelPdvTab);

  const [customer, setCustomer] = useState<PdvCustomer | null>(null);
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [cancelItemTarget, setCancelItemTarget] = useState<PdvTabItemRecord | null>(null);
  const [cancelTabTarget, setCancelTabTarget] = useState<PdvTabWithRelations | null>(null);
  const [reason, setReason] = useState("");
  const [discount, setDiscount] = useState<DiscountState>({ type: "none", value: 0 });
  const [paymentMethod, setPaymentMethod] = useState<PdvTabPaymentMethod>("pix");
  const [notes, setNotes] = useState("");
  const [success, setSuccess] = useState<{ brl: number; eur: number } | null>(null);

  const catalogQ = useQuery({
    queryKey: ["pdv-catalog"],
    queryFn: () => fetchCatalog(),
  });

  const customerTabsQ = useQuery({
    queryKey: ["pdv-customer-tabs", customer?.id],
    queryFn: () => fetchCustomerTabs({ data: { customerId: customer!.id } }),
    enabled: Boolean(customer?.id),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pdv-catalog"] });
    qc.invalidateQueries({ queryKey: ["pdv-tabs-workspace"] });
    qc.invalidateQueries({ queryKey: ["pdv-customer-tabs", customer?.id] });
    qc.invalidateQueries({ queryKey: ["pdv-sales-history"] });
    qc.invalidateQueries({ queryKey: ["pdv-cashiers"] });
  };

  const tabs = useMemo(() => customerTabsQ.data?.tabs ?? [], [customerTabsQ.data?.tabs]);
  const permissions = customerTabsQ.data?.permissions;
  const selectedTab = tabs.find((tab) => tab.id === selectedTabId) ?? null;
  const selectedTotals = selectedTab
    ? tabTotals(selectedTab)
    : { brl: 0, eur: 0, qty: 0, lines: 0 };
  const canCancelSelectedTab = Boolean(
    permissions?.canCancelTab || (permissions?.canCancelEmptyTab && selectedTotals.qty === 0),
  );

  const discountCents = useMemo(() => {
    if (discount.type === "amount") {
      const amount = Math.round(discount.value * 100);
      return {
        brl: Math.min(amount, selectedTotals.brl),
        eur: Math.min(amount, selectedTotals.eur),
      };
    }
    if (discount.type === "percent") {
      const pct = Math.min(Math.max(discount.value, 0), 100);
      return {
        brl: Math.floor((selectedTotals.brl * pct) / 100),
        eur: Math.floor((selectedTotals.eur * pct) / 100),
      };
    }
    return { brl: 0, eur: 0 };
  }, [discount, selectedTotals.brl, selectedTotals.eur]);

  const payable = {
    brl: Math.max(0, selectedTotals.brl - discountCents.brl),
    eur: Math.max(0, selectedTotals.eur - discountCents.eur),
  };

  const startNewSaleMut = useMutation({
    mutationFn: () => {
      if (!customer) throw new Error("Selecione um cliente para iniciar a venda.");
      return openTab({ data: { customerId: customer.id, notes: "Venda iniciada no PDV" } });
    },
    onSuccess: (result) => {
      setSelectedTabId(result.tab_id);
      toast.success("Venda iniciada com reserva de estoque ativa.");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao iniciar venda"),
  });

  const addMut = useMutation({
    mutationFn: (item: PdvCatalogItem) => {
      if (!selectedTabId)
        throw new Error("Inicie ou carregue uma comanda antes de adicionar itens.");
      return addItem({ data: { tabId: selectedTabId, productId: item.id, qty: 1 } });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Item reservado para a venda.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao adicionar item"),
  });

  const qtyMut = useMutation({
    mutationFn: ({ itemId, qty }: { itemId: string; qty: number }) =>
      updateQty({ data: { itemId, qty } }),
    onSuccess: () => invalidate(),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar quantidade"),
  });

  const cancelItemMut = useMutation({
    mutationFn: () => cancelItem({ data: { itemId: cancelItemTarget!.id, reason } }),
    onSuccess: () => {
      toast.success("Item removido e reserva liberada.");
      setCancelItemTarget(null);
      setReason("");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao remover item"),
  });

  const closeMut = useMutation({
    mutationFn: () => {
      if (!selectedTabId) throw new Error("Nenhuma venda selecionada.");
      return closeTab({
        data: {
          tabId: selectedTabId,
          discount,
          paymentMethod,
          notes: notes || undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success("Venda fechada e registrada.");
      setSuccess({ brl: payable.brl, eur: payable.eur });
      setCloseDialogOpen(false);
      setCustomer(null);
      setSelectedTabId(null);
      setDiscount({ type: "none", value: 0 });
      setPaymentMethod("pix");
      setNotes("");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao fechar venda"),
  });

  const cancelTabMut = useMutation({
    mutationFn: () => cancelTabFn({ data: { tabId: cancelTabTarget!.id, reason } }),
    onSuccess: () => {
      toast.success("Comanda cancelada e reservas liberadas.");
      const cancelledId = cancelTabTarget?.id;
      setCancelTabTarget(null);
      setReason("");
      if (cancelledId === selectedTabId) setSelectedTabId(null);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao cancelar comanda"),
  });

  useEffect(() => {
    if (!selectedTabId) return;
    if (!customerTabsQ.isFetched) return;
    if (!tabs.some((tab) => tab.id === selectedTabId)) {
      setSelectedTabId(null);
    }
  }, [customerTabsQ.isFetched, selectedTabId, tabs]);

  const reset = () => {
    setCustomer(null);
    setSelectedTabId(null);
    setSuccess(null);
    setDiscount({ type: "none", value: 0 });
    setPaymentMethod("pix");
    setNotes("");
  };

  const isBusy =
    catalogQ.isLoading ||
    customerTabsQ.isLoading ||
    startNewSaleMut.isPending ||
    addMut.isPending ||
    qtyMut.isPending ||
    cancelItemMut.isPending ||
    closeMut.isPending ||
    cancelTabMut.isPending;

  if (!customer) {
    return (
      <>
        <BentoCard padded className="p-10">
          <CustomerSearchPanel
            onSelect={(nextCustomer) => {
              setSuccess(null);
              setCustomer(nextCustomer);
              setSelectedTabId(null);
            }}
          />
        </BentoCard>
        {success !== null && (
          <SaleSuccessOverlay
            totalBrlCents={success.brl}
            totalEurCents={success.eur}
            onReset={reset}
          />
        )}
      </>
    );
  }

  if (!selectedTab) {
    return (
      <div className="space-y-4">
        <BentoCard padded>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-admin-ink-muted">Cliente</p>
              <h3 className="font-display text-2xl text-admin-ink">
                {customer.full_name ?? "Cliente sem nome"}
              </h3>
              <p className="text-xs text-admin-ink-muted">{customer.phone ?? "Sem telefone"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={reset}>
                Trocar cliente
              </Button>
              <Button
                className="bg-admin-accent text-white"
                disabled={isBusy}
                onClick={() => startNewSaleMut.mutate()}
              >
                {startNewSaleMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ReceiptText className="h-4 w-4" />
                )}
                Iniciar nova venda
              </Button>
            </div>
          </div>

          {customerTabsQ.isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
            </div>
          ) : tabs.length > 0 ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    Este cliente tem {tabs.length} comanda{tabs.length === 1 ? "" : "s"} aberta
                    {tabs.length === 1 ? "" : "s"}. Carregue uma delas ou inicie uma nova venda.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {tabs.map((tab) => {
                  const totals = tabTotals(tab);
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setSelectedTabId(tab.id)}
                      className="rounded-xl border border-admin-border bg-admin-surface-2 p-4 text-left transition-colors hover:border-admin-accent"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <Badge className="bg-admin-accent text-white hover:bg-admin-accent">
                          {tab.tab_code}
                        </Badge>
                        <span className="text-[11px] text-admin-ink-muted">
                          {shortTime(tab.opened_at)}
                        </span>
                      </div>
                      <p className="font-display text-lg text-admin-ink">
                        {tab.customer?.full_name ?? "Cliente sem nome"}
                      </p>
                      <p className="text-xs text-admin-ink-muted">{totals.qty} itens ativos</p>
                      <div className="mt-4 flex justify-between border-t border-admin-border pt-3">
                        <span className="text-xs text-admin-ink-muted">Total atual</span>
                        <span className="font-display text-lg text-admin-accent">
                          {money(totals.brl)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-admin-border bg-admin-surface-2 p-8 text-center">
              <p className="text-sm text-admin-ink">Nenhuma comanda aberta para este cliente.</p>
              <p className="mt-1 text-xs text-admin-ink-muted">
                Inicie uma nova venda para reservar estoque em tempo real.
              </p>
            </div>
          )}
        </BentoCard>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-12 gap-4">
        <BentoCard className="col-span-12 lg:col-span-8" padded>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-lg text-admin-ink">Adicionar itens</h3>
              <p className="text-xs text-admin-ink-muted">
                Cada clique salva o item e reserva estoque imediatamente.
              </p>
            </div>
            <Button variant="outline" onClick={() => setSelectedTabId(null)} disabled={isBusy}>
              Escolher outra comanda
            </Button>
          </div>
          {catalogQ.isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
            </div>
          ) : (
            <SaleCatalogGrid
              items={(catalogQ.data ?? []) as unknown as PdvCatalogItem[]}
              onAdd={(item) => {
                if (isBusy) return;
                addMut.mutate(item);
              }}
            />
          )}
        </BentoCard>

        <BentoCard className="col-span-12 lg:col-span-4" padded>
          <div className="flex h-full flex-col">
            <div className="border-b border-admin-border pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Badge className="bg-admin-accent text-white hover:bg-admin-accent">
                    {selectedTab.tab_code}
                  </Badge>
                  <h3 className="mt-2 truncate font-display text-xl text-admin-ink">
                    {selectedTab.customer?.full_name ?? "Cliente sem nome"}
                  </h3>
                  <p className="truncate text-xs text-admin-ink-muted">
                    {selectedTab.customer?.phone ?? "Sem telefone"}
                  </p>
                </div>
                {canCancelSelectedTab && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReason(selectedTotals.qty === 0 ? "Venda vazia aberta por engano" : "");
                      setCancelTabTarget(selectedTab);
                    }}
                    className="text-admin-ink-muted hover:text-red-brand"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="max-h-[54vh] flex-1 space-y-2 overflow-y-auto py-3">
              {activeItems(selectedTab).length === 0 ? (
                <p className="py-8 text-center text-xs text-admin-ink-muted">
                  Adicione itens do catalogo para montar a venda.
                </p>
              ) : (
                activeItems(selectedTab).map((item) => (
                  <div
                    key={item.id}
                    className="group rounded-lg border border-admin-border bg-admin-surface-2 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-xl">{item.product_emoji_snapshot ?? "*"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-admin-ink">
                          {item.product_name_snapshot}
                        </p>
                        <p className="text-[11px] text-admin-ink-muted">
                          {item.added_by_profile?.full_name ?? "Equipe"} -{" "}
                          {shortTime(item.created_at)}
                        </p>
                      </div>
                      {permissions?.canRemoveItem && (
                        <button
                          onClick={() => {
                            setReason("");
                            setCancelItemTarget(item);
                          }}
                          className="text-admin-ink-muted hover:text-red-brand"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          disabled={item.qty <= 1 || isBusy}
                          onClick={() => qtyMut.mutate({ itemId: item.id, qty: item.qty - 1 })}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-7 text-center text-xs tabular-nums">{item.qty}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          disabled={isBusy}
                          onClick={() => qtyMut.mutate({ itemId: item.id, qty: item.qty + 1 })}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-sm text-admin-ink tabular-nums">
                          {money(item.total_brl_cents)}
                        </div>
                        {item.total_eur_cents > 0 && (
                          <div className="text-[11px] text-admin-ink-muted tabular-nums">
                            {money(item.total_eur_cents, "EUR")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-3 border-t border-admin-border pt-3">
              <div className="flex justify-between text-xs text-admin-ink-muted">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(selectedTotals.brl)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-display text-xs uppercase tracking-widest text-admin-ink-muted">
                  Total
                </span>
                <div className="text-right">
                  <div className="font-display text-3xl font-bold text-admin-accent tabular-nums">
                    {money(selectedTotals.brl)}
                  </div>
                  {selectedTotals.eur > 0 && (
                    <div className="text-xs text-admin-ink-muted tabular-nums">
                      {money(selectedTotals.eur, "EUR")}
                    </div>
                  )}
                </div>
              </div>
              <Button
                disabled={selectedTotals.qty === 0 || isBusy}
                onClick={() => {
                  setDiscount({ type: "none", value: 0 });
                  setPaymentMethod("pix");
                  setNotes("");
                  setCloseDialogOpen(true);
                }}
                className="h-11 w-full bg-admin-accent text-white"
              >
                Fechar venda
              </Button>
              {selectedTotals.qty === 0 && canCancelSelectedTab && (
                <Button
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => {
                    setReason("Venda vazia aberta por engano");
                    setCancelTabTarget(selectedTab);
                  }}
                  className="h-10 w-full border-red-brand/30 text-red-brand hover:bg-red-brand/10"
                >
                  Cancelar venda vazia
                </Button>
              )}
            </div>
          </div>
        </BentoCard>
      </div>

      <AlertDialog
        open={closeDialogOpen}
        onOpenChange={(open) => !isBusy && setCloseDialogOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar venda</AlertDialogTitle>
            <AlertDialogDescription>
              O fechamento cria uma venda definitiva, baixa estoque fisico e envia o registro ao
              financeiro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-[120px_1fr] items-end gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest text-admin-ink-muted">
                  Desconto
                </Label>
                <Select
                  value={discount.type}
                  onValueChange={(value: DiscountState["type"]) =>
                    setDiscount((prev) => ({
                      ...prev,
                      type: value,
                      value: value === "none" ? 0 : prev.value,
                    }))
                  }
                >
                  <SelectTrigger className="bg-admin-bg border-admin-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem</SelectItem>
                    <SelectItem value="amount">Valor</SelectItem>
                    <SelectItem value="percent">%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                type="number"
                min={0}
                disabled={discount.type === "none"}
                value={discount.value || ""}
                onChange={(event) =>
                  setDiscount((prev) => ({ ...prev, value: Number(event.target.value || 0) }))
                }
                className="bg-admin-bg border-admin-border"
                placeholder="0,00"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "dinheiro", label: "Dinheiro", icon: Banknote },
                { value: "cartao", label: "Cartao", icon: CreditCard },
                { value: "pix", label: "Pix", icon: QrCode },
              ].map((method) => {
                const Icon = method.icon;
                return (
                  <button
                    key={method.value}
                    type="button"
                    onClick={() => setPaymentMethod(method.value as PdvTabPaymentMethod)}
                    className={`rounded-lg border p-3 text-sm transition-colors ${
                      paymentMethod === method.value
                        ? "border-admin-accent bg-admin-accent text-white"
                        : "border-admin-border bg-admin-bg text-admin-ink hover:border-admin-accent"
                    }`}
                  >
                    <Icon className="mx-auto mb-1 h-4 w-4" />
                    {method.label}
                  </button>
                );
              })}
            </div>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="bg-admin-bg border-admin-border"
              placeholder="Observacoes internas..."
            />
            <div className="rounded-lg border border-admin-border bg-admin-surface-2 p-3">
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(selectedTotals.brl)}</span>
              </div>
              {discountCents.brl > 0 && (
                <div className="mt-1 flex justify-between text-sm text-red-brand">
                  <span>Desconto</span>
                  <span className="tabular-nums">-{money(discountCents.brl)}</span>
                </div>
              )}
              <div className="mt-2 flex items-end justify-between border-t border-admin-border pt-2">
                <span className="font-display text-xs uppercase tracking-widest text-admin-ink-muted">
                  Total a pagar
                </span>
                <div className="text-right">
                  <div className="font-display text-2xl font-bold text-admin-accent">
                    {money(payable.brl)}
                  </div>
                  {payable.eur > 0 && (
                    <div className="text-xs text-admin-ink-muted">{money(payable.eur, "EUR")}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBusy}
              onClick={(event) => {
                event.preventDefault();
                closeMut.mutate();
              }}
              className="bg-admin-accent text-white"
            >
              {closeMut.isPending ? "Fechando..." : "Confirmar fechamento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelItemTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isBusy) {
            setCancelItemTarget(null);
            setReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover item da venda</AlertDialogTitle>
            <AlertDialogDescription>
              A reserva de estoque sera liberada e o item ficara registrado em auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="bg-admin-bg border-admin-border"
            placeholder="Motivo da remocao..."
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBusy || reason.trim().length < 3}
              onClick={(event) => {
                event.preventDefault();
                cancelItemMut.mutate();
              }}
              className="bg-red-brand text-white"
            >
              Remover item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelTabTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isBusy) {
            setCancelTabTarget(null);
            setReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar comanda</AlertDialogTitle>
            <AlertDialogDescription>
              Comandas vazias podem ser canceladas pela equipe. Comandas com itens exigem permissao
              administrativa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="bg-admin-bg border-admin-border"
            placeholder="Motivo do cancelamento..."
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBusy || reason.trim().length < 3}
              onClick={(event) => {
                event.preventDefault();
                cancelTabMut.mutate();
              }}
              className="bg-red-brand text-white"
            >
              Cancelar comanda
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {success !== null && (
        <SaleSuccessOverlay
          totalBrlCents={success.brl}
          totalEurCents={success.eur}
          onReset={reset}
        />
      )}
    </>
  );
}
