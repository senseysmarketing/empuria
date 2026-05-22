import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyOpenTab, getMyRecentTabs, payMyTab } from "@/lib/portal/tab.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Receipt, Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function TabWidget({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const fetchTab = useServerFn(getMyOpenTab);
  const fetchHistory = useServerFn(getMyRecentTabs);
  const pay = useServerFn(payMyTab);
  const [paying, setPaying] = useState(false);

  const { data } = useQuery({
    queryKey: ["my-open-tab", userId],
    queryFn: () => fetchTab(),
  });
  const historyQ = useQuery({
    queryKey: ["my-tab-history", userId],
    queryFn: () => fetchHistory(),
  });

  useEffect(() => {
    if (!userId) return;
    const tabId = data?.tab.id;
    let ch = supabase
      .channel(`my-tab-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tabs", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["my-open-tab", userId] });
          qc.invalidateQueries({ queryKey: ["my-tab-history", userId] });
        },
      );
    if (tabId) {
      ch = ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tab_items", filter: `tab_id=eq.${tabId}` },
        () => qc.invalidateQueries({ queryKey: ["my-open-tab", userId] }),
      );
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc, data?.tab.id]);

  if (!data) {
    const recent = historyQ.data?.tabs ?? [];
    if (recent.length === 0) return null;
    return (
      <div className="col-span-12 rounded-2xl border border-admin-border bg-admin-surface p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-9 w-9 rounded-lg bg-admin-surface-2 text-admin-accent flex items-center justify-center">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest font-display text-admin-ink-muted">Ultimos consumos</div>
            <div className="font-display text-lg text-admin-ink">Comandas recentes</div>
          </div>
        </div>
        <ul className="space-y-2">
          {recent.map((tab) => {
            const items = (historyQ.data?.items ?? []).filter((item) => item.tab_id === tab.id);
            return (
              <li key={tab.id} className="flex items-start justify-between gap-3 border-t border-admin-border pt-2 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  <div className="text-sm text-admin-ink truncate">
                    {items.length ? items.map((item) => `${item.qty}x ${item.product_name_snapshot}`).join(", ") : "Comanda"}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-admin-ink-muted font-display">
                    {tab.status === "paga" ? "Pago" : "Cancelado"} - {tab.closed_at ? new Date(tab.closed_at).toLocaleDateString("pt-BR") : "-"}
                  </div>
                </div>
                <span className="text-sm font-display tabular-nums text-admin-ink">
                  € {((tab.paid_cents || tab.total_cents) / 100).toFixed(2)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const { tab, items } = data;

  const handlePay = async () => {
    setPaying(true);
    try {
      await pay({ data: { tabId: tab.id } });
      toast.success("Pagamento confirmado");
      qc.invalidateQueries({ queryKey: ["my-open-tab", userId] });
      qc.invalidateQueries({ queryKey: ["my-tab-history", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="col-span-12 relative overflow-hidden rounded-2xl border-2 border-yellow-brand bg-gradient-to-br from-yellow-brand/20 via-yellow-brand/10 to-orange-brand/10 p-5 animate-in fade-in slide-in-from-top-4">
      <div className="absolute top-3 right-3">
        <Sparkles className="h-5 w-5 text-yellow-brand animate-pulse" />
      </div>
      <div className="flex items-center gap-2 mb-3">
        <div className="h-9 w-9 rounded-lg bg-yellow-brand text-brown-deep flex items-center justify-center">
          <Receipt className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest font-display text-admin-ink-muted">Sua Comanda</div>
          <div className="font-display text-lg text-admin-ink">na Gran Via - ao vivo</div>
        </div>
      </div>

      <ul className="space-y-1.5 mb-4 max-h-48 overflow-y-auto">
        {items.length === 0 ? (
          <li className="text-xs text-admin-ink-muted italic">A equipe esta preparando sua comanda...</li>
        ) : items.map((it) => {
          const subtotal = it.qty * it.unit_price_cents - it.discount_cents;
          const free = it.discount_cents >= it.qty * it.unit_price_cents;
          return (
            <li key={it.id} className="flex items-center gap-2 text-sm">
              <span className="text-base">{it.product_emoji}</span>
              <span className={`flex-1 truncate ${free ? "line-through text-admin-ink-muted" : "text-admin-ink"}`}>
                {it.qty}x {it.product_name_snapshot}
              </span>
              {it.benefit_label && (
                <span className="text-[10px] text-green-600 dark:text-green-400 font-display uppercase tracking-wider flex items-center gap-0.5">
                  <CheckCircle2 className="h-3 w-3" /> {it.benefit_label}
                </span>
              )}
              <span className={`text-sm tabular-nums font-display ${free ? "text-green-600" : "text-admin-ink"}`}>
                {free ? "Cortesia" : `€ ${(subtotal / 100).toFixed(2)}`}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex items-end justify-between pt-3 border-t border-yellow-brand/40">
        <div>
          <div className="text-[10px] uppercase tracking-widest font-display text-admin-ink-muted">Total</div>
          <div className="font-display text-3xl font-bold text-admin-ink tabular-nums">€ {(tab.total_cents / 100).toFixed(2)}</div>
        </div>
        <Button
          onClick={handlePay}
          disabled={paying || tab.total_cents === 0}
          className="bg-orange-brand hover:bg-red-brand text-offwhite h-12 px-6 font-display"
        >
          {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : `Pagar Comanda - € ${(tab.total_cents / 100).toFixed(2)}`}
        </Button>
      </div>
    </div>
  );
}
