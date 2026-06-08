import { Plus, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type PdvCatalogItem = {
  id: string;
  name: string;
  emoji: string | null;
  price_eur_cents: number;
  price_brl_cents: number;
  stock_quantity: number;
  reserved_stock_quantity?: number;
  available_stock_quantity?: number;
  track_stock: boolean;
  stock_min_quantity: number;
  item_type: string;
  category_id: string | null;
  product_categories?: { id: string; name: string; emoji: string | null } | null;
};

export function SaleCatalogGrid({
  items,
  onAdd,
  pendingProductId = null,
}: {
  items: PdvCatalogItem[];
  onAdd: (item: PdvCatalogItem) => void;
  pendingProductId?: string | null;
}) {
  const grouped = new Map<string, { label: string; items: PdvCatalogItem[] }>();
  for (const it of items) {
    const key = it.product_categories?.id ?? "uncat";
    const label = it.product_categories
      ? `${it.product_categories.emoji ?? ""} ${it.product_categories.name}`.trim()
      : "Sem categoria";
    if (!grouped.has(key)) grouped.set(key, { label, items: [] });
    grouped.get(key)!.items.push(it);
  }

  if (items.length === 0) {
    return <div className="p-8 text-center text-sm text-admin-ink-muted">Nenhum item cadastrado no PDV.</div>;
  }

  return (
    <div className="space-y-6">
      {Array.from(grouped.values()).map((group) => (
        <div key={group.label}>
          <h3 className="font-display text-xs uppercase tracking-wider text-admin-ink-soft mb-3">{group.label}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
            {group.items.map((p) => {
              const available = p.available_stock_quantity ?? Math.max(0, p.stock_quantity - (p.reserved_stock_quantity ?? 0));
              const outOfStock = p.track_stock && available <= 0;
              const low = p.track_stock && available > 0 && available <= p.stock_min_quantity;
              return (
                <button
                  key={p.id}
                  onClick={() => !outOfStock && onAdd(p)}
                  disabled={outOfStock}
                  className={cn(
                    "relative bg-admin-surface-2 hover:bg-admin-accent/10 border border-admin-border hover:border-admin-accent rounded-xl p-3 text-left transition-all group",
                    outOfStock && "opacity-40 cursor-not-allowed"
                  )}
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className="text-2xl">{p.emoji ?? (p.item_type === "servico" ? "🧰" : "📦")}</span>
                    <Plus className="h-4 w-4 text-admin-ink-muted group-hover:text-admin-accent" />
                  </div>
                  <div className="font-display text-sm text-admin-ink truncate">{p.name}</div>
                  <div className="text-xs text-admin-accent mt-1 tabular-nums font-display">R$ {(p.price_brl_cents / 100).toFixed(2)}</div>
                  {p.price_eur_cents > 0 && (
                    <div className="text-[10px] text-admin-ink-muted tabular-nums">€ {(p.price_eur_cents / 100).toFixed(2)}</div>
                  )}
                  {p.track_stock && (
                    <div className={cn(
                      "text-[10px] mt-1 font-display tracking-wider uppercase flex items-center gap-1",
                      outOfStock ? "text-red-400" : low ? "text-yellow-brand" : "text-admin-ink-muted"
                    )}>
                      {(outOfStock || low) && <AlertTriangle className="h-3 w-3" />}
                      Disp: {available}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
