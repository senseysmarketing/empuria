import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import confetti from "canvas-confetti";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCw,
  Search,
  UserPlus,
  X,
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
  DialogFooter,
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
import {
  cancelPdvWiseAttempt,
  listPdvAwaitingPayments,
  recheckPdvWiseAttempt,
  requestPdvWisePayment,
  type PdvWiseAttempt,
} from "@/lib/admin/pdv-wise.functions";
import { cn } from "@/lib/utils";

type DiscountState = { type: "none" | "amount" | "percent"; value: number };

const PAYMENT_LABEL: Record<PdvTabPaymentMethod, string> = {
  dinheiro: "Dinheiro",
  transferencia: "Transferência bancária",
  wise: "Wise",
};

function fireConfetti() {
  if (typeof window === "undefined") return;
  const defaults = { spread: 70, ticks: 80, gravity: 0.9, scalar: 1, zIndex: 9999 };
  confetti({ ...defaults, particleCount: 90, origin: { x: 0.5, y: 0.6 } });
  setTimeout(() => {
    confetti({ ...defaults, particleCount: 60, angle: 60, origin: { x: 0, y: 0.7 } });
    confetti({ ...defaults, particleCount: 60, angle: 120, origin: { x: 1, y: 0.7 } });
  }, 180);
}

function money(cents: number, currency: "BRL" | "EUR" = "EUR") {
  return new Intl.NumberFormat(currency === "EUR" ? "de-DE" : "pt-BR", {
    style: "currency",
    currency,
  }).format((cents ?? 0) / 100);
}

