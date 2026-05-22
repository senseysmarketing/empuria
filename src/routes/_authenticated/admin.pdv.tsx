import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  listProducts, getTab, addTabItem, removeTabItem, closeTabAsStaff, openTab, lookupPassport,
} from "@/lib/admin/pdv.functions";
import { supabase } from "@/integrations/supabase/client";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PassportScannerDialog } from "@/components/admin/PassportScannerDialog";
import { Trash2, Wine, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({ tab: z.string().uuid().optional() });

export const Route = createFileRoute("/_authenticated/admin/pdv")({
  validateSearch: searchSchema,
  component: PdvPage,
});

const CATEGORY_LABELS: Record<string, string> = {
  bebida: "🍷 Bebidas",
  comida: "🥐 Comida",
  barbearia: "💈 Barbearia",
  outro: "✨ Outros",
};

function PdvPage() {
  const { tab: tabIdSearch } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const productsQ = useQuery({ queryKey: ["pdv-products"], queryFn: () => listProducts() });
  const tabQ = useQuery({
    queryKey: ["pdv-tab", tabIdSearch],
    queryFn: () => getTab({ data: { tabId: tabIdSearch! } }),
    enabled: !!tabIdSearch,
  });

  // Realtime subscription on tab items
  useEffect(() => {
    if (!tabIdSearch) return;
    const ch = supabase
      .channel(`pdv-tab-${tabIdSearch}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tab_items", filter: `tab_id=eq.${tabIdSearch}` },
        () => qc.invalidateQueries({ queryKey: ["pdv-tab", tabIdSearch] }))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tabs", filter: `id=eq.${tabIdSearch}` },
        () => qc.invalidateQueries({ queryKey: ["pdv-tab", tabIdSearch] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tabIdSearch, qc]);

  const addFn = useServerFn(addTabItem);
  const rmFn = useServerFn(removeTabItem);
  const closeFn = useServerFn(closeTabAsStaff);

  type Product = NonNullable<typeof productsQ.data>[number];
  const grouped: Record<string, Product[]> = {};
  for (const p of (productsQ.data ?? []) as Product[]) {
    (grouped[p.category] ??= []).push(p);
  }

  const tab = tabQ.data?.tab;
  const items = tabQ.data?.items ?? [];

  const handleAdd = async (productId: string) => {
    if (!tabIdSearch) { toast.error("Abra uma comanda primeiro"); return; }
    try { await addFn({ data: { tabId: tabIdSearch, productId, qty: 1 } }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  };

  const handleClose = async (method: "dinheiro" | "cartao" | "cliente_app") => {
    if (!tabIdSearch) return;
    try {
      const r = await closeFn({ data: { tabId: tabIdSearch, paymentMethod: method } });
      if (r.awaitClient) {
        toast.success("Aguardando pagamento do cliente no app");
      } else {
        toast.success("Comanda fechada");
        navigate({ to: "/admin/pdv", search: {} });
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-orange-brand/20 flex items-center justify-center">
            <Wine className="h-6 w-6 text-orange-brand" />
          </div>
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">PDV Empuria</h1>
            <p className="text-admin-ink-muted text-sm mt-1">Comanda digital · Bar · Barbearia · Gran Vía</p>
          </div>
        </div>
        <PassportScannerDialog />
      </header>

      <div className="grid grid-cols-12 gap-4">
        <BentoCard className="col-span-12 lg:col-span-8" padded>
          {productsQ.isLoading ? (
            <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-admin-accent" /></div>
          ) : (
            <div className="space-y-6">
              {Object.entries(grouped).map(([cat, prods]) => (
                <div key={cat}>
                  <h3 className="font-display text-sm uppercase tracking-wider text-admin-ink-soft mb-3">{CATEGORY_LABELS[cat] ?? cat}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {prods.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleAdd(p.id)}
                        disabled={!tabIdSearch}
                        className="bg-admin-surface-2 hover:bg-admin-accent/10 border border-admin-border hover:border-admin-accent disabled:opacity-40 disabled:cursor-not-allowed rounded-xl p-4 text-left transition-all group"
                      >
                        <div className="text-3xl mb-1">{p.emoji}</div>
                        <div className="font-display text-sm text-admin-ink truncate">{p.name}</div>
                        <div className="text-xs text-admin-accent mt-1 tabular-nums font-display">€ {(p.price_cents / 100).toFixed(2)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </BentoCard>

        <BentoCard className="col-span-12 lg:col-span-4" padded>
          {!tabIdSearch ? (
            <EmptyTabPanel />
          ) : tabQ.isLoading || !tab ? (
            <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-admin-accent" /></div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="pb-3 border-b border-admin-border">
                <div className="text-[10px] uppercase tracking-widest text-admin-ink-muted font-display">Comanda de</div>
                <div className="font-display text-lg text-admin-ink">{(tab as { profiles?: { full_name?: string } }).profiles?.full_name ?? "Membro"}</div>
                {(tab as { profiles?: { is_club_member?: boolean } }).profiles?.is_club_member && (
                  <span className="inline-block mt-1 text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-yellow-brand text-brown-deep font-display">Clube</span>
                )}
              </div>

              <div className="flex-1 py-3 space-y-2 overflow-y-auto max-h-96">
                {items.length === 0 ? (
                  <p className="text-xs text-admin-ink-muted text-center py-6">Adicione produtos do catálogo →</p>
                ) : items.map((it) => {
                  const subtotal = it.qty * it.unit_price_cents - it.discount_cents;
                  return (
                    <div key={it.id} className="flex items-start gap-2 group">
                      <span className="text-xl">{it.product_emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-admin-ink truncate">
                          {it.qty}× {it.product_name_snapshot}
                        </div>
                        {it.benefit_label && (
                          <div className="text-[10px] text-green-500 font-display uppercase tracking-wider flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> {it.benefit_label}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        {it.discount_cents > 0 && (
                          <div className="text-[10px] text-admin-ink-muted line-through tabular-nums">€ {(it.qty * it.unit_price_cents / 100).toFixed(2)}</div>
                        )}
                        <div className="text-sm font-display tabular-nums text-admin-ink">€ {(subtotal / 100).toFixed(2)}</div>
                      </div>
                      <button
                        onClick={() => rmFn({ data: { itemId: it.id } })}
                        className="text-admin-ink-muted hover:text-red-brand opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-admin-border space-y-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs uppercase tracking-widest font-display text-admin-ink-muted">Total</span>
                  <span className="font-display text-3xl font-bold text-admin-accent tabular-nums">€ {(tab.total_cents / 100).toFixed(2)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleClose("dinheiro")} disabled={items.length === 0}>Dinheiro</Button>
                  <Button size="sm" variant="outline" onClick={() => handleClose("cartao")} disabled={items.length === 0}>Cartão</Button>
                  <Button size="sm" onClick={() => handleClose("cliente_app")} disabled={items.length === 0} className="bg-yellow-brand text-brown-deep hover:bg-yellow-brand/80">App</Button>
                </div>
              </div>
            </div>
          )}
        </BentoCard>
      </div>
    </div>
  );
}

function EmptyTabPanel() {
  const navigate = useNavigate();
  const lookup = useServerFn(lookupPassport);
  const openFn = useServerFn(openTab);
  const [id, setId] = useState("");

  const go = async () => {
    let userId = id.trim();
    if (userId.startsWith("empuria:")) userId = userId.slice(8);
    try {
      await lookup({ data: { userId } });
      const { tabId } = await openFn({ data: { userId } });
      navigate({ to: "/admin/pdv", search: { tab: tabId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <div className="text-center py-8 space-y-4">
      <Wine className="h-10 w-10 mx-auto text-admin-ink-muted" />
      <p className="text-sm text-admin-ink-muted">Escaneie um passaporte ou cole o ID</p>
      <div className="flex gap-2">
        <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="empuria:uuid" className="bg-admin-surface-2 border-admin-border text-xs" />
        <Button size="sm" onClick={go}>Abrir</Button>
      </div>
      <PassportScannerDialog />
    </div>
  );
}
