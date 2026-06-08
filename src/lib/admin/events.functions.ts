import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";

const tierSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  price_cents: z.number().int().min(0).max(10_000_00),
  capacity: z.number().int().min(1).max(100_000).nullable().optional(),
  benefits: z.array(z.string().min(1).max(80)).max(20).default([]),
  position: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});

const eventSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().trim().max(120).regex(/^[a-z0-9-]*$/, "slug inválido").optional().or(z.literal("")),
  title: z.string().trim().min(2).max(160),
  description: z.string().max(8000).optional().nullable(),
  starts_at: z.string(),
  ends_at: z.string().optional().nullable(),
  location_address: z.string().max(300).optional().nullable(),
  location_lat: z.number().nullable().optional(),
  location_lng: z.number().nullable().optional(),
  cover_url: z.string().url().optional().nullable().or(z.literal("")),
  cover_kind: z.enum(["image", "video"]).default("image"),
  sales_mode: z.enum(["simples", "categorias"]).default("simples"),
  is_published: z.boolean().default(false),
  tiers: z.array(tierSchema).min(1).max(20),
});

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 100) || `evento-${Date.now().toString(36)}`
  );
}

export const listEventsAdmin = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { data: events } = await context.supabase
      .from("events")
      .select("*")
      .order("starts_at", { ascending: false });
    const ids = (events ?? []).map((e) => e.id);
    const { data: tiers } = ids.length
      ? await context.supabase
          .from("event_ticket_tiers")
          .select("*")
          .in("event_id", ids)
          .order("position")
      : { data: [] as never[] };
    return { events: events ?? [], tiers: tiers ?? [] };
  });

export const listWeekEvents = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ weekStart: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const start = new Date(data.weekStart);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const { data: events } = await context.supabase
      .from("events")
      .select("id,slug,title,starts_at,ends_at,is_published,cover_url")
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at", { ascending: true });
    return events ?? [];
  });

export const getEventAdmin = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: event } = await context.supabase
      .from("events").select("*").eq("id", data.id).maybeSingle();
    if (!event) throw new Error("Evento não encontrado");
    const { data: tiers } = await context.supabase
      .from("event_ticket_tiers").select("*").eq("event_id", data.id).order("position");
    const { data: tickets } = await context.supabase
      .from("event_tickets").select("id,user_id,tier_id,status,checked_in_at,created_at,code")
      .eq("event_id", data.id).order("created_at", { ascending: false });
    return { event, tiers: tiers ?? [], tickets: tickets ?? [] };
  });

export const upsertEvent = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => eventSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { tiers, id, ...eventData } = data;
    const payload = {
      ...eventData,
      cover_url: eventData.cover_url || null,
      ends_at: eventData.ends_at || null,
      description: eventData.description || null,
      location_address: eventData.location_address || null,
    };

    let eventId = id;
    if (id) {
      const { error } = await context.supabase.from("events").update(payload).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await context.supabase
        .from("events").insert({ ...payload, created_by: context.userId }).select("id").single();
      if (error || !created) throw new Error(error?.message ?? "Erro");
      eventId = created.id;
    }

    // Sync tiers: simple strategy — fetch existing, upsert by id, delete missing
    const { data: existingTiers } = await context.supabase
      .from("event_ticket_tiers").select("id").eq("event_id", eventId!);
    const keepIds = new Set(tiers.filter((t) => t.id).map((t) => t.id!));
    const toDelete = (existingTiers ?? []).map((t) => t.id).filter((tid) => !keepIds.has(tid));

    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const tierPayload = {
        event_id: eventId!,
        name: t.name,
        price_cents: t.price_cents,
        capacity: t.capacity ?? null,
        benefits: t.benefits,
        position: i,
        is_active: t.is_active,
      };
      if (t.id) {
        await context.supabase.from("event_ticket_tiers").update(tierPayload).eq("id", t.id);
      } else {
        await context.supabase.from("event_ticket_tiers").insert(tierPayload);
      }
    }
    if (toDelete.length) {
      await context.supabase.from("event_ticket_tiers").delete().in("id", toDelete);
    }
    return { id: eventId };
  });

export const deleteEvent = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("events").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const validateEventTicket = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({
    eventId: z.string().uuid(),
    userId: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: profile }, { data: tickets }, { data: tiers }] = await Promise.all([
      context.supabase.from("profiles").select("id,full_name,avatar_url").eq("id", data.userId).maybeSingle(),
      context.supabase.from("event_tickets")
        .select("id,tier_id,status,checked_in_at,notes,code")
        .eq("event_id", data.eventId).eq("user_id", data.userId),
      context.supabase.from("event_ticket_tiers").select("id,name,benefits").eq("event_id", data.eventId),
    ]);
    if (!profile) return { ok: false, reason: "Usuário não encontrado" as const };
    const list = tickets ?? [];
    if (!list.length) return { ok: false, reason: "Ingresso não encontrado para este evento" as const };
    return {
      ok: true as const,
      profile,
      tickets: list.map((t) => ({
        ...t,
        tier: (tiers ?? []).find((x) => x.id === t.tier_id) ?? null,
      })),
    };
  });

export const checkInTicket = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ ticketId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("event_tickets")
      .update({ status: "usado", checked_in_at: new Date().toISOString(), checked_in_by: context.userId })
      .eq("id", data.ticketId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
