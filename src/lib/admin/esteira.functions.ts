import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";

export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

export const updateOrder = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      payment_status: z.enum(["pendente", "aprovado", "recusado", "estornado"]).optional(),
      executed: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: {
      payment_status?: "pendente" | "aprovado" | "recusado" | "estornado";
      voucher_code?: string;
      executed_at?: string;
    } = {};
    if (data.payment_status) {
      patch.payment_status = data.payment_status;
      if (data.payment_status === "aprovado") {
        patch.voucher_code = `EMP-${Date.now().toString(36).toUpperCase()}`;
      }
    }
    if (data.executed) patch.executed_at = new Date().toISOString();
    const { error } = await context.supabase.from("orders").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createOrder = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      customer_name: z.string().trim().min(2).max(120),
      customer_email: z.string().email().optional().or(z.literal("")),
      service_title: z.string().trim().min(2).max(120),
      service_id: z.string().uuid().optional().nullable(),
      amount_cents: z.number().int().min(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("orders").insert({
      customer_name: data.customer_name,
      customer_email: data.customer_email || null,
      service_title: data.service_title,
      service_id: data.service_id ?? null,
      amount_cents: data.amount_cents,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
