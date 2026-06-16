import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff, requireAdmin, requireStaffOrAction } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createOrReuseManualCustomer } from "./manual-users";
import { createWisePaymentForOrder } from "@/lib/wise/wise.functions";

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
    z
      .object({
        id: z.string().uuid(),
        payment_status: z.enum(["pendente", "aprovado", "recusado", "estornado"]).optional(),
        executed: z.boolean().optional(),
      })
      .parse(d),
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
    const { error } = await context.supabase
      .from("orders")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- Customer search & lite creation ----------------------------------------

const phoneNorm = (s: string) => s.replace(/\D+/g, "");

export const searchCustomers = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ q: z.string().trim().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const q = data.q;
    const digits = phoneNorm(q);
    const orParts = [`full_name.ilike.%${q}%`, `phone.ilike.%${q}%`];
    if (digits.length >= 4) orParts.push(`phone.ilike.%${digits}%`);

    const { data: byProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone")
      .or(orParts.join(","))
      .limit(20);

    const ids = new Set((byProfile ?? []).map((p) => p.id));

    // Also search auth users by email
    let byEmail: {
      id: string;
      full_name: string | null;
      phone: string | null;
      email: string | null;
    }[] = [];
    if (q.includes("@") || q.length >= 3) {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 50 });
      const matching = (users?.users ?? []).filter(
        (u) => u.email && u.email.toLowerCase().includes(q.toLowerCase()),
      );
      const missing = matching.filter((u) => !ids.has(u.id));
      if (missing.length) {
        const { data: profs } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, phone")
          .in(
            "id",
            missing.map((u) => u.id),
          );
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
    z
      .object({
        full_name: z.string().trim().min(2).max(120),
        email: z.string().trim().email().max(255),
        phone: z.string().trim().min(5).max(40),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const customer = await createOrReuseManualCustomer({
      fullName: data.full_name,
      email: data.email,
      phone: data.phone,
      origin: "esteira",
      actorId: context.userId,
    });

    return {
      user_id: customer.user_id,
      email: customer.email,
      full_name: customer.full_name,
      phone: customer.phone,
    };
  });

// --- Full order creation ----------------------------------------------------

const fullOrderSchema = z.object({
  user_id: z.string().uuid().nullable().optional(),
  customer_name: z.string().trim().min(2).max(120),
  customer_email: z.string().trim().email().max(255).nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  service_title: z.string().trim().min(2).max(160),
  amount_cents: z.number().int().min(0),
  payment_method: z.enum(["wise", "manual", "dinheiro", "gratuito", "pendente"]).default("wise"),
  reason: z.string().trim().max(280).optional(),
  notes: z.string().trim().max(500).optional(),
  slot_id: z.string().uuid().nullable().optional(),
});

export const createOrderFull = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => fullOrderSchema.parse(d))
  .handler(async ({ data, context: _context }) => {
    if (data.payment_method === "manual" && !data.reason) {
      throw new Error("Informe o motivo do pagamento manual");
    }
    if (data.payment_method === "dinheiro" && !data.reason) {
      throw new Error("Informe a observação do recebimento em dinheiro");
    }
    if (data.amount_cents === 0 && data.payment_method !== "gratuito") {
      throw new Error("Pedido com valor zero exige confirmação como gratuito");
    }

    const payment_status =
      data.payment_method === "gratuito" ||
      data.payment_method === "manual" ||
      data.payment_method === "dinheiro"
        ? "aprovado"
        : "pendente";

    const voucher =
      payment_status === "aprovado" ? `EMP-${Date.now().toString(36).toUpperCase()}` : null;

    const insertPayload: Record<string, unknown> = {
      user_id: data.user_id ?? null,
      customer_name: data.customer_name,
      customer_email: data.customer_email ?? null,
      service_id: data.service_id ?? null,
      service_title: data.service_title,
      amount_cents: data.amount_cents,
      currency: "EUR",
      slot_id: data.slot_id ?? null,
      notes: data.notes ?? null,
      payment_status,
      payment_method: data.payment_method,
      payment_currency: "EUR",
      payment_amount_cents: data.amount_cents,
      fx_rate: null,
      fx_source: null,
      fx_locked_at: null,
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
            : data.payment_method === "dinheiro"
              ? "order.create.dinheiro"
              : data.payment_method === "wise"
                ? "order.create.wise"
                : "order.create",
      new_data: {
        amount_cents: data.amount_cents,
        currency: "EUR",
        payment_method: data.payment_method,
        reason: data.reason ?? null,
      },
    });

    return { id: order.id };
  });

// --- Order actions ----------------------------------------------------------

