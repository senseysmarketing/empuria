import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireStaff } from "@/lib/admin/auth";

const db = supabaseAdmin as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type LinkRow = {
  id: string;
  order_id: string;
  token: string;
  status: "active" | "paid" | "expired" | "revoked";
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  last_accessed_at: string | null;
  access_count: number;
};

type OrderRow = {
  id: string;
  customer_name: string;
  service_title: string;
  external_reference: string | null;
  payment_provider_reference: string | null;
  amount_cents: number;
  currency: string;
  payment_amount_cents: number | null;
  payment_currency: string | null;
  payment_status: "pendente" | "aprovado" | "recusado" | "estornado";
  delivery_status: string | null;
};

export type PublicPaymentLinkResult =
  | {
      ok: false;
      reason: "not_found" | "expired" | "revoked" | "paid" | "canceled" | "refunded";
      message: string;
    }
  | {
      ok: true;
      orderId: string;
      customerName: string;
      serviceTitle: string;
      reference: string;
      amountCents: number;
      currency: string;
      paymentMethods: Array<"pix" | "card">;
      mercadoPagoEnabled: boolean;
      mercadoPagoPublicKey: string | null;
      expiresAt: string;
    };

async function loadLinkRow(token: string): Promise<LinkRow | null> {
  const { data } = await db
    .from("order_payment_links")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  return (data as LinkRow | null) ?? null;
}

async function loadOrderById(orderId: string): Promise<OrderRow | null> {
  const { data } = await db
    .from("orders")
    .select(
      "id,customer_name,service_title,external_reference,payment_provider_reference,amount_cents,currency,payment_amount_cents,payment_currency,payment_status,delivery_status",
    )
    .eq("id", orderId)
    .maybeSingle();
  return (data as OrderRow | null) ?? null;
}

/**
 * Internal helper for server-side use by mercadopago.functions.ts.
 * Validates token & order without consuming access counters or returning UI metadata.
 */
export async function resolvePaymentLinkForCharge(token: string): Promise<{
  link: LinkRow;
  order: OrderRow;
}> {
  const link = await loadLinkRow(token);
  if (!link) throw new Error("Link de pagamento invalido.");
  if (link.status === "revoked") throw new Error("Link de pagamento revogado.");
  if (link.status === "paid") throw new Error("Pedido ja foi pago.");
  if (new Date(link.expires_at).getTime() < Date.now()) {
    if (link.status !== "expired") {
      await db
        .from("order_payment_links")
        .update({ status: "expired" })
        .eq("id", link.id);
    }
    throw new Error("Link de pagamento expirado.");
  }
  const order = await loadOrderById(link.order_id);
  if (!order) throw new Error("Pedido nao encontrado.");
  if (order.payment_status === "aprovado") {
    await db
      .from("order_payment_links")
      .update({ status: "paid", used_at: new Date().toISOString() })
      .eq("id", link.id);
    throw new Error("Pedido ja foi pago.");
  }
  if (order.payment_status === "estornado") {
    throw new Error("Pedido estornado. Nao e possivel cobrar novamente.");
  }
  return { link, order };
}

export async function markLinkPaid(linkId: string) {
  await db
    .from("order_payment_links")
    .update({ status: "paid", used_at: new Date().toISOString() })
    .eq("id", linkId);
}

function getMpPublicConfig() {
  return db
    .from("integration_settings")
    .select("is_enabled,environment,test_public_key,prod_public_key,pix_enabled,card_enabled")
    .eq("provider", "mercadopago")
    .maybeSingle();
}

export const getPublicPaymentLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().min(8).max(120) }).parse(d))
  .handler(async ({ data }): Promise<PublicPaymentLinkResult> => {
    const link = await loadLinkRow(data.token);
    if (!link) {
      return { ok: false, reason: "not_found", message: "Link de pagamento nao encontrado." };
    }

    // Update access metadata (best-effort)
    void db
      .from("order_payment_links")
      .update({
        last_accessed_at: new Date().toISOString(),
        access_count: (link.access_count ?? 0) + 1,
      })
      .eq("id", link.id);

    if (link.status === "revoked") {
      return { ok: false, reason: "revoked", message: "Este link foi revogado pelo Instituto Empuria." };
    }
    if (link.status === "paid") {
      return { ok: false, reason: "paid", message: "Este pedido ja foi pago." };
    }
    const expired = new Date(link.expires_at).getTime() < Date.now();
    if (expired || link.status === "expired") {
      if (link.status !== "expired") {
        await db.from("order_payment_links").update({ status: "expired" }).eq("id", link.id);
      }
      return { ok: false, reason: "expired", message: "Este link expirou." };
    }

    const order = await loadOrderById(link.order_id);
    if (!order) {
      return { ok: false, reason: "not_found", message: "Pedido nao encontrado." };
    }
    if (order.payment_status === "aprovado") {
      await markLinkPaid(link.id);
      return { ok: false, reason: "paid", message: "Este pedido ja foi pago." };
    }
    if (order.payment_status === "estornado") {
      return { ok: false, reason: "refunded", message: "Pedido estornado." };
    }

    const { data: cfg } = await getMpPublicConfig();
    const env = (cfg?.environment ?? "test") as "test" | "production";
    const publicKey =
      env === "production" ? (cfg?.prod_public_key ?? null) : (cfg?.test_public_key ?? null);
    const methods: Array<"pix" | "card"> = [];
    if (cfg?.pix_enabled) methods.push("pix");
    if (cfg?.card_enabled) methods.push("card");

    const amountCents = order.payment_amount_cents ?? order.amount_cents;
    const currency = order.payment_currency ?? order.currency;
    const reference =
      order.payment_provider_reference ?? order.external_reference ?? `EMP-${order.id}`;

    return {
      ok: true,
      orderId: order.id,
      customerName: order.customer_name,
      serviceTitle: order.service_title,
      reference,
      amountCents,
      currency,
      paymentMethods: methods,
      mercadoPagoEnabled: Boolean(cfg?.is_enabled),
      mercadoPagoPublicKey: publicKey,
      expiresAt: link.expires_at,
    };
  });

export const revokePaymentLink = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db
      .from("order_payment_links")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    await db.from("audit_logs").insert({
      actor_id: context.userId,
      module: "esteira",
      entity_type: "order_payment_link",
      entity_id: data.id,
      action: "payment_link.revoked",
    });
    return { ok: true };
  });
