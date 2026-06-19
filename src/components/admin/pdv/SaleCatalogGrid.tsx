import { useEffect, useMemo, useState } from "react";
import { Plus, AlertTriangle, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  search = "",
  pageSize = 24,
}: {
  items: PdvCatalogItem[];
  onAdd: (item: PdvCatalogItem) => void;
  pendingProductId?: string | null;
  search?: string;
  pageSize?: number;
}) {
  const [page, setPage] = useState(1);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items),
    [items, q],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [q, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  const grouped = new Map<string, { label: string; items: PdvCatalogItem[] }>();
  for (const it of pageItems) {
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

  if (filtered.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-admin-ink-muted">
        Nenhum item encontrado para "{search}".
      </div>
    );
  }

  const rangeFrom = start + 1;
  const rangeTo = Math.min(start + pageSize, filtered.length);

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
              const isBusy = pendingProductId !== null;
              const isLoadingThis = pendingProductId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => !outOfStock && !isBusy && onAdd(p)}
                  disabled={outOfStock || isBusy}
                  className={cn(
                    "relative bg-admin-surface-2 hover:bg-admin-accent/10 border border-admin-border hover:border-admin-accent rounded-xl p-3 text-left transition-all group",
                    outOfStock && "opacity-40 cursor-not-allowed",
                    isBusy && !isLoadingThis && "opacity-60 cursor-not-allowed",
                  )}
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className="text-2xl">{p.emoji ?? (p.item_type === "servico" ? "🧰" : "📦")}</span>
                    {isLoadingThis ? (
                      <Loader2 className="h-4 w-4 animate-spin text-admin-accent" />
                    ) : (
                      <Plus className="h-4 w-4 text-admin-ink-muted group-hover:text-admin-accent" />
                    )}
                  </div>
                  <div className="font-display text-sm text-admin-ink truncate">{p.name}</div>
                  <div className="text-xs text-admin-accent mt-1 tabular-nums font-display">€ {(p.price_eur_cents / 100).toFixed(2)}</div>
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 border-t border-admin-border">
          <span className="text-xs text-admin-ink-muted tabular-nums">
            Mostrando {rangeFrom}–{rangeTo} de {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-admin-ink tabular-nums px-2">
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
