import { useMemo, useState } from "react";
import { Trash2, Minus, Plus, X, Banknote, CreditCard, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import type { PdvCatalogItem } from "./SaleCatalogGrid";
import type { PdvCustomer } from "./CustomerSearchPanel";

export type CartLine = { item: PdvCatalogItem; qty: number };
export type Discount = { type: "none" | "amount" | "percent"; value: number };
export type PaymentMethod = "dinheiro" | "cartao" | "pix";

export function SaleCartPanel({
  customer,
  cart,
  setCart,
  onChangeCustomer,
  onClose,
  closing,
}: {
  customer: PdvCustomer;
  cart: CartLine[];
  setCart: (next: CartLine[]) => void;
  onChangeCustomer: () => void;
  onClose: (method: "dinheiro" | "cartao", discount: Discount) => void;
  closing: boolean;
}) {
  const [discount, setDiscount] = useState<Discount>({ type: "none", value: 0 });

  const subtotal = useMemo(
    () => cart.reduce(
      (acc, l) => ({
        eur: acc.eur + l.qty * l.item.price_eur_cents,
        brl: acc.brl + l.qty * l.item.price_brl_cents,
      }),
      { eur: 0, brl: 0 }
    ),
    [cart]
  );

  const discountCents = useMemo(() => {
    if (discount.type === "amount") {
      const eur = Math.min(Math.round(discount.value * 100), subtotal.eur);
      const brl = Math.min(Math.round(discount.value * 100), subtotal.brl);
      return { eur, brl };
    }
    if (discount.type === "percent") {
      const pct = Math.max(0, Math.min(discount.value, 100));
      return {
        eur: Math.floor((subtotal.eur * pct) / 100),
        brl: Math.floor((subtotal.brl * pct) / 100),
      };
    }
    return { eur: 0, brl: 0 };
  }, [discount, subtotal]);

  const total = {
    eur: Math.max(0, subtotal.eur - discountCents.eur),
    brl: Math.max(0, subtotal.brl - discountCents.brl),
  };

  const updateQty = (id: string, delta: number) => {
    setCart(
      cart
        .map((l) => (l.item.id === id ? { ...l, qty: Math.max(0, l.qty + delta) } : l))
        .filter((l) => l.qty > 0)
    );
  };

  const remove = (id: string) => setCart(cart.filter((l) => l.item.id !== id));

  const cantPay = cart.length === 0 || closing || total.brl === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="pb-3 border-b border-admin-border flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-admin-ink-muted font-display">Cliente</div>
          <div className="font-display text-lg text-admin-ink truncate">{customer.full_name ?? "Sem nome"}</div>
          {customer.phone && <div className="text-xs text-admin-ink-muted truncate">{customer.phone}</div>}
        </div>
        <Button variant="ghost" size="sm" onClick={onChangeCustomer} className="text-admin-ink-muted">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 py-3 space-y-2 overflow-y-auto max-h-[50vh]">
        {cart.length === 0 ? (
          <p className="text-xs text-admin-ink-muted text-center py-6">Adicione itens do catálogo →</p>
        ) : cart.map((l) => (
          <div key={l.item.id} className="flex items-start gap-2 group">
            <span className="text-xl">{l.item.emoji ?? "📦"}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-admin-ink truncate">{l.item.name}</div>
              <div className="flex items-center gap-1 mt-1">
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => updateQty(l.item.id, -1)}><Minus className="h-3 w-3" /></Button>
                <span className="text-xs tabular-nums w-6 text-center">{l.qty}</span>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => updateQty(l.item.id, +1)}><Plus className="h-3 w-3" /></Button>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-display tabular-nums text-admin-ink">R$ {((l.qty * l.item.price_brl_cents) / 100).toFixed(2)}</div>
            </div>
            <button onClick={() => remove(l.item.id)} className="text-admin-ink-muted hover:text-red-brand opacity-0 group-hover:opacity-100">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="pt-3 border-t border-admin-border space-y-3">
        <div className="grid grid-cols-[110px_1fr] gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-admin-ink-muted">Desconto</Label>
            <Select
              value={discount.type}
              onValueChange={(v) => setDiscount({ type: v as Discount["type"], value: 0 })}
            >
              <SelectTrigger className="bg-admin-bg border-admin-border h-9"><SelectValue /></SelectTrigger>
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
            onChange={(e) => setDiscount({ ...discount, value: parseFloat(e.target.value || "0") })}
            className="bg-admin-bg border-admin-border h-9"
            placeholder="0,00"
          />
        </div>

        {discountCents.brl > 0 && (
          <div className="flex justify-between text-xs text-admin-ink-muted">
            <span>Subtotal</span>
            <span className="tabular-nums">R$ {(subtotal.brl / 100).toFixed(2)}</span>
          </div>
        )}
        {discountCents.brl > 0 && (
          <div className="flex justify-between text-xs text-yellow-brand">
            <span>Desconto</span>
            <span className="tabular-nums">− R$ {(discountCents.brl / 100).toFixed(2)}</span>
          </div>
        )}

        <div className="flex justify-between items-baseline">
          <span className="text-xs uppercase tracking-widest font-display text-admin-ink-muted">Total</span>
          <div className="text-right">
            <div className="font-display text-3xl font-bold text-admin-accent tabular-nums">R$ {(total.brl / 100).toFixed(2)}</div>
            {total.eur > 0 && <div className="text-xs text-admin-ink-muted tabular-nums">€ {(total.eur / 100).toFixed(2)}</div>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            disabled={cantPay}
            onClick={() => onClose("dinheiro", discount)}
            className="h-12 font-display text-base"
          >
            Dinheiro
          </Button>
          <Button
            disabled={cantPay}
            onClick={() => onClose("cartao", discount)}
            className="h-12 font-display text-base bg-admin-accent text-white"
          >
            Cartão
          </Button>
        </div>
      </div>
    </div>
  );
}
