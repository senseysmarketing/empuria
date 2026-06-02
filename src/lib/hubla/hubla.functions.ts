import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireModule } from "@/lib/admin/auth";
import type { Json } from "@/integrations/supabase/types";

type HublaSettingRow = {
  id: string;
  provider: "hubla";
  is_enabled: boolean;
  checkout_url: string | null;
  post_purchase_url: string | null;
  webhook_secret: string | null;
  product_id: string | null;
  offer_id: string | null;
  whatsapp_group_url: string | null;
  last_event_at: string | null;
  updated_at: string;
};

type HublaEventRow = {
  id: string;
  event_type: string;
  provider_event_id: string | null;
  buyer_email: string | null;
  status: string;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
};

type ClubSubscriptionRow = {
  id: string;
  user_id: string | null;
  provider_subscription_id: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  status: string;
  access_status: "pending" | "active" | "inactive";
  current_period_end: string | null;
  last_payment_at: string | null;
  next_billing_at: string | null;
  canceled_at: string | null;
  updated_at: string;
};

type ParsedHublaPayload = {
  eventType: string;
  providerEventId: string;
  buyerEmail: string | null;
  buyerPhone: string | null;
  buyerName: string | null;
  memberId: string | null;
  subscriptionId: string | null;
  invoiceId: string | null;
  amountCents: number;
  currency: string;
  subscriptionStatus: string | null;
  invoiceStatus: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  paidAt: string | null;
  canceledAt: string | null;
};

type HublaProcessingResult = {
  ok: boolean;
  status: string;
  eventId?: string;
  message?: string;
};

const db = supabaseAdmin as unknown as {
  // New tables are added by this feature before generated Supabase types are refreshed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

const emptyToNull = (value?: string | null) => {
  const clean = (value ?? "").trim();
  return clean.length ? clean : null;
};

const nowIso = () => new Date().toISOString();

function normalizeEmail(value: unknown) {
  return typeof value === "string" && value.includes("@") ? value.trim().toLowerCase() : null;
}

function asString(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function deepFind(payload: unknown, keys: string[]): unknown {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = deepFind(value, keys);
      if (found !== null && found !== undefined) return found;
    }
  }
  return null;
}

function parseDate(value: unknown) {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseAmountCents(payload: unknown) {
  const raw = deepFind(payload, [
    "amount_cents",
    "amountCents",
    "total_cents",
    "totalCents",
    "price_cents",
    "priceCents",
    "amount",
    "total",
    "price",
  ]);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1000 ? Math.round(raw) : Math.round(raw * 100);
  }
  if (typeof raw === "string") {
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n)) return n > 1000 ? Math.round(n) : Math.round(n * 100);
  }
  return 0;
}

function parseHublaPayload(
  payload: Record<string, unknown>,
  fallbackEventId: string,
): ParsedHublaPayload {
  const eventType =
    asString(payload.event) ??
    asString(payload.event_type) ??
    asString(payload.type) ??
    asString(deepFind(payload, ["eventName", "event_name"])) ??
    "unknown";
  const providerEventId =
    asString(payload.id) ??
    asString(payload.event_id) ??
    asString(deepFind(payload, ["webhook_id", "webhookId"])) ??
    fallbackEventId;
  const buyerEmail = normalizeEmail(
    deepFind(payload, ["email", "buyer_email", "buyerEmail", "customer_email", "customerEmail"]),
  );
  const buyerPhone = asString(
    deepFind(payload, ["phone", "buyer_phone", "buyerPhone", "whatsapp"]),
  );
  const buyerName = asString(
    deepFind(payload, ["name", "full_name", "fullName", "buyer_name", "buyerName"]),
  );
  const memberId = asString(
    deepFind(payload, ["member_id", "memberId", "customer_id", "customerId"]),
  );
  const subscriptionId = asString(
    deepFind(payload, ["subscription_id", "subscriptionId", "plan_subscription_id"]),
  );
  const invoiceId = asString(
    deepFind(payload, ["invoice_id", "invoiceId", "charge_id", "chargeId"]),
  );
  const subscriptionStatus = asString(
    deepFind(payload, ["subscription_status", "subscriptionStatus", "status"]),
  );
  const invoiceStatus = asString(
    deepFind(payload, ["invoice_status", "invoiceStatus", "payment_status"]),
  );
  const currency = asString(deepFind(payload, ["currency"])) ?? "BRL";
  return {
    eventType,
    providerEventId,
    buyerEmail,
    buyerPhone,
    buyerName,
    memberId,
    subscriptionId,
    invoiceId,
    amountCents: parseAmountCents(payload),
    currency: currency.toUpperCase(),
    subscriptionStatus,
    invoiceStatus,
    currentPeriodStart: parseDate(
      deepFind(payload, ["current_period_start", "currentPeriodStart", "period_start"]),
    ),
    currentPeriodEnd: parseDate(
      deepFind(payload, ["current_period_end", "currentPeriodEnd", "period_end", "access_until"]),
    ),
    nextBillingAt: parseDate(
      deepFind(payload, ["next_billing_at", "nextBillingAt", "next_charge_at"]),
    ),
    paidAt: parseDate(deepFind(payload, ["paid_at", "paidAt", "payment_date", "approved_at"])),
    canceledAt: parseDate(
      deepFind(payload, ["canceled_at", "canceledAt", "cancelled_at", "cancelledAt"]),
    ),
  };
}

