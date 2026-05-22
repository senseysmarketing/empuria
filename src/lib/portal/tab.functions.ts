import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getMyOpenTab = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    const tabRes = await supabase
      .from("tabs")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "aberta")
      .maybeSingle();
    if (!tabRes.data) return null;
    const itemsRes = await supabase
      .from("tab_items")
      .select("*")
      .eq("tab_id", tabRes.data.id)
      .order("created_at");
    return { tab: tabRes.data, items: itemsRes.data ?? [] };
  });

export const payMyTab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tabId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    const { data: tab, error } = await supabase
      .from("tabs")
      .select("total_cents,user_id,status")
      .eq("id", data.tabId)
      .single();
    if (error || !tab) throw new Error("Comanda não encontrada");
    if (tab.user_id !== userId) throw new Error("Acesso negado");
    if (tab.status !== "aberta") throw new Error("Comanda já fechada");

    if (tab.total_cents <= 0) throw new Error("Comanda sem itens para pagamento");

    const { error: updErr } = await supabaseAdmin
      .from("tabs")
      .update({
        status: "paga",
        payment_method: "app_pix",
        paid_cents: tab.total_cents,
        closed_at: new Date().toISOString(),
      })
      .eq("id", data.tabId)
      .eq("user_id", userId)
      .eq("status", "aberta")
      .select("id")
      .single();
    if (updErr) throw new Error("Nao foi possivel confirmar o pagamento");
    return { ok: true };
  });

export const getMyRecentTabs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    const { data: tabs, error } = await supabase
      .from("tabs")
      .select("id,status,total_cents,paid_cents,payment_method,opened_at,closed_at")
      .eq("user_id", userId)
      .neq("status", "aberta")
      .order("closed_at", { ascending: false, nullsFirst: false })
      .limit(5);
    if (error) throw new Error(error.message);

    const ids = (tabs ?? []).map((tab) => tab.id);
    const { data: items } = ids.length
      ? await supabase
          .from("tab_items")
          .select("id,tab_id,product_name_snapshot,product_emoji,qty,unit_price_cents,discount_cents,benefit_label")
          .in("tab_id", ids)
          .order("created_at", { ascending: true })
      : { data: [] as never[] };

    return { tabs: tabs ?? [], items: items ?? [] };
  });
