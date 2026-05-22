import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";

export const updateDelivery = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      orderId: z.string().uuid(),
      delivery_status: z
        .enum([
          "aguardando_pagamento",
          "aguardando_documentos",
          "processando",
          "agendado",
          "concluido",
        ])
        .optional(),
      host_profile_id: z.string().uuid().nullable().optional(),
      assigned_staff_id: z.string().uuid().nullable().optional(),
      notes: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.delivery_status) patch.delivery_status = data.delivery_status;
    if (data.host_profile_id !== undefined) patch.host_profile_id = data.host_profile_id;
    if (data.assigned_staff_id !== undefined) patch.assigned_staff_id = data.assigned_staff_id;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.delivery_status === "concluido") patch.executed_at = new Date().toISOString();
    const { error } = await context.supabase.from("orders").update(patch).eq("id", data.orderId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listStaffProfiles = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "staff"]);
    const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
    if (ids.length === 0) return [];
    const { data: profiles } = await context.supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", ids);
    return profiles ?? [];
  });