function mapAccess(parsed: ParsedHublaPayload) {
  const haystack =
    `${parsed.eventType} ${parsed.subscriptionStatus ?? ""} ${parsed.invoiceStatus ?? ""}`.toLowerCase();
  const periodEnd = parsed.currentPeriodEnd ? new Date(parsed.currentPeriodEnd) : null;
  const hasValidPeriod = periodEnd ? periodEnd.getTime() > Date.now() : false;

  if (
    haystack.includes("refund") ||
    haystack.includes("chargeback") ||
    haystack.includes("estorno")
  ) {
    return { status: "refunded", accessStatus: "inactive" as const };
  }
  if (
    haystack.includes("paid") ||
    haystack.includes("paga") ||
    haystack.includes("aprov") ||
    haystack.includes("active") ||
    haystack.includes("ativa")
  ) {
    return { status: "active", accessStatus: "active" as const };
  }
  if (haystack.includes("cancel")) {
    return {
      status: "canceled",
      accessStatus: hasValidPeriod ? ("active" as const) : ("inactive" as const),
    };
  }
  if (
    haystack.includes("fail") ||
    haystack.includes("venc") ||
    haystack.includes("past_due") ||
    haystack.includes("inadimpl")
  ) {
    return {
      status: "past_due",
      accessStatus: hasValidPeriod ? ("active" as const) : ("inactive" as const),
    };
  }
  if (haystack.includes("inactive") || haystack.includes("inativa")) {
    return { status: "inactive", accessStatus: "inactive" as const };
  }
  if (
    haystack.includes("incomplete") ||
    haystack.includes("incompleta") ||
    haystack.includes("open") ||
    haystack.includes("abert")
  ) {
    return { status: "incomplete", accessStatus: "pending" as const };
  }
  return { status: "pending", accessStatus: "pending" as const };
}

async function getHublaSetting(includeSecret = false) {
  const { data, error } = await db
    .from("integration_settings")
    .select("*")
    .eq("provider", "hubla")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as HublaSettingRow | null;
  if (!row) {
    return {
      id: "",
      provider: "hubla" as const,
      is_enabled: false,
      checkout_url: null,
      post_purchase_url: "/clube/sucesso",
      webhook_secret: null,
      product_id: null,
      offer_id: null,
      whatsapp_group_url: null,
      last_event_at: null,
      updated_at: nowIso(),
    };
  }
  return includeSecret ? row : { ...row, webhook_secret: row.webhook_secret ? "********" : null };
}

export const getHublaAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    const [{ data: setting }, { data: events }, { count: errorCount }, { count: unmatchedCount }] =
      await Promise.all([
        Promise.resolve({ data: await getHublaSetting(false) }),
        db
          .from("integration_events")
          .select(
            "id, event_type, provider_event_id, buyer_email, status, processed_at, error_message, created_at",
          )
          .eq("provider", "hubla")
          .order("created_at", { ascending: false })
          .limit(12),
        db
          .from("integration_events")
          .select("id", { count: "exact", head: true })
          .eq("provider", "hubla")
          .eq("status", "error"),
        db
          .from("integration_events")
          .select("id", { count: "exact", head: true })
          .eq("provider", "hubla")
          .eq("status", "unmatched"),
      ]);
    return {
      setting,
      events: (events ?? []) as HublaEventRow[],
      errorCount: errorCount ?? 0,
      unmatchedCount: unmatchedCount ?? 0,
      webhookUrl: "/api/webhooks/hubla",
    };
  });