function shortTime(value: string) {
  return new Intl.DateTimeFormat("pt-PT", {
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
  const requestWise = useServerFn(requestPdvWisePayment);
  const cancelWise = useServerFn(cancelPdvWiseAttempt);
  const recheckWise = useServerFn(recheckPdvWiseAttempt);
  const fetchAwaiting = useServerFn(listPdvAwaitingPayments);

  const [search, setSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [openCustomerDialog, setOpenCustomerDialog] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{
    tabCode: string;
    customerName: string;
    totalCents: number;
    paymentMethod: PdvTabPaymentMethod;
  } | null>(null);

  const [cancelTabTarget, setCancelTabTarget] = useState<PdvTabWithRelations | null>(null);
  const [reason, setReason] = useState("");
  const [discount, setDiscount] = useState<DiscountState>({ type: "none", value: 0 });
  const [paymentMethod, setPaymentMethod] = useState<PdvTabPaymentMethod>("dinheiro");
  const [notes, setNotes] = useState("");
  const [wiseModal, setWiseModal] = useState<{
    attemptId: string;
    reference: string;
    amountCents: number;
    paymentUrl: string | null;
    customerName: string | null;
    customerPhone: string | null;
    tabCode: string;
  } | null>(null);

  const tabsQ = useQuery({
    queryKey: ["pdv-tabs-workspace"],
    queryFn: () => fetchTabs(),
  });

  const awaitingQ = useQuery({
    queryKey: ["pdv-awaiting-payments"],
    queryFn: () => fetchAwaiting(),
    refetchInterval: 15000,
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
    qc.invalidateQueries({ queryKey: ["pdv-awaiting-payments"] });
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
      if (typeof document !== "undefined") document.body.style.pointerEvents = "";
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao remover item"),
  });

  const closeMut = useMutation({
    mutationFn: (tabId: string) =>
      closeTab({
        data: {
          tabId,
          discount,
          paymentMethod,
          notes: notes || undefined,
        },
      }),
    onSuccess: (_data, tabId) => {
      const tab = tabs.find((t) => t.id === tabId) ?? selectedTab;
      const totalCents = closeTotal.eur;
      if (tab) {
        setSuccessInfo({
          tabCode: tab.tab_code,
          customerName: tab.customer?.full_name ?? "Cliente sem nome",
          totalCents,
          paymentMethod,
        });
      }
      setCloseDialogOpen(false);
      setSelectedTabId(null);
      setDiscount({ type: "none", value: 0 });
      setPaymentMethod("dinheiro");
      setNotes("");
      invalidate();
      fireConfetti();
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

  const requestWiseMut = useMutation({
    mutationFn: (tabId: string) =>
      requestWise({
        data: {
          tabId,
          discount,
          notes: notes || undefined,
        },
      }),
    onSuccess: (result, tabId) => {
      const tab = tabs.find((t) => t.id === tabId);
      setWiseModal({
        attemptId: result.attemptId,
        reference: result.reference,
        amountCents: result.amountEurCents,
        paymentUrl: result.paymentUrl,
        customerName: result.customerName,
        customerPhone: result.customerPhone,
        tabCode: tab?.tab_code ?? "",
      });
      setCloseDialogOpen(false);
      setDiscount({ type: "none", value: 0 });
      setNotes("");
      setPaymentMethod("dinheiro");
      invalidate();
      if (result.manualOnly) {
        toast.warning("Link Wise nao configurado. Configure em Configuracoes > Wise.");
      } else {
        toast.success("Link Wise gerado.");
      }
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao gerar link Wise"),
  });

  const cancelWiseMut = useMutation({
    mutationFn: ({ attemptId, reason }: { attemptId: string; reason: string }) =>
      cancelWise({ data: { attemptId, reason } }),
    onSuccess: () => {
      toast.success("Cobranca cancelada. Comanda reaberta.");
      setWiseModal(null);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao cancelar cobranca"),
  });

  const recheckWiseMut = useMutation({
    mutationFn: (attemptId: string) => recheckWise({ data: { attemptId } }),
    onSuccess: (data) => {
      if (data.status === "paid") {
        toast.success("Pagamento confirmado!");
        setWiseModal(null);
        fireConfetti();
      } else if (data.status === "pending_conciliation") {
        toast.warning("Pagamento divergente, em conciliacao.");
      } else if (data.status === "cancelled") {
        toast.info("Cobranca cancelada.");
        setWiseModal(null);
      } else {
        toast.info("Ainda aguardando pagamento.");
      }
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao verificar"),
  });
  useEffect(() => {
    if (
      !openCustomerDialog &&
      !closeDialogOpen &&
      cancelTabTarget === null &&
      typeof document !== "undefined"
    ) {
      document.body.style.pointerEvents = "";
    }
  }, [openCustomerDialog, closeDialogOpen, cancelTabTarget]);

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
    cancelTabMut.isPending ||
    requestWiseMut.isPending;
  const awaitingAttempts = (awaitingQ.data ?? []) as PdvWiseAttempt[];
  const tabCodeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const tab of tabs) map.set(tab.id, tab.tab_code);
    return map;
  }, [tabs]);

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
                          {money(totals.eur)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </BentoCard>

      {awaitingAttempts.length > 0 && (
        <BentoCard padded={false}>
          <div className="px-4 py-3 border-b border-amber-500/40 bg-amber-500/5 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="font-display text-sm text-admin-ink">
              Comandas aguardando pagamento Wise
            </h2>
            <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">
              {awaitingAttempts.length}
            </Badge>
          </div>
          <div className="divide-y divide-admin-border">
            {awaitingAttempts.map((att) => {
              const code = tabCodeById.get(att.tab_id) ?? att.reference;
              return (
                <div
                  key={att.id}
                  className="px-4 py-2 flex items-center gap-3 hover:bg-amber-500/5"
                >
                  <span className="font-mono text-[11px] text-amber-700 bg-amber-500/15 rounded px-1.5 py-0.5 shrink-0">
                    {code}
                  </span>
                  <span className="text-sm text-admin-ink truncate flex-1 min-w-0">
                    {att.customer_name_snapshot ?? "Cliente"}
                  </span>
                  <span className="text-[11px] text-admin-ink-muted tabular-nums hidden sm:inline">
                    {shortTime(att.created_at)}
                  </span>
                  <span className="font-display text-sm text-amber-600 tabular-nums shrink-0 w-20 text-right">
                    {money(att.amount_eur_cents)}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2"
                      onClick={() =>
                        setWiseModal({
                          attemptId: att.id,
                          reference: att.reference,
                          amountCents: att.amount_eur_cents,
                          paymentUrl: att.payment_url,
                          customerName: att.customer_name_snapshot,
                          customerPhone: att.customer_phone_snapshot,
                          tabCode: tabCodeById.get(att.tab_id) ?? "",
                        })
                      }
                    >
                      Abrir
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      title="Verificar pagamento"
                      disabled={recheckWiseMut.isPending}
                      onClick={() => recheckWiseMut.mutate(att.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </BentoCard>
      )}


      {selectedTab && (
        <div className="grid grid-cols-12 gap-4">
          <BentoCard className="col-span-12 lg:col-span-8" padded>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-lg text-admin-ink">Adicionar consumo</h3>
                <p className="text-xs text-admin-ink-muted">
                  Cada clique salva o item e reserva estoque imediatamente.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {catalogQ.isFetching && (
                  <Loader2 className="h-4 w-4 animate-spin text-admin-accent" />
                )}
                <div className="relative w-60">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-admin-ink-muted" />
                  <Input
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Buscar item..."
                    className="pl-9 h-9 bg-admin-bg border-admin-border"
                  />
                </div>
              </div>
            </div>
            <SaleCatalogGrid
              items={(catalogQ.data ?? []) as unknown as PdvCatalogItem[]}
              search={catalogSearch}
              pendingProductId={
                addMut.isPending
                  ? addMut.variables?.id ?? null
                  : qtyMut.isPending
                    ? activeItems(selectedTab).find(
                        (it) => it.id === qtyMut.variables?.itemId,
                      )?.product_id ?? null
                    : null
              }
              onAdd={(item) => {
                if (isBusy) return;
                setSelectedTabId(selectedTab.id);
                const existing = activeItems(selectedTab).find(
                  (it) => it.product_id === item.id,
                );
                if (existing) {
                  qtyMut.mutate({ itemId: existing.id, qty: existing.qty + 1 });
                } else {
                  addMut.mutate(item);
                }
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
                      disabled={cancelTabMut.isPending}
                      onClick={() => {
                        if (selectedTotals.qty === 0) {
                          cancelTabMut.mutate({
                            tabId: selectedTab.id,
                            reason: "Comanda vazia",
                          });
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
                  activeItems(selectedTab).map((item) => {
                    const isRemoving =
                      cancelItemMut.isPending && cancelItemMut.variables?.itemId === item.id;
                    const isUpdatingQty =
                      qtyMut.isPending && qtyMut.variables?.itemId === item.id;
                    return (
                    <div
                      key={item.id}
                      className="group relative rounded-lg border border-admin-border bg-admin-surface-2 p-3"
                    >
                      <button
                        disabled={isBusy}
                        onClick={() =>
                          cancelItemMut.mutate({
                            itemId: item.id,
                            reason: "Removido pelo operador",
                          })
                        }
                        className="absolute top-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-admin-ink-muted hover:bg-red-brand/10 hover:text-red-brand disabled:opacity-50"
                        aria-label="Remover item"
                      >
                        {isRemoving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <div className="flex items-start gap-2 pr-7">
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
                          <span className="w-7 text-center text-xs tabular-nums inline-flex items-center justify-center">
                            {isUpdatingQty ? (
                              <Loader2 className="h-3 w-3 animate-spin text-admin-accent" />
                            ) : (
                              item.qty
                            )}
                          </span>
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
                            {money(item.total_eur_cents)}
                          </div>
                        </div>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>

              <div className="border-t border-admin-border pt-3 space-y-3">
                <div className="flex justify-between text-xs text-admin-ink-muted">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{money(selectedTotals.eur)}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-xs uppercase tracking-widest font-display text-admin-ink-muted">
                    Total
                  </span>
                  <div className="text-right">
                    <div className="font-display text-3xl font-bold text-admin-accent tabular-nums">
                      {money(selectedTotals.eur)}
                    </div>
                  </div>
                </div>
                <Button
                  disabled={selectedTotals.qty === 0 || isBusy}
                  onClick={() => {
                    setSelectedTabId(selectedTab.id);
                    setDiscount({ type: "none", value: 0 });
                    setPaymentMethod("dinheiro");
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
                    disabled={cancelTabMut.isPending}
                    onClick={() =>
                      cancelTabMut.mutate({
                        tabId: selectedTab.id,
                        reason: "Comanda vazia",
                      })
                    }
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

      <Dialog
        open={openCustomerDialog}
        onOpenChange={(open) => !openMut.isPending && setOpenCustomerDialog(open)}
      >
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
            onSelect={(customer) => {
              if (openMut.isPending) return;
              openMut.mutate(customer);
            }}
            isSubmitting={openMut.isPending}
            selectedId={openMut.variables?.id ?? null}
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
                    <SelectItem value="amount">€</SelectItem>
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
                variant={paymentMethod === "transferencia" ? "default" : "outline"}
                onClick={() => setPaymentMethod("transferencia")}
                className={cn(paymentMethod === "transferencia" && "bg-admin-accent text-white")}
              >
                <CreditCard className="h-4 w-4" />
                Transferência
              </Button>
              <Button
                type="button"
                variant={paymentMethod === "wise" ? "default" : "outline"}
                onClick={() => setPaymentMethod("wise")}
                className={cn(paymentMethod === "wise" && "bg-amber-500 text-white")}
              >
                <QrCode className="h-4 w-4" />
                Wise
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
                <span>{money(selectedTotals.eur)}</span>
              </div>
              {discountCents.eur > 0 && (
                <div className="flex justify-between text-xs text-yellow-brand">
                  <span>Desconto</span>
                  <span>- {money(discountCents.eur)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-admin-border pt-2">
                <span className="text-xs uppercase tracking-widest text-admin-ink-muted">
                  Total
                </span>
                <span className="font-display text-xl text-admin-accent">
                  {money(closeTotal.eur)}
                </span>
              </div>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBusy || !selectedTab}
              onClick={(event) => {
                event.preventDefault();
                if (!selectedTab) return;
                if (paymentMethod === "wise") {
                  requestWiseMut.mutate(selectedTab.id);
                } else {
                  closeMut.mutate(selectedTab.id);
                }
              }}
              className={cn(
                "text-white",
                paymentMethod === "wise" ? "bg-amber-500 hover:bg-amber-500/90" : "bg-admin-accent",
              )}
            >
              {closeMut.isPending || requestWiseMut.isPending
                ? "Processando..."
                : paymentMethod === "wise"
                  ? "Gerar link Wise"
                  : "Confirmar fechamento"}
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

      <Dialog open={wiseModal !== null} onOpenChange={(open) => !open && setWiseModal(null)}>
        <DialogContent className="sm:max-w-md border-amber-500/40 bg-admin-bg text-admin-ink">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <QrCode className="h-5 w-5 text-amber-500" />
              Pagamento Wise gerado
            </DialogTitle>
            <DialogDescription>
              Compartilhe o link com o cliente. A comanda fica bloqueada ate o pagamento ser
              confirmado pelo webhook ou voce verificar manualmente.
            </DialogDescription>
          </DialogHeader>
          {wiseModal && (
            <div className="space-y-3">
              <div className="rounded-lg border border-admin-border bg-admin-bg/60 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-admin-ink-muted">Comanda</span>
                  <span className="font-mono">{wiseModal.tabCode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-admin-ink-muted">Cliente</span>
                  <span className="text-right">{wiseModal.customerName ?? "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-admin-ink-muted">Referência</span>
                  <span className="font-mono text-xs">{wiseModal.reference}</span>
                </div>
                <div className="flex justify-between border-t border-admin-border pt-2">
                  <span className="text-xs uppercase tracking-widest text-admin-ink-muted">
                    Total
                  </span>
                  <span className="font-display text-xl text-amber-600">
                    {money(wiseModal.amountCents)}
                  </span>
                </div>
              </div>

              {wiseModal.paymentUrl ? (
                <>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        if (wiseModal.paymentUrl) {
                          navigator.clipboard.writeText(wiseModal.paymentUrl);
                          toast.success("Link copiado.");
                        }
                      }}
                    >
                      <Copy className="h-4 w-4" />
                      Copiar
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        if (wiseModal.paymentUrl)
                          window.open(wiseModal.paymentUrl, "_blank", "noopener");
                      }}
                    >
                      <ExternalLink className="h-4 w-4" />
                      Abrir Wise
                    </Button>
                  </div>
                  {wiseModal.customerPhone && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        const phone = (wiseModal.customerPhone ?? "").replace(/\D/g, "");
                        const msg = encodeURIComponent(
                          `Ola ${wiseModal.customerName ?? ""}! Segue o link para pagamento Wise (${money(
                            wiseModal.amountCents,
                          )}) - referencia ${wiseModal.reference}: ${wiseModal.paymentUrl}`,
                        );
                        window.open(`https://wa.me/${phone}?text=${msg}`, "_blank", "noopener");
                      }}
                    >
                      <MessageCircle className="h-4 w-4" />
                      Enviar por WhatsApp
                    </Button>
                  )}
                </>
              ) : (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700">
                  Link Wise nao configurado. Configure em Configuracoes &gt; Wise para gerar o link
                  automaticamente.
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-admin-border">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={recheckWiseMut.isPending}
                  onClick={() => recheckWiseMut.mutate(wiseModal.attemptId)}
                >
                  <RefreshCw className="h-4 w-4" />
                  Verificar agora
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 border-red-brand/40 text-red-brand hover:bg-red-brand/10"
                  disabled={cancelWiseMut.isPending}
                  onClick={() =>
                    cancelWiseMut.mutate({
                      attemptId: wiseModal.attemptId,
                      reason: "Reaberta para edicao",
                    })
                  }
                >
                  <XCircle className="h-4 w-4" />
                  Cancelar/Reabrir
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" className="w-full" onClick={() => setWiseModal(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={successInfo !== null}
        onOpenChange={(open) => {
          if (!open) setSuccessInfo(null);
        }}
      >
        <DialogContent className="sm:max-w-md border-admin-border bg-admin-bg text-admin-ink">
          <DialogHeader className="items-center text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/40 animate-scale-in">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <DialogTitle className="text-xl font-display mt-2">Venda concluída!</DialogTitle>
            <DialogDescription className="text-admin-ink-muted">
              A comanda foi fechada e a venda registrada com sucesso.
            </DialogDescription>
          </DialogHeader>
          {successInfo && (
            <div className="rounded-lg border border-admin-border bg-admin-bg/60 p-4 space-y-2 text-sm animate-fade-in">
              <div className="flex justify-between">
                <span className="text-admin-ink-muted">Comanda</span>
                <span className="font-mono">{successInfo.tabCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-admin-ink-muted">Cliente</span>
                <span className="text-right">{successInfo.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-admin-ink-muted">Pagamento</span>
                <span>{PAYMENT_LABEL[successInfo.paymentMethod]}</span>
              </div>
              <div className="flex justify-between border-t border-admin-border pt-2">
                <span className="text-xs uppercase tracking-widest text-admin-ink-muted">Total</span>
                <span className="font-display text-xl text-admin-accent">
                  {money(successInfo.totalCents)}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full bg-admin-accent text-white"
              onClick={() => setSuccessInfo(null)}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
}
