import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Wine, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BentoCard } from "@/components/admin/BentoCard";
import { CustomerSearchPanel, type PdvCustomer } from "@/components/admin/pdv/CustomerSearchPanel";
import { SaleCatalogGrid, type PdvCatalogItem } from "@/components/admin/pdv/SaleCatalogGrid";
import { SaleCartPanel, type CartLine, type Discount } from "@/components/admin/pdv/SaleCartPanel";
import { SaleSuccessOverlay } from "@/components/admin/pdv/SaleSuccessOverlay";
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
  const [success, setSuccess] = useState<number | null>(null);

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
      if (existing) {
        if (item.track_stock && existing.qty + 1 > item.stock_quantity) {
          toast.error("Estoque insuficiente");
          return prev;
        }
        return prev.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { item, qty: 1 }];
    });
  };

  const handleClose = async (method: "dinheiro" | "cartao", discount: Discount) => {
    if (!customer || cart.length === 0) return;
    setClosing(true);
    try {
      const totalEur = cart.reduce((acc, l) => acc + l.qty * l.item.price_eur_cents, 0);
      const discountEur =
        discount.type === "amount" ? Math.min(Math.round(discount.value * 100), totalEur)
        : discount.type === "percent" ? Math.floor((totalEur * Math.max(0, Math.min(discount.value, 100))) / 100)
        : 0;
      await closeFn({
        data: {
          customerId: customer.id,
          items: cart.map((l) => ({ productId: l.item.id, qty: l.qty })),
          discount: { type: discount.type, value: discount.value },
          paymentMethod: method,
        },
      });
      setSuccess(Math.max(0, totalEur - discountEur));
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
          <p className="text-admin-ink-muted text-sm mt-1">Caixa de balcão · Barbearia · Instituto</p>
        </div>
      </header>

      {!customer ? (
        <BentoCard padded className="p-10">
          <CustomerSearchPanel onSelect={setCustomer} />
        </BentoCard>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          <BentoCard className="col-span-12 lg:col-span-8" padded>
            {catalogQ.isLoading ? (
              <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-admin-accent" /></div>
            ) : (
              <SaleCatalogGrid items={(catalogQ.data ?? []) as unknown as PdvCatalogItem[]} onAdd={handleAdd} />
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

      {success !== null && <SaleSuccessOverlay totalEurCents={success} onReset={reset} />}
    </div>
  );
}