export const saveHublaSettings = createServerFn({ method: "POST" })
  .middleware([requireModule("configuracoes")])
  .inputValidator((d) =>
    z
      .object({
        is_enabled: z.boolean(),
        checkout_url: z.string().trim().url().nullable().optional(),
        post_purchase_url: z.string().trim().min(1).max(500).nullable().optional(),
        webhook_secret: z.string().trim().min(8).max(240).nullable().optional(),
        product_id: z.string().trim().max(120).nullable().optional(),
        offer_id: z.string().trim().max(120).nullable().optional(),
        whatsapp_group_url: z.string().trim().url().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const update: Record<string, unknown> = {
      provider: "hubla",
      is_enabled: data.is_enabled,
      checkout_url: data.checkout_url ?? null,
      post_purchase_url: data.post_purchase_url ?? "/clube/sucesso",
      product_id: data.product_id ?? null,
      offer_id: data.offer_id ?? null,
      whatsapp_group_url: data.whatsapp_group_url ?? null,
    };
    if (data.webhook_secret) update.webhook_secret = data.webhook_secret;

    const { error } = await db
      .from("integration_settings")
      .upsert(update, { onConflict: "provider" });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "hubla.settings.save",
      module: "configuracoes",
      entity_type: "integration_settings",
      new_data: {
        ...update,
        webhook_secret: data.webhook_secret ? "[updated]" : "[unchanged]",
      } as Json,
    });
    return { ok: true };
  });

export const testHublaConfiguration = createServerFn({ method: "GET" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    const setting = await getHublaSetting(true);
    return {
      ok: !!setting.checkout_url && !!setting.webhook_secret,
      missing: [
        ...(!setting.checkout_url ? ["checkout_url"] : []),
        ...(!setting.webhook_secret ? ["webhook_secret"] : []),
      ],
      isEnabled: setting.is_enabled,
    };
  });

export const getMyClubHublaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.effectiveUserId ?? context.userId;
    const [{ data: profile }, { data: sub }, setting] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("id, full_name, phone, is_club_member")
        .eq("id", userId)
        .maybeSingle(),
      db
        .from("club_subscriptions")
        .select(
          "id, status, access_status, buyer_email, buyer_phone, current_period_end, last_payment_at, next_billing_at, canceled_at, updated_at",
        )
        .eq("user_id", userId)
        .eq("provider", "hubla")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      getHublaSetting(false),
    ]);
    const claimsEmail = typeof context.claims.email === "string" ? context.claims.email : null;
    return {
      email: claimsEmail,
      profile,
      subscription: sub as ClubSubscriptionRow | null,
      isMember: !!profile?.is_club_member,
      setting: {
        is_enabled: setting.is_enabled,
        checkout_url: setting.checkout_url,
        post_purchase_url: setting.post_purchase_url,
        whatsapp_group_url: setting.whatsapp_group_url,
      },
    };
  });

async function findUserByEmail(email: string | null) {
  if (!email) return null;
  const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = (data.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);
  if (!user) return null;
  const { data: profile } = await db
    .from("profiles")
    .select("id, full_name, phone")
    .eq("id", user.id)
    .maybeSingle();
  return { id: user.id, email: user.email ?? email, profile };
}

async function financeCategoryId(name: string) {
  const { data } = await db
    .from("finance_categories")
    .select("id")
    .eq("name", name)
    .eq("type", "income")
    .maybeSingle();
  return data?.id ?? null;
}

