import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

    const { error: updErr } = await supabase
      .from("tabs")
      .update({
        status: "paga",
        payment_method: "app_pix",
        paid_cents: tab.total_cents,
        closed_at: new Date().toISOString(),
      })
      .eq("id", data.tabId);
    if (updErr) throw new Error(updErr.message);
    return { ok: true };
  });
