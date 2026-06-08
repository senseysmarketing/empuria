import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Wine, Loader2, History, ShoppingCart, Package, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { BentoCard } from "@/components/admin/BentoCard";
import { CustomerSearchPanel, type PdvCustomer } from "@/components/admin/pdv/CustomerSearchPanel";
import { SaleCatalogGrid, type PdvCatalogItem } from "@/components/admin/pdv/SaleCatalogGrid";
import { SaleCartPanel, type CartLine, type Discount } from "@/components/admin/pdv/SaleCartPanel";
import { SaleSuccessOverlay } from "@/components/admin/pdv/SaleSuccessOverlay";
import { PdvHistoryPanel } from "@/components/admin/pdv/PdvHistoryPanel";
import { PdvTabsPanel } from "@/components/admin/pdv/PdvTabsPanel";
import { PdvItensTab } from "@/components/admin/configuracoes/PdvItensTab";
import { RestrictedAreaCard } from "@/components/admin/RestrictedAreaCard";
import { useModuleAccess } from "@/hooks/use-module-access";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listPdvCatalog, closePdvSale } from "@/lib/admin/pdv-sales.functions";

export const Route = createFileRoute("/_authenticated/admin/pdv")({
  component: PdvPage,
});

function PdvPage() {
  const fetchCatalog = useServerFn(listPdvCatalog);
  const closeFn = useServerFn(closePdvSale);
  const [customer, setCustomer] = useState<PdvCustomer | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [closing, setClosing] = useState(false);
  const [success, setSuccess] = useState<{ brl: number; eur: number } | null>(null);
  const [tab, setTab] = useState("venda");
  const { can, isAdmin } = useModuleAccess();
  const canItens = isAdmin || can("pdv_itens");

  const catalogQ = useQuery({
    queryKey: ["pdv-catalog"],
    queryFn: () => fetchCatalog(),
    enabled: !!customer,
  });

  const reset = () => {
    setCustomer(null);
    setCart([]);
    setSuccess(null);
  };

  const handleAdd = (item: PdvCatalogItem) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      const available =
        item.available_stock_quantity ??
        Math.max(0, item.stock_quantity - (item.reserved_stock_quantity ?? 0));
      if (existing) {
        if (item.track_stock && existing.qty + 1 > available) {
          toast.error("Estoque insuficiente");
          return prev;
        }
        return prev.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      }
      if (item.track_stock && available <= 0) {
        toast.error("Estoque insuficiente");
        return prev;
      }
      return [...prev, { item, qty: 1 }];
    });
  };

  const handleClose = async (method: "dinheiro" | "cartao" | "pix", discount: Discount) => {
    if (!customer || cart.length === 0) return;
    setClosing(true);
    try {
      const totalEur = cart.reduce((acc, l) => acc + l.qty * l.item.price_eur_cents, 0);
      const totalBrl = cart.reduce((acc, l) => acc + l.qty * l.item.price_brl_cents, 0);
      const pct = Math.max(0, Math.min(discount.value, 100));
      const discountEur =
        discount.type === "amount"
          ? Math.min(Math.round(discount.value * 100), totalEur)
          : discount.type === "percent"
            ? Math.floor((totalEur * pct) / 100)
            : 0;
      const discountBrl =
        discount.type === "amount"
          ? Math.min(Math.round(discount.value * 100), totalBrl)
          : discount.type === "percent"
            ? Math.floor((totalBrl * pct) / 100)
            : 0;
      await closeFn({
        data: {
          customerId: customer.id,
          items: cart.map((l) => ({ productId: l.item.id, qty: l.qty })),
          discount: { type: discount.type, value: discount.value },
          paymentMethod: method,
        },
      });
      setSuccess({
        brl: Math.max(0, totalBrl - discountBrl),
        eur: Math.max(0, totalEur - discountEur),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao fechar venda");
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-orange-brand/20 flex items-center justify-center">
          <Wine className="h-6 w-6 text-orange-brand" />
        </div>
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">PDV Empuria</h1>
          <p className="text-admin-ink-muted text-sm mt-1">
            Caixa de balcão · Barbearia · Instituto
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="bg-admin-surface border border-admin-border">
          <TabsTrigger
            value="venda"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <ShoppingCart className="h-4 w-4" /> Venda
          </TabsTrigger>
          <TabsTrigger
            value="comandas"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <ReceiptText className="h-4 w-4" /> Comandas
          </TabsTrigger>
          <TabsTrigger
            value="historico"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <History className="h-4 w-4" /> Historico
          </TabsTrigger>
          {canItens && (
            <TabsTrigger
              value="itens"
              className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
            >
              <Package className="h-4 w-4" /> Itens
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="venda" className="mt-0">
          {!customer ? (
            <BentoCard padded className="p-10">
              <CustomerSearchPanel onSelect={setCustomer} />
            </BentoCard>
          ) : (
            <div className="grid grid-cols-12 gap-4">
              <BentoCard className="col-span-12 lg:col-span-8" padded>
                {catalogQ.isLoading ? (
                  <div className="flex items-center justify-center h-40">
                    <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
                  </div>
                ) : (
                  <SaleCatalogGrid
                    items={(catalogQ.data ?? []) as unknown as PdvCatalogItem[]}
                    onAdd={handleAdd}
                  />
                )}
              </BentoCard>
              <BentoCard className="col-span-12 lg:col-span-4" padded>
                <SaleCartPanel
                  customer={customer}
                  cart={cart}
                  setCart={setCart}
                  onChangeCustomer={reset}
                  onClose={handleClose}
                  closing={closing}
                />
              </BentoCard>
            </div>
          )}
        </TabsContent>

        <TabsContent value="historico" className="mt-0">
          <PdvHistoryPanel />
        </TabsContent>

        <TabsContent value="comandas" className="mt-0">
          <PdvTabsPanel />
        </TabsContent>

        <TabsContent value="itens" className="mt-0">
          {canItens ? (
            <PdvItensTab />
          ) : (
            <RestrictedAreaCard message="Apenas membros com acesso ao módulo PDV Itens podem gerenciar este catálogo." />
          )}
        </TabsContent>
      </Tabs>

      {success !== null && <SaleSuccessOverlay totalBrlCents={success.brl} totalEurCents={success.eur} onReset={reset} />}
    </div>
  );
}
