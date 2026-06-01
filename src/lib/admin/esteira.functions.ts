import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff, requireAdmin } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ORDER_SELECT_ADMIN = "*";
const ORDER_SELECT_STAFF =
  "id,customer_name,customer_email,service_title,payment_status,delivery_status,voucher_code,created_at,executed_at,user_id";

export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const select = context.isAdmin ? ORDER_SELECT_ADMIN : ORDER_SELECT_STAFF;
    const { data } = await context.supabase
      .from("orders")
      .select(select as "*")
      .order("created_at", { ascending: false })
      .limit(300);
    return (data ?? []).map((order) => ({
      ...order,
      canViewFinancials: !!context.isAdmin,
    }));
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
    const patch: Record<string, unknown> = {};
    if (data.payment_status) {
      patch.payment_status = data.payment_status;
      if (data.payment_status === "aprovado") {
        patch.voucher_code = `EMP-${Date.now().toString(36).toUpperCase()}`;
        patch.paid_at = new Date().toISOString();
      }
    }
    if (data.executed) patch.executed_at = new Date().toISOString();
    const { error } = await context.supabase.from("orders").update(patch as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// --- Customer search & lite creation ----------------------------------------

const phoneNorm = (s: string) => s.replace(/\D+/g, "");

export const searchCustomers = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({ q: z.string().trim().min(1).max(120) }).parse(d),
  )
  .handler(async ({ data }) => {
    const q = data.q;
    const digits = phoneNorm(q);
    const orParts = [
      `full_name.ilike.%${q}%`,
      `phone.ilike.%${q}%`,
    ];
    if (digits.length >= 4) orParts.push(`phone.ilike.%${digits}%`);

    const { data: byProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone")
      .or(orParts.join(","))
      .limit(20);

    const ids = new Set((byProfile ?? []).map((p) => p.id));

    // Also search auth users by email
    let byEmail: { id: string; full_name: string | null; phone: string | null; email: string | null }[] = [];
    if (q.includes("@") || q.length >= 3) {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 50 });
      const matching = (users?.users ?? []).filter((u) =>
        u.email && u.email.toLowerCase().includes(q.toLowerCase()),
      );
      const missing = matching.filter((u) => !ids.has(u.id));
      if (missing.length) {
        const { data: profs } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, phone")
          .in("id", missing.map((u) => u.id));
        const profMap = new Map((profs ?? []).map((p) => [p.id, p]));
        byEmail = matching.map((u) => ({
          id: u.id,
          full_name: profMap.get(u.id)?.full_name ?? null,
          phone: profMap.get(u.id)?.phone ?? null,
          email: u.email ?? null,
        }));
      }
    }

    // Attach emails to byProfile rows
    const profileIds = (byProfile ?? []).map((p) => p.id);
    let emails = new Map<string, string | null>();
    if (profileIds.length) {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      emails = new Map((users?.users ?? []).map((u) => [u.id, u.email ?? null]));
    }

    const out = [
      ...(byProfile ?? []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        phone: p.phone,
        email: emails.get(p.id) ?? null,
      })),
      ...byEmail,
    ];
    return out.slice(0, 30);
  });

export const createCustomerLite = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      full_name: z.string().trim().min(2).max(120),
      email: z.string().trim().email().max(255),
      phone: z.string().trim().min(4).max(40).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    // Look up existing auth user first
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const match = (existing?.users ?? []).find(
      (u) => (u.email ?? "").toLowerCase() === data.email.toLowerCase(),
    );
    let userId = match?.id ?? null;

    if (!userId) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        email_confirm: false,
        user_metadata: { full_name: data.full_name, phone: data.phone ?? null },
      });
      if (error || !created.user) throw new Error(error?.message ?? "Falha ao criar cliente");
      userId = created.user.id;
    }

    // Upsert profile
    await supabaseAdmin.from("profiles").upsert(
      {
        id: userId,
        full_name: data.full_name,
        phone: data.phone ?? null,
      },
      { onConflict: "id" },
    );

    return { user_id: userId, email: data.email, full_name: data.full_name, phone: data.phone ?? null };
  });

// --- Full order creation ----------------------------------------------------

const fullOrderSchema = z.object({
  user_id: z.string().uuid().nullable().optional(),
  customer_name: z.string().trim().min(2).max(120),
  customer_email: z.string().trim().email().max(255).nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  service_title: z.string().trim().min(2).max(160),
  amount_cents: z.number().int().min(0),
  currency: z.enum(["EUR", "BRL", "USD"]).default("EUR"),
  payment_amount_cents: z.number().int().min(0).optional(),
  payment_currency: z.enum(["EUR", "BRL", "USD"]).optional(),
  fx_rate: z.number().positive().optional(),
  payment_method: z.enum(["mercadopago", "manual", "gratuito"]).default("mercadopago"),
  payment_status: z.enum(["pendente", "aprovado", "recusado", "estornado"]).default("pendente"),
  reason: z.string().trim().max(280).optional(),
  notes: z.string().trim().max(500).optional(),
  slot_id: z.string().uuid().nullable().optional(),
});

