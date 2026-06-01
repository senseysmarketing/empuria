import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";

export const listWeekAppointments = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ weekStart: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const start = new Date(data.weekStart);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const [appts, services] = await Promise.all([
      context.supabase
        .from("appointments")
        .select("*, services(title,category), profiles(full_name), staff_assignments(staff_id)")
        .gte("starts_at", start.toISOString())
        .lt("starts_at", end.toISOString())
        .order("starts_at", { ascending: true }),
      context.supabase.from("services").select("id,title,category,duration_minutes").eq("is_active", true),
    ]);
    return { appointments: appts.data ?? [], services: services.data ?? [] };
  });

export const createAppointment = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      service_id: z.string().uuid(),
      user_id: z.string().uuid(),
      starts_at: z.string(),
      ends_at: z.string(),
      notes: z.string().max(2000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const start = new Date(data.starts_at);
    const end = new Date(data.ends_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("Datas inválidas");
    }
    if (start.getTime() <= Date.now()) {
      throw new Error("Não é possível criar compromisso em data/hora passada");
    }
    if (end.getTime() <= start.getTime()) {
      throw new Error("O horário de fim deve ser maior que o de início");
    }
    const { error } = await context.supabase.from("appointments").insert({
      service_id: data.service_id,
      user_id: data.user_id,
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      notes: data.notes ?? null,
      status: "confirmado",
    });
    if (error) {
      if (error.message.includes("appointments_no_overlap")) {
        throw new Error("Horário já ocupado para este serviço.");
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const cancelAppointment = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("appointments")
      .update({ status: "cancelado" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
