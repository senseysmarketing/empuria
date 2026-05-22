import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";

export const listSlots = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({ serviceId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const q = context.supabase
      .from("availability_slots")
      .select("*, services(title,kind)")
      .order("starts_at", { ascending: true })
      .limit(200);
    if (data.serviceId) q.eq("service_id", data.serviceId);
    const { data: slots } = await q;
    return slots ?? [];
  });

export const listServicesAdmin = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("services")
      .select("id,title,kind,requires_slot,price_cents")
      .order("title");
    return data ?? [];
  });

export const createSlot = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      service_id: z.string().uuid(),
      starts_at: z.string(),
      ends_at: z.string(),
      capacity: z.number().int().min(1).max(50),
      notes: z.string().max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("availability_slots").insert(data);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleSlot = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("availability_slots")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSlot = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("availability_slots")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