export const markOrderPaidManual = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        reason: z.string().trim().min(3).max(280),
      })
      .parse(d),
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
  .middleware([requireStaffOrAction("esteira.cancel_order")])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        reason: z.string().trim().min(3).max(280),
      })
      .parse(d),
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
  .middleware([requireStaffOrAction("esteira.refund_order")])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        reason: z.string().trim().min(3).max(280),
      })
      .parse(d),
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
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        baseUrl: z.string().url().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const reference = `EMP-${data.id}`;
    const { data: order, error: orderErr } = await context.supabase
      .from("orders")
      .select("amount_cents,currency,payment_amount_cents,payment_currency,payment_status")
      .eq("id", data.id)
      .single();
    if (orderErr || !order) throw new Error(orderErr?.message ?? "Pedido nao encontrado");
    const orderRow = order as unknown as {
      amount_cents: number;
      currency: "EUR" | "BRL" | "USD";
      payment_amount_cents: number | null;
      payment_currency: "EUR" | "BRL" | "USD" | null;
      payment_status: string;
    };
    if (orderRow.payment_status === "aprovado") {
      throw new Error("Pedido ja esta pago.");
    }
    if (orderRow.payment_status === "estornado") {
      throw new Error("Pedido estornado. Crie um novo pedido para cobrar novamente.");
    }
    const payCurrency = orderRow.payment_currency ?? orderRow.currency;
    if (payCurrency !== "BRL") {
      throw new Error("Mercado Pago Brasil exige cobranca em BRL. Ajuste a moeda do pedido.");
    }

    const { error } = await context.supabase
      .from("orders")
      .update({
        payment_provider: "mercadopago",
        payment_provider_reference: reference,
        external_reference: reference,
        payment_amount_cents: orderRow.payment_amount_cents ?? orderRow.amount_cents,
        payment_currency: payCurrency,
        payment_status: "pendente",
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // Reuse an active link if one already exists; otherwise create a new token.
    const { data: existing } = await supabaseAdmin
      .from("order_payment_links")
      .select("id,token,status,expires_at")
      .eq("order_id", data.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let token: string;
    let linkId: string;
    const validExisting =
      existing &&
      (existing as { expires_at: string }).expires_at &&
      new Date((existing as { expires_at: string }).expires_at).getTime() > Date.now();
    if (validExisting) {
      token = (existing as { token: string }).token;
      linkId = (existing as { id: string }).id;
    } else {
      const rand = new Uint8Array(24);
      globalThis.crypto.getRandomValues(rand);
      token =
        "pay_" +
        Array.from(rand)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("order_payment_links")
        .insert({
          order_id: data.id,
          token,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (insErr || !inserted) throw new Error(insErr?.message ?? "Falha ao criar link.");
      linkId = (inserted as { id: string }).id;
    }

    const baseUrl =
      data.baseUrl?.replace(/\/+$/, "") ?? "https://empuria.lovable.app";
    const url = `${baseUrl}/pagar/${token}`;

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      module: "esteira",
      entity_type: "order_payment_link",
      entity_id: linkId,
      action: "payment_link.created",
      new_data: { reference, provider: "mercadopago", order_id: data.id },
    });

    return {
      ok: true,
      pending: true,
      reference,
      token,
      linkId,
      url,
      message: "Link de pagamento publico gerado.",
    };
  });

// Kept for backward compatibility with existing modal.
export const createOrder = createOrderFull;

/**
 * Admin-side: mint a Wise payment for an order created via the esteira wizard.
 * Returns the hosted Quick Pay URL (with amount/reference) when available,
 * plus IBAN/BIC fallback for manual transfer.
 */
export const generateWisePaymentForOrder = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase
      .from("orders")
      .select(
        "id,service_title,amount_cents,currency,payment_amount_cents,payment_currency,customer_email,payment_status",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error || !order) throw new Error(error?.message ?? "Pedido não encontrado.");
    const row = order as unknown as {
      id: string;
      service_title: string;
      amount_cents: number;
      currency: string | null;
      payment_amount_cents: number | null;
      payment_currency: string | null;
      customer_email: string | null;
      payment_status: string;
    };
    if (row.payment_status === "aprovado") throw new Error("Pedido já está pago.");
    const result = await createWisePaymentForOrder({
      orderId: row.id,
      amountCents: row.payment_amount_cents ?? row.amount_cents,
      currency: row.payment_currency ?? row.currency ?? "EUR",
      description: row.service_title,
      customerEmail: row.customer_email,
    });
    await context.supabase
      .from("orders")
      .update({
        payment_provider: "wise",
        payment_provider_reference: result.reference,
        external_reference: result.reference,
      } as never)
      .eq("id", row.id);
    return result;
  });
