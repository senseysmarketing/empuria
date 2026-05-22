import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getPublishedEvent = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ slug: z.string().trim().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const { data: event } = await supabaseAdmin
      .from("events").select("*")
      .eq("slug", data.slug).eq("is_published", true).maybeSingle();
    if (!event) return { event: null, tiers: [] };
    const { data: tiers } = await supabaseAdmin
      .from("event_ticket_tiers").select("*")
      .eq("event_id", event.id).eq("is_active", true).order("position");
    return { event, tiers: tiers ?? [] };
  });

export const listPublishedEvents = createServerFn({ method: "GET" })
  .handler(async () => {
    const { data: events } = await supabaseAdmin
      .from("events").select("id,slug,title,starts_at,cover_url,location_address")
      .eq("is_published", true)
      .gte("starts_at", new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString())
      .order("starts_at");
    return events ?? [];
  });

export const listHomeEvents = createServerFn({ method: "GET" })
  .handler(async () => {
    const nowIso = new Date().toISOString();
    const [{ data: upcoming }, { data: past }] = await Promise.all([
      supabaseAdmin
        .from("events")
        .select("id,slug,title,starts_at,cover_url,location_address")
        .eq("is_published", true)
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(3),
      supabaseAdmin
        .from("events")
        .select("id,slug,title,starts_at,cover_url,location_address")
        .eq("is_published", true)
        .lt("starts_at", nowIso)
        .order("starts_at", { ascending: false })
        .limit(12),
    ]);
    return { upcoming: upcoming ?? [], past: past ?? [] };
  });

const generateCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

export const confirmTicketPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    tierId: z.string().uuid(),
    qty: z.number().int().min(1).max(10),
    contact: z.object({
      name: z.string().trim().min(2).max(120),
      whatsapp: z.string().trim().min(6).max(40),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.effectiveUserId ?? context.userId;

    const { data: tier } = await supabaseAdmin
      .from("event_ticket_tiers").select("*, events!inner(*)").eq("id", data.tierId).maybeSingle();
    if (!tier) throw new Error("Categoria não encontrada");
    const event = (tier as unknown as { events: { id: string; is_published: boolean; title: string } }).events;
    if (!event?.is_published) throw new Error("Evento indisponível");
    if (tier.capacity != null && tier.sold + data.qty > tier.capacity) {
      throw new Error("Capacidade insuficiente para essa quantidade");
    }

    // Update profile
    await supabaseAdmin.from("profiles").update({
      full_name: data.contact.name,
      phone: data.contact.whatsapp,
    }).eq("id", userId);

    // Create one order (free or paid auto-approved for mock)
    const amount = tier.price_cents * data.qty;
    const { data: order, error: orderErr } = await supabaseAdmin.from("orders").insert({
      user_id: userId,
      customer_name: data.contact.name,
      service_title: `${event.title} · ${tier.name} × ${data.qty}`,
      amount_cents: amount,
      payment_status: amount === 0 ? "aprovado" : "aprovado", // mocked
      delivery_status: "concluido",
      service_metadata: {
        kind: "event_ticket",
        event_id: event.id,
        tier_id: tier.id,
        qty: data.qty,
        whatsapp: data.contact.whatsapp,
      },
    }).select("id").single();
    if (orderErr) throw new Error(orderErr.message);

    // Create tickets
    const rows = Array.from({ length: data.qty }).map(() => ({
      event_id: event.id,
      tier_id: tier.id,
      user_id: userId,
      order_id: order!.id,
      code: generateCode() + Math.random().toString(36).slice(2, 4).toUpperCase(),
      status: "valido" as const,
    }));
    const { error: tErr } = await supabaseAdmin.from("event_tickets").insert(rows);
    if (tErr) throw new Error(tErr.message);

    return { ok: true, orderId: order!.id, qty: data.qty, free: amount === 0 };
  });

export const getMyTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    const { data: tickets } = await supabase
      .from("event_tickets").select("id,event_id,tier_id,status,checked_in_at,code,created_at")
      .eq("user_id", userId).order("created_at", { ascending: false });
    const list = tickets ?? [];
    const eventIds = Array.from(new Set(list.map((t) => t.event_id)));
    const tierIds = Array.from(new Set(list.map((t) => t.tier_id)));
    const [{ data: events }, { data: tiers }] = await Promise.all([
      eventIds.length
        ? supabase.from("events").select("id,slug,title,starts_at,ends_at,cover_url,location_address").in("id", eventIds)
        : Promise.resolve({ data: [] as never[] }),
      tierIds.length
        ? supabase.from("event_ticket_tiers").select("id,name,benefits").in("id", tierIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    return {
      tickets: list,
      events: events ?? [],
      tiers: tiers ?? [],
    };
  });