async function upsertHublaOrder(parsed: ParsedHublaPayload, userId: string, eventId: string) {
  if (parsed.amountCents <= 0) return null;
  const invoiceId = parsed.invoiceId ?? parsed.providerEventId;
  const { data: existing } = await db
    .from("orders")
    .select("id")
    .contains("service_metadata", { provider: "hubla", invoice_id: invoiceId })
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: profile } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  const { data, error } = await db
    .from("orders")
    .insert({
      user_id: userId,
      customer_name: parsed.buyerName ?? profile?.full_name ?? parsed.buyerEmail ?? "Membro Hubla",
      customer_email: parsed.buyerEmail,
      service_title: "Clube do Imigrante",
      amount_cents: parsed.amountCents,
      currency: parsed.currency || "BRL",
      payment_status: "aprovado",
      delivery_status: "concluido",
      service_metadata: {
        provider: "hubla",
        event_id: eventId,
        invoice_id: invoiceId,
        subscription_id: parsed.subscriptionId,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function upsertHublaFinance(parsed: ParsedHublaPayload, eventId: string) {
  if (parsed.amountCents <= 0) return;
  const categoryId = await financeCategoryId("Clube");
  const { error } = await db.from("finance_transactions").upsert(
    {
      type: "income",
      status: "received",
      description: "Assinatura Hubla - Clube do Imigrante",
      amount_cents: parsed.amountCents,
      currency: parsed.currency || "BRL",
      amount_brl_cents: parsed.currency === "BRL" ? parsed.amountCents : null,
      due_date: (parsed.paidAt ?? nowIso()).slice(0, 10),
      paid_at: parsed.paidAt ?? nowIso(),
      category_id: categoryId,
      source_module: "hubla",
      source_id: eventId,
      is_automatic: true,
      notes: parsed.invoiceId ? `Hubla invoice ${parsed.invoiceId}` : "Hubla webhook",
    },
    { onConflict: "source_module,source_id" },
  );
  if (error) throw new Error(error.message);
}

export async function validateHublaWebhookSecret(request: Request) {
  const setting = await getHublaSetting(true);
  if (!setting.is_enabled) return { ok: false, message: "Hubla integration disabled" };
  if (!setting.webhook_secret) return { ok: false, message: "Hubla webhook secret not configured" };
  const auth = request.headers.get("authorization") ?? "";
  const candidates = [
    request.headers.get("x-hubla-token"),
    request.headers.get("x-webhook-secret"),
    request.headers.get("x-hubla-secret"),
    auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : null,
    new URL(request.url).searchParams.get("token"),
  ].filter(Boolean);
  return {
    ok: candidates.some((candidate) => candidate === setting.webhook_secret),
    message: "Invalid Hubla webhook secret",
  };
}

export async function processHublaWebhook(
  payload: Record<string, unknown>,
  fallbackEventId: string,
): Promise<HublaProcessingResult> {
  const parsed = parseHublaPayload(payload, fallbackEventId);
  const { data: eventInsert, error: eventErr } = await db
    .from("integration_events")
    .insert({
      provider: "hubla",
      event_type: parsed.eventType,
      provider_event_id: parsed.providerEventId,
      buyer_email: parsed.buyerEmail,
      payload,
      status: "received",
    })
    .select("id")
    .single();

  if (eventErr) {
    if (eventErr.code === "23505")
      return { ok: true, status: "duplicate", message: "Duplicate event" };
    throw new Error(eventErr.message);
  }

  const eventId = eventInsert.id as string;
  try {
    const user = await findUserByEmail(parsed.buyerEmail);
    const access = mapAccess(parsed);
    if (!user) {
      await db
        .from("integration_events")
        .update({
          status: "unmatched",
          processed_at: nowIso(),
          error_message: "Buyer email not found in Empuria Auth users",
        })
        .eq("id", eventId);
      return { ok: true, status: "unmatched", eventId };
    }

    const subPayload = {
      user_id: user.id,
      provider: "hubla",
      provider_member_id: parsed.memberId,
      provider_subscription_id: parsed.subscriptionId ?? `email:${parsed.buyerEmail}`,
      provider_invoice_id: parsed.invoiceId,
      buyer_email: parsed.buyerEmail,
      buyer_phone: parsed.buyerPhone ?? user.profile?.phone ?? null,
      status: access.status,
      access_status: access.accessStatus,
      current_period_start: parsed.currentPeriodStart,
      current_period_end: parsed.currentPeriodEnd,
      last_payment_at: parsed.paidAt,
      next_billing_at: parsed.nextBillingAt,
      canceled_at: parsed.canceledAt,
      raw_payload: payload,
    };

    const { data: subscription, error: subErr } = await db
      .from("club_subscriptions")
      .upsert(subPayload, { onConflict: "provider,provider_subscription_id" })
      .select("id")
      .single();
    if (subErr) throw new Error(subErr.message);

    await db
      .from("profiles")
      .update({ is_club_member: access.accessStatus === "active" })
      .eq("id", user.id);

    if (access.accessStatus === "active" && parsed.amountCents > 0) {
      await upsertHublaOrder(parsed, user.id, eventId);
      await upsertHublaFinance(parsed, eventId);
    }

    await db
      .from("integration_events")
      .update({ status: "processed", processed_at: nowIso() })
      .eq("id", eventId);
    await db
      .from("integration_settings")
      .update({ last_event_at: nowIso() })
      .eq("provider", "hubla");
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: user.id,
      action: "hubla.webhook.processed",
      module: "hubla",
      entity_type: "club_subscription",
      entity_id: subscription.id,
      new_data: {
        event_id: eventId,
        access_status: access.accessStatus,
        subscription_status: access.status,
        buyer_email: parsed.buyerEmail,
      } as Json,
    });
    return { ok: true, status: "processed", eventId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    await db
      .from("integration_events")
      .update({ status: "error", processed_at: nowIso(), error_message: message })
      .eq("id", eventId);
    return { ok: false, status: "error", eventId, message };
  }
}
