import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";

export const lookupPassport = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);

    const [profileRes, arrivalsRes, todayApptsRes, nextApptRes, openTabRes, activeOrdersRes] = await Promise.all([
      supabase.from("profiles").select("id, full_name, avatar_url, is_club_member, created_at, phone").eq("id", data.userId).maybeSingle(),
      supabase.from("arrivals").select("id", { count: "exact", head: true }).eq("user_id", data.userId),
      supabase.from("appointments").select("id, starts_at, status, services(title)").eq("user_id", data.userId).gte("starts_at", startOfDay.toISOString()).lt("starts_at", endOfDay.toISOString()).order("starts_at"),
      supabase.from("appointments").select("id, starts_at, status, services(title)").eq("user_id", data.userId).gte("starts_at", now.toISOString()).order("starts_at").limit(1).maybeSingle(),
      supabase.from("tabs").select("id, total_cents, opened_at").eq("user_id", data.userId).eq("status", "aberta").maybeSingle(),
      supabase.from("orders").select("id, service_title, delivery_status").eq("user_id", data.userId).neq("delivery_status", "concluido").limit(10),
    ]);

    if (!profileRes.data) throw new Error("Passaporte não encontrado");

    return {
      profile: profileRes.data,
      visitCount: (arrivalsRes.count ?? 0) + 1,
      todayAppointments: todayApptsRes.data ?? [],
      nextAppointment: nextApptRes.data,
      openTab: openTabRes.data,
      activeServices: activeOrdersRes.data ?? [],
    };
  });

export const registerCheckIn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      userId: z.string().uuid(),
      visitorName: z.string().trim().min(2).max(120),
      purpose: z.string().trim().max(200).optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("arrivals").insert({
      user_id: data.userId,
      visitor_name: data.visitorName,
      purpose: data.purpose ?? "Check-in via passaporte",
      registered_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("products")
      .select("id, slug, name, category, price_cents, emoji, position")
      .eq("is_active", true)
      .order("category")
      .order("position");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const openTab = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const existing = await context.supabase
      .from("tabs").select("id").eq("user_id", data.userId).eq("status", "aberta").maybeSingle();
    if (existing.data) return { tabId: existing.data.id };
    const { data: row, error } = await context.supabase
      .from("tabs")
      .insert({ user_id: data.userId, opened_by: context.userId })
      .select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Erro ao abrir comanda");
    return { tabId: row.id };
  });

export const getTab = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ tabId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [tabRes, itemsRes] = await Promise.all([
      context.supabase.from("tabs").select("*, profiles(full_name, is_club_member, avatar_url)").eq("id", data.tabId).single(),
      context.supabase.from("tab_items").select("*").eq("tab_id", data.tabId).order("created_at"),
    ]);
    if (tabRes.error) throw new Error(tabRes.error.message);
    return { tab: tabRes.data, items: itemsRes.data ?? [] };
  });

export const addTabItem = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      tabId: z.string().uuid(),
      productId: z.string().uuid(),
      qty: z.number().int().min(1).max(20).default(1),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { data: product, error: pErr } = await context.supabase
      .from("products").select("name, emoji, price_cents").eq("id", data.productId).single();
    if (pErr || !product) throw new Error("Produto não encontrado");

    const { data: row, error } = await context.supabase
      .from("tab_items")
      .insert({
        tab_id: data.tabId,
        product_id: data.productId,
        product_name_snapshot: product.name,
        product_emoji: product.emoji,
        qty: data.qty,
        unit_price_cents: product.price_cents,
        added_by: context.userId,
      })
      .select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Erro ao adicionar item");
    return { itemId: row.id };
  });

export const removeTabItem = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ itemId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tab_items").delete().eq("id", data.itemId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const closeTabAsStaff = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      tabId: z.string().uuid(),
      paymentMethod: z.enum(["dinheiro", "cartao", "cliente_app"]),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    if (data.paymentMethod === "cliente_app") {
      return { ok: true, awaitClient: true };
    }
    const { data: tab, error: tErr } = await context.supabase
      .from("tabs").select("total_cents").eq("id", data.tabId).single();
    if (tErr || !tab) throw new Error("Comanda não encontrada");
    const { error } = await context.supabase
      .from("tabs")
      .update({
        status: "paga",
        payment_method: data.paymentMethod,
        paid_cents: tab.total_cents,
        closed_at: new Date().toISOString(),
      })
      .eq("id", data.tabId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
