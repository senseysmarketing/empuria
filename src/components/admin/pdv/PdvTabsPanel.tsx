import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Banknote,
  Clock,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  QrCode,
  ReceiptText,
  Search,
  Trash2,
  UserPlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { BentoCard } from "@/components/admin/BentoCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { CustomerSearchPanel, type PdvCustomer } from "./CustomerSearchPanel";
import { SaleCatalogGrid, type PdvCatalogItem } from "./SaleCatalogGrid";
import { listPdvCatalog } from "@/lib/admin/pdv-sales.functions";
import {
  addPdvTabItem,
  cancelPdvTab,
  cancelPdvTabItem,
  closePdvTab,
  listPdvTabsWorkspace,
  openPdvTab,
  updatePdvTabItemQty,
  type PdvTabItemRecord,
  type PdvTabPaymentMethod,
  type PdvTabWithRelations,
} from "@/lib/admin/pdv-tabs.functions";
import { cn } from "@/lib/utils";

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

function elapsed(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function initials(name?: string | null) {
  if (!name) return "--";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
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

export function PdvTabsPanel() {
  const qc = useQueryClient();
  const fetchTabs = useServerFn(listPdvTabsWorkspace);
  const fetchCatalog = useServerFn(listPdvCatalog);
  const openTab = useServerFn(openPdvTab);
  const addItem = useServerFn(addPdvTabItem);
  const updateQty = useServerFn(updatePdvTabItemQty);
  const cancelItem = useServerFn(cancelPdvTabItem);
  const closeTab = useServerFn(closePdvTab);
  const cancelTabFn = useServerFn(cancelPdvTab);

  const [search, setSearch] = useState("");
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [openCustomerDialog, setOpenCustomerDialog] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [cancelItemTarget, setCancelItemTarget] = useState<PdvTabItemRecord | null>(null);
  const [cancelTabTarget, setCancelTabTarget] = useState<PdvTabWithRelations | null>(null);
  const [reason, setReason] = useState("");
  const [discount, setDiscount] = useState<DiscountState>({ type: "none", value: 0 });
  const [paymentMethod, setPaymentMethod] = useState<PdvTabPaymentMethod>("pix");
  const [notes, setNotes] = useState("");

  const tabsQ = useQuery({
    queryKey: ["pdv-tabs-workspace"],
    queryFn: () => fetchTabs(),
  });

  const catalogQ = useQuery({
    queryKey: ["pdv-catalog"],
    queryFn: () => fetchCatalog(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pdv-tabs-workspace"] });
    qc.invalidateQueries({ queryKey: ["pdv-catalog"] });
    qc.invalidateQueries({ queryKey: ["pdv-sales-history"] });
    qc.invalidateQueries({ queryKey: ["pdv-cashiers"] });
  };

  const openMut = useMutation({
    mutationFn: (customer: PdvCustomer) => openTab({ data: { customerId: customer.id } }),
    onSuccess: (result) => {
      toast.success(result.existing ? "Comanda aberta localizada." : "Comanda aberta.");
      setSelectedTabId(result.tab_id);
      setOpenCustomerDialog(false);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao abrir comanda"),
  });

  const addMut = useMutation({
    mutationFn: (item: PdvCatalogItem) =>
      addItem({ data: { tabId: selectedTabId!, productId: item.id, qty: 1 } }),
    onSuccess: () => {
      invalidate();
      toast.success("Item salvo na comanda.");
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
    mutationFn: ({ itemId, reason }: { itemId: string; reason?: string }) =>
      cancelItem({ data: { itemId, reason } }),
    onSuccess: () => {
      toast.success("Item removido e reserva liberada.");
      setCancelItemTarget(null);
      setReason("");
      if (typeof document !== "undefined") document.body.style.pointerEvents = "";
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao remover item"),
  });

  const closeMut = useMutation({
    mutationFn: () =>
      closeTab({
        data: {
          tabId: selectedTabId!,
          discount,
          paymentMethod,
          notes: notes || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Comanda fechada e venda registrada.");
      setCloseDialogOpen(false);
      setSelectedTabId(null);
      setDiscount({ type: "none", value: 0 });
      setPaymentMethod("pix");
      setNotes("");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao fechar comanda"),
  });

  const cancelTabMut = useMutation({
    mutationFn: ({ tabId, reason: r }: { tabId: string; reason?: string }) =>
      cancelTabFn({ data: { tabId, reason: r } }),
    onSuccess: () => {
      toast.success("Comanda cancelada e reservas liberadas.");
      setCancelTabTarget(null);
      setSelectedTabId(null);
      setReason("");
      if (typeof document !== "undefined") document.body.style.pointerEvents = "";
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao cancelar comanda"),
  });

  // Defesa contra bug do Radix que pode deixar pointer-events: none no body
  useEffect(() => {
    if (
      !openCustomerDialog &&
      !closeDialogOpen &&
      cancelItemTarget === null &&
      cancelTabTarget === null &&
      typeof document !== "undefined"
    ) {
      document.body.style.pointerEvents = "";
    }
  }, [openCustomerDialog, closeDialogOpen, cancelItemTarget, cancelTabTarget]);

  const tabs = useMemo(() => tabsQ.data?.tabs ?? [], [tabsQ.data?.tabs]);
  const permissions = tabsQ.data?.permissions;
  const filteredTabs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabs;
    return tabs.filter((tab) => {
      const customer = tab.customer?.full_name ?? "";
      const phone = tab.customer?.phone ?? "";
      return (
        tab.tab_code.toLowerCase().includes(q) ||
        customer.toLowerCase().includes(q) ||
        phone.toLowerCase().includes(q)
      );
    });
  }, [search, tabs]);

  const selectedTab =
    tabs.find((tab) => tab.id === selectedTabId) ?? filteredTabs[0] ?? tabs[0] ?? null;
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
      const pct = Math.max(0, Math.min(discount.value, 100));
      return {
        brl: Math.floor((selectedTotals.brl * pct) / 100),
        eur: Math.floor((selectedTotals.eur * pct) / 100),
      };
    }
    return { brl: 0, eur: 0 };
  }, [discount, selectedTotals.brl, selectedTotals.eur]);
  const closeTotal = {
    brl: Math.max(0, selectedTotals.brl - discountCents.brl),
    eur: Math.max(0, selectedTotals.eur - discountCents.eur),
  };

  const isBusy =
    openMut.isPending ||
    addMut.isPending ||
    qtyMut.isPending ||
    cancelItemMut.isPending ||
    closeMut.isPending ||
    cancelTabMut.isPending;

  return (
    <div className="space-y-4">
      <BentoCard padded={false}>
        <div className="p-5 border-b border-admin-border flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg text-admin-ink">Comandas abertas</h2>
            <p className="text-xs text-admin-ink-muted mt-1">
              Consumo presencial com reserva de estoque em tempo real.
            </p>
          </div>
          <Button
            onClick={() => setOpenCustomerDialog(true)}
            className="bg-admin-accent text-white"
          >
            <UserPlus className="h-4 w-4" />
            Nova comanda
          </Button>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-admin-ink-muted" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por comanda, cliente ou telefone..."
              className="pl-9 bg-admin-bg border-admin-border"
            />
          </div>

          {tabsQ.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
            </div>
          ) : filteredTabs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-admin-border p-8 text-center">
              <ReceiptText className="mx-auto h-8 w-8 text-admin-ink-muted" />
              <p className="mt-3 text-sm text-admin-ink-muted">
                Nenhuma comanda aberta no momento.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredTabs.map((tab) => {
                const totals = tabTotals(tab);
                const isSelected = selectedTab?.id === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSelectedTabId(tab.id)}
                    className={cn(
                      "rounded-xl border bg-admin-surface-2 p-4 text-left transition-colors",
                      isSelected
                        ? "border-admin-accent ring-2 ring-admin-accent/15"
                        : "border-admin-border hover:border-admin-accent/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-admin-accent/10 text-admin-accent hover:bg-admin-accent/10">
                            {tab.tab_code}
                          </Badge>
                          <span className="text-[11px] text-admin-ink-muted flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {elapsed(tab.opened_at)}
                          </span>
                        </div>
                        <p className="mt-2 truncate font-display text-base text-admin-ink">
                          {tab.customer?.full_name ?? "Cliente sem nome"}
                        </p>
                        <p className="truncate text-xs text-admin-ink-muted">
                          {tab.customer?.phone ?? "Sem telefone"} · {totals.qty} itens
                        </p>
                      </div>
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={tab.customer?.avatar_url ?? undefined} />
                        <AvatarFallback className="bg-admin-bg text-[10px]">
                          {initials(tab.customer?.full_name)}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className="mt-4 flex items-end justify-between border-t border-admin-border pt-3">
                      <div className="text-[11px] text-admin-ink-muted">
                        Aberta {shortTime(tab.opened_at)}
                        <br />
                        por {tab.opened_by_profile?.full_name ?? "Equipe"}
                      </div>
                      <div className="text-right">
                        <div className="font-display text-lg text-admin-accent tabular-nums">
                          {money(totals.brl)}
                        </div>
                        {totals.eur > 0 && (
                          <div className="text-[11px] text-admin-ink-muted tabular-nums">
                            {money(totals.eur, "EUR")}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </BentoCard>

      {selectedTab && (
        <div className="grid grid-cols-12 gap-4">
          <BentoCard className="col-span-12 lg:col-span-8" padded>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg text-admin-ink">Adicionar consumo</h3>
                <p className="text-xs text-admin-ink-muted">
                  Cada clique salva o item e reserva estoque imediatamente.
                </p>
              </div>
              {catalogQ.isFetching && (
                <Loader2 className="h-4 w-4 animate-spin text-admin-accent" />
              )}
            </div>
            <SaleCatalogGrid
              items={(catalogQ.data ?? []) as unknown as PdvCatalogItem[]}
              onAdd={(item) => {
                if (isBusy) return;
                setSelectedTabId(selectedTab.id);
                addMut.mutate(item);
              }}
            />
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
                        if (selectedTotals.qty === 0) {
                          cancelTabMut.mutate({ tabId: selectedTab.id });
                          return;
                        }
                        setReason("");
                        setCancelTabTarget(selectedTab);
                      }}
                      className="text-admin-ink-muted hover:text-red-brand"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="max-h-[54vh] flex-1 overflow-y-auto py-3 space-y-2">
                {activeItems(selectedTab).length === 0 ? (
                  <p className="py-8 text-center text-xs text-admin-ink-muted">
                    Adicione itens do catalogo para montar a comanda.
                  </p>
                ) : (
                  activeItems(selectedTab).map((item) => (
                    <div
                      key={item.id}
                      className="group rounded-lg border border-admin-border bg-admin-surface-2 p-3"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-xl">{item.product_emoji_snapshot ?? "•"}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-admin-ink">
                            {item.product_name_snapshot}
                          </p>
                          <p className="text-[11px] text-admin-ink-muted">
                            {item.added_by_profile?.full_name ?? "Equipe"} ·{" "}
                            {shortTime(item.created_at)}
                          </p>
                        </div>
                        {permissions?.canRemoveItem && (
                          <button
                            disabled={isBusy}
                            onClick={() => {
                              const ageMs = Date.now() - new Date(item.created_at).getTime();
                              if (ageMs < 60_000) {
                                cancelItemMut.mutate({ itemId: item.id });
                                return;
                              }
                              setReason("");
                              setCancelItemTarget(item);
                            }}
                            className="text-admin-ink-muted hover:text-red-brand disabled:opacity-50"
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

              <div className="border-t border-admin-border pt-3 space-y-3">
                <div className="flex justify-between text-xs text-admin-ink-muted">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{money(selectedTotals.brl)}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-xs uppercase tracking-widest font-display text-admin-ink-muted">
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
                  Fechar comanda
                </Button>
                {selectedTotals.qty === 0 && canCancelSelectedTab && (
                  <Button
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => cancelTabMut.mutate({ tabId: selectedTab.id })}
                    className="h-10 w-full border-red-brand/30 text-red-brand hover:bg-red-brand/10"
                  >
                    Cancelar comanda vazia
                  </Button>
                )}
              </div>
            </div>
          </BentoCard>
        </div>
      )}

      <Dialog open={openCustomerDialog} onOpenChange={setOpenCustomerDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nova comanda</DialogTitle>
            <DialogDescription>
              Selecione ou cadastre o cliente presente no atendimento.
            </DialogDescription>
          </DialogHeader>
          <CustomerSearchPanel
            title="Selecionar cliente"
            subtitle="A comanda sera vinculada ao cliente escolhido."
            onSelect={(customer) => openMut.mutate(customer)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={closeDialogOpen}
        onOpenChange={(open) => !isBusy && setCloseDialogOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar comanda</AlertDialogTitle>
            <AlertDialogDescription>
              O fechamento cria uma venda definitiva, baixa estoque fisico e envia o registro ao
              financeiro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-[120px_1fr] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest text-admin-ink-muted">
                  Desconto
                </Label>
                <Select
                  value={discount.type}
                  onValueChange={(value) =>
                    setDiscount({ type: value as DiscountState["type"], value: 0 })
                  }
                >
                  <SelectTrigger className="bg-admin-bg border-admin-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem</SelectItem>
                    <SelectItem value="amount">R$</SelectItem>
                    <SelectItem value="percent">%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                type="number"
                min={0}
                step="0.01"
                disabled={discount.type === "none"}
                value={discount.value || ""}
                onChange={(event) =>
                  setDiscount({ ...discount, value: Number.parseFloat(event.target.value || "0") })
                }
                className="bg-admin-bg border-admin-border"
                placeholder="0,00"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant={paymentMethod === "dinheiro" ? "default" : "outline"}
                onClick={() => setPaymentMethod("dinheiro")}
                className={cn(paymentMethod === "dinheiro" && "bg-admin-accent text-white")}
              >
                <Banknote className="h-4 w-4" />
                Dinheiro
              </Button>
              <Button
                type="button"
                variant={paymentMethod === "cartao" ? "default" : "outline"}
                onClick={() => setPaymentMethod("cartao")}
                className={cn(paymentMethod === "cartao" && "bg-admin-accent text-white")}
              >
                <CreditCard className="h-4 w-4" />
                Cartao
              </Button>
              <Button
                type="button"
                variant={paymentMethod === "pix" ? "default" : "outline"}
                onClick={() => setPaymentMethod("pix")}
                className={cn(paymentMethod === "pix" && "bg-admin-accent text-white")}
              >
                <QrCode className="h-4 w-4" />
                Pix
              </Button>
            </div>

            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="bg-admin-bg border-admin-border"
              placeholder="Observacoes internas do fechamento..."
            />

            <div className="rounded-lg border border-admin-border bg-admin-bg/40 p-4 space-y-2">
              <div className="flex justify-between text-xs text-admin-ink-muted">
                <span>Subtotal</span>
                <span>{money(selectedTotals.brl)}</span>
              </div>
              {discountCents.brl > 0 && (
                <div className="flex justify-between text-xs text-yellow-brand">
                  <span>Desconto</span>
                  <span>- {money(discountCents.brl)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-admin-border pt-2">
                <span className="text-xs uppercase tracking-widest text-admin-ink-muted">
                  Total
                </span>
                <span className="font-display text-xl text-admin-accent">
                  {money(closeTotal.brl)}
                </span>
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
            <AlertDialogTitle>Remover item da comanda</AlertDialogTitle>
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
                if (cancelItemTarget) {
                  cancelItemMut.mutate({ itemId: cancelItemTarget.id, reason });
                }
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
              Todos os itens ativos serao cancelados e suas reservas de estoque serao liberadas.
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
                if (cancelTabTarget) {
                  cancelTabMut.mutate({ tabId: cancelTabTarget.id, reason });
                }
              }}
              className="bg-red-brand text-white"
            >
              Cancelar comanda
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