export const createOrderFull = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => fullOrderSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (!context.isAdmin && data.amount_cents > 0) {
      throw new Error("Apenas admins podem criar pedidos com valor");
    }
    if (data.payment_method === "manual" && !context.isAdmin) {
      throw new Error("Apenas admins podem marcar pagamento manual");
    }
    if (data.payment_method === "manual" && !data.reason) {
      throw new Error("Informe o motivo do pagamento manual");
    }
    if (data.amount_cents === 0 && data.payment_method !== "gratuito") {
      throw new Error("Pedido com valor zero exige confirmação como gratuito");
    }

    const payment_status =
      data.payment_method === "gratuito"
        ? "aprovado"
        : data.payment_method === "manual"
          ? "aprovado"
          : data.payment_status;

    const voucher =
      payment_status === "aprovado"
        ? `EMP-${Date.now().toString(36).toUpperCase()}`
        : null;

    const insertPayload: Record<string, unknown> = {
      user_id: data.user_id ?? null,
      customer_name: data.customer_name,
      customer_email: data.customer_email ?? null,
      service_id: data.service_id ?? null,
      service_title: data.service_title,
      amount_cents: data.amount_cents,
      currency: data.currency,
      slot_id: data.slot_id ?? null,
      notes: data.notes ?? null,
      payment_status,
      payment_method: data.payment_method,
      payment_currency: data.payment_currency ?? data.currency,
      payment_amount_cents: data.payment_amount_cents ?? data.amount_cents,
      fx_rate: data.fx_rate ?? null,
      fx_source: data.fx_rate ? "manual" : null,
      fx_locked_at: data.fx_rate ? new Date().toISOString() : null,
      paid_at: payment_status === "aprovado" ? new Date().toISOString() : null,
      voucher_code: voucher,
    };
    const { data: order, error } = await context.supabase
      .from("orders")
      .insert(insertPayload as never)
      .select("id")
      .single();

    if (error || !order) throw new Error(error?.message ?? "Erro ao criar pedido");

    // Audit log
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      module: "esteira",
      entity_type: "order",
      entity_id: order.id,
      action:
        data.payment_method === "gratuito"
          ? "order.create.gratuito"
          : data.payment_method === "manual"
            ? "order.create.manual_paid"
            : "order.create",
      new_data: {
        amount_cents: data.amount_cents,
        currency: data.currency,
        payment_method: data.payment_method,
        reason: data.reason ?? null,
      },
    });

    return { id: order.id };
  });

// --- Order actions ----------------------------------------------------------

export const markOrderPaidManual = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      reason: z.string().trim().min(3).max(280),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {
      payment_status: "aprovado",
      payment_method: "manual",
      paid_at: new Date().toISOString(),
      voucher_code: `EMP-${Date.now().toString(36).toUpperCase()}`,
    };
    const { error } = await context.supabase
      .from("orders")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);


    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      module: "esteira",
      entity_type: "order",
      entity_id: data.id,
      action: "order.payment.manual",
      new_data: { reason: data.reason },
    });
    return { ok: true };
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      reason: z.string().trim().min(3).max(280),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("orders")
      .update({ payment_status: "recusado" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      module: "esteira",
      entity_type: "order",
      entity_id: data.id,
      action: "order.cancel",
      new_data: { reason: data.reason },
    });
    return { ok: true };
  });

export const refundOrder = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      reason: z.string().trim().min(3).max(280),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("orders")
      .update({ payment_status: "estornado" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      module: "esteira",
      entity_type: "order",
      entity_id: data.id,
      action: "order.refund",
      new_data: { reason: data.reason },
    });
    return { ok: true };
  });

export const generatePaymentLink = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Stub: real Mercado Pago integration will land when MP_ACCESS_TOKEN is configured.
    const reference = `EMP-${data.id.slice(0, 8).toUpperCase()}`;
    const { error } = await context.supabase
      .from("orders")
      .update({
        payment_provider: "mercadopago",
        payment_provider_reference: reference,
        payment_status: "pendente",
      } as never)
      .eq("id", data.id);

    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      module: "esteira",
      entity_type: "order",
      entity_id: data.id,
      action: "order.payment.link.stub",
      new_data: { reference, note: "Mercado Pago não conectado" },
    });
    return {
      ok: true,
      pending: true,
      reference,
      message: "Mercado Pago — em breve. Configure as credenciais para gerar o link real.",
    };
  });

// Kept for backward compatibility with existing modal.
export const createOrder = createOrderFull;
