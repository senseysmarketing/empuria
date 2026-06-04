import { createServerFn } from "@tanstack/react-start";
import { getRequestHost } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireModule } from "@/lib/admin/auth";
import type { Json } from "@/integrations/supabase/types";

type PaymentMethod = "pix" | "boleto" | "credit_card";
type OrderPaymentStatus = "pendente" | "aprovado" | "recusado" | "estornado";

// Mercado Pago exige no mínimo ~30 min para `date_of_expiration` de PIX dinâmico em produção;
// valores menores fazem o pagamento ser marcado como `cancelled/expired` em segundos.
const PIX_EXPIRATION_MINUTES = 30;

type MercadoPagoSetting = {
  provider: "mercadopago";
  is_enabled: boolean;
  environment: "test" | "production";
  public_key: string | null;
  access_token: string | null;
  webhook_secret: string | null;
  test_public_key: string | null;
  test_access_token: string | null;
  test_webhook_secret: string | null;
  prod_public_key: string | null;
  prod_access_token: string | null;
  prod_webhook_secret: string | null;
  default_currency: "BRL" | "EUR" | "USD";
  statement_descriptor: string;
  pix_enabled: boolean;
  boleto_enabled: boolean;
  card_enabled: boolean;
  pix_expiration_minutes: number;
  boleto_expiration_days: number;
  last_event_at: string | null;
};

type OrderRow = {
  id: string;
  user_id: string | null;
  customer_name: string;
  customer_email: string | null;
  service_title: string;
  amount_cents: number;
  currency: string;
  payment_status: OrderPaymentStatus;
  payment_amount_cents: number | null;
  payment_currency: string | null;
  slot_id: string | null;
  service_metadata: Record<string, unknown> | null;
};

type MercadoPagoPaymentRow = {
  id: string;
  order_id: string;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  external_reference: string;
  payment_method: PaymentMethod;
  payment_type: string | null;
  status: string;
  status_detail: string | null;
  amount_cents: number;
  currency: string;
  qr_code: string | null;
  qr_code_base64: string | null;
  ticket_url: string | null;
  digitable_line: string | null;
  barcode_content: string | null;
  expires_at: string | null;
  idempotency_key: string;
  raw_request: Record<string, unknown>;
  raw_response: Record<string, unknown>;
  created_at: string;
};

const db = supabaseAdmin as unknown as {
  // Generated Supabase types are intentionally not refreshed inside this feature branch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

const MERCADO_PAGO_API = "https://api.mercadopago.com";

function randomId() {
  return globalThis.crypto.randomUUID();
}

function hexFromBytes(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hexFromBytes(await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function nowIso() {
  return new Date().toISOString();
}

function emptyToNull(value?: string | null) {
  const clean = (value ?? "").trim();
  return clean ? clean : null;
}

function onlyDigits(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function asString(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function deepGet(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current ?? null;
}

function parseDate(value: unknown) {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function centsToAmount(cents: number) {
  return (cents / 100).toFixed(2);
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "Cliente",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "Empuria",
  };
}

function externalReference(orderId: string) {
  return `EMP-${orderId}`;
}

function mapPaymentStatus(status?: string | null, detail?: string | null): OrderPaymentStatus {
  const haystack = `${status ?? ""} ${detail ?? ""}`.toLowerCase();
  if (
    haystack.includes("approved") ||
    haystack.includes("accredited") ||
    haystack.includes("processed") ||
    haystack.includes("paid")
  ) {
    return "aprovado";
  }
  if (
    haystack.includes("rejected") ||
    haystack.includes("cancel") ||
    haystack.includes("failed") ||
    haystack.includes("expired") ||
    haystack.includes("refunded") ||
    haystack.includes("chargeback")
  ) {
    return "recusado";
  }
  return "pendente";
}

function formatBrazilExpiration(iso: string) {
  // Mercado Pago exige offset explicito (-03:00), nao aceita "Z".
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  // Convert UTC to Sao Paulo (UTC-3) without DST handling (Brasil nao usa mais DST).
  const local = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}.000-03:00`
  );
}

function notificationUrl() {
  try {
    const host = getRequestHost();
    if (!host) return undefined;
    // Mercado Pago rejects non-public URLs (localhost, IPs, .local, etc.).
    // Only send notification_url when host is a publicly reachable domain.
    const hostname = host.split(":")[0].toLowerCase();
    const isPublic =
      hostname.includes(".") &&
      !hostname.endsWith(".local") &&
      hostname !== "localhost" &&
      !hostname.startsWith("127.") &&
      !hostname.startsWith("0.") &&
      !hostname.startsWith("192.168.") &&
      !hostname.startsWith("10.") &&
      !/^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    if (!isPublic) return undefined;
    return `https://${host}/api/webhooks/mercadopago`;
  } catch {
    /* fora de request context */
  }
  return undefined;
}

function publicPayment(row: MercadoPagoPaymentRow) {
  return {
    id: row.id,
    orderId: row.order_id,
    providerOrderId: row.provider_order_id,
    providerPaymentId: row.provider_payment_id,
    method: row.payment_method,
    status: row.status,
    statusDetail: row.status_detail,
    orderPaymentStatus: mapPaymentStatus(row.status, row.status_detail),
    amountCents: row.amount_cents,
    currency: row.currency,
    qrCode: row.qr_code,
    qrCodeBase64: row.qr_code_base64,
    ticketUrl: row.ticket_url,
    digitableLine: row.digitable_line,
    barcodeContent: row.barcode_content,
    expiresAt: row.expires_at,
  };
}

function isReusablePending(row: MercadoPagoPaymentRow) {
  if (mapPaymentStatus(row.status, row.status_detail) !== "pendente") return false;
  if (!row.expires_at) return true;
  return new Date(row.expires_at).getTime() > Date.now();
}

function maskedSetting(setting: MercadoPagoSetting): MercadoPagoSetting {
  return {
    ...setting,
    access_token: setting.access_token ? "********" : null,
    webhook_secret: setting.webhook_secret ? "********" : null,
    test_access_token: setting.test_access_token ? "********" : null,
    test_webhook_secret: setting.test_webhook_secret ? "********" : null,
    prod_access_token: setting.prod_access_token ? "********" : null,
    prod_webhook_secret: setting.prod_webhook_secret ? "********" : null,
  };
}

function applyEnvironmentCredentials(row: MercadoPagoSetting): MercadoPagoSetting {
  if (row.environment === "production") {
    return {
      ...row,
      public_key: row.prod_public_key ?? null,
      access_token: row.prod_access_token ?? null,
      webhook_secret: row.prod_webhook_secret ?? null,
    };
  }
  return {
    ...row,
    public_key: row.test_public_key ?? null,
    access_token: row.test_access_token ?? null,
    webhook_secret: row.test_webhook_secret ?? null,
  };
}

async function getMercadoPagoSetting(includeSecrets = false): Promise<MercadoPagoSetting> {
  const { data, error } = await db
    .from("integration_settings")
    .select("*")
    .eq("provider", "mercadopago")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const base: MercadoPagoSetting = (data as MercadoPagoSetting | null) ?? {
    provider: "mercadopago",
    is_enabled: false,
    environment: "test",
    public_key: null,
    access_token: null,
    webhook_secret: null,
    test_public_key: null,
    test_access_token: null,
    test_webhook_secret: null,
    prod_public_key: null,
    prod_access_token: null,
    prod_webhook_secret: null,
    default_currency: "BRL",
    statement_descriptor: "EMPURIA",
    pix_enabled: true,
    boleto_enabled: true,
    card_enabled: false,
    pix_expiration_minutes: 30,
    boleto_expiration_days: 3,
    last_event_at: null,
  };
  const withActive = applyEnvironmentCredentials(base);
  return includeSecrets ? withActive : maskedSetting(withActive);
}

async function mpFetch<T>(
  path: string,
  setting: MercadoPagoSetting,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
) {
  if (!setting.access_token) throw new Error("Access Token do Mercado Pago nao configurado.");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${setting.access_token}`,
    "Content-Type": "application/json",
  };
  if (options.idempotencyKey) headers["X-Idempotency-Key"] = options.idempotencyKey;

  const response = await fetch(`${MERCADO_PAGO_API}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      asString((json as Record<string, unknown>).message) ??
      asString((json as Record<string, unknown>).error) ??
      `Mercado Pago retornou HTTP ${response.status}`;
    throw new Error(message);
  }
  return json as T;
}

async function loadOrder(orderId: string, userId: string, allowStaff = false) {
  const { data, error } = await db.from("orders").select("*").eq("id", orderId).single();
  if (error || !data) throw new Error(error?.message ?? "Pedido nao encontrado.");
  const order = data as OrderRow;
  if (!allowStaff && order.user_id !== userId) throw new Error("Pedido nao encontrado.");
  return order;
}

function assertPaymentAllowed(setting: MercadoPagoSetting, method: PaymentMethod) {
  if (!setting.is_enabled) throw new Error("Mercado Pago esta inativo.");
  if (!setting.access_token) throw new Error("Access Token do Mercado Pago nao configurado.");
  if (method === "pix" && !setting.pix_enabled) throw new Error("Pix esta desativado.");
  if (method === "boleto" && !setting.boleto_enabled) throw new Error("Boleto esta desativado.");
  if (method === "credit_card" && !setting.card_enabled) throw new Error("Cartao esta desativado.");
}

function buildPaymentPayload(args: {
  order: OrderRow;
  method: PaymentMethod;
  setting: MercadoPagoSetting;
  amountCents: number;
  fallbackExpiresAt: string | null;
  payer?: {
    cpf?: string;
    zipCode?: string;
    streetName?: string;
    streetNumber?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
  };
  card?: {
    token: string;
    paymentMethodId: string;
    installments: number;
  };
}) {
  const transaction_amount = Number(centsToAmount(args.amountCents));
  const { firstName, lastName } = splitName(args.order.customer_name);
  const payer: Record<string, unknown> = {
    email: args.order.customer_email,
    first_name: firstName,
  };
  if (args.method !== "pix") {
    payer.last_name = lastName;
    payer.identification = { type: "CPF", number: onlyDigits(args.payer?.cpf) };
  }
  if (args.method === "boleto") {
    payer.address = {
      street_name: args.payer?.streetName,
      street_number: args.payer?.streetNumber,
      zip_code: onlyDigits(args.payer?.zipCode),
      neighborhood: args.payer?.neighborhood,
      federal_unit: args.payer?.state,
      city: args.payer?.city,
    };
  }

  const payment_method_id =
    args.method === "pix"
      ? "pix"
      : args.method === "boleto"
        ? "bolbradesco"
        : args.card?.paymentMethodId;

  const payload: Record<string, unknown> = {
    transaction_amount,
    description: `${args.order.service_title} - Instituto Empuria`.slice(0, 150),
    external_reference: externalReference(args.order.id),
    payment_method_id,
    statement_descriptor: args.setting.statement_descriptor,
    payer,
  };

  const notif = notificationUrl();
  if (notif) payload.notification_url = notif;

  if (args.method === "pix" || args.method === "boleto") {
    if (args.fallbackExpiresAt) {
      payload.date_of_expiration = formatBrazilExpiration(args.fallbackExpiresAt);
    }
  }

  if (args.method === "credit_card" && args.card) {
    payload.token = args.card.token;
    payload.installments = args.card.installments;
  }

  return payload;
}

function snapshotFromResponse(response: Record<string, unknown>, fallbackExpiresAt: string | null) {
  const poi = (deepGet(response, ["point_of_interaction", "transaction_data"]) ?? {}) as Record<
    string,
    unknown
  >;
  const txDetails = (response.transaction_details ?? {}) as Record<string, unknown>;
  const barcode = (txDetails.barcode ?? {}) as Record<string, unknown>;
  const paymentMethod = (response.payment_method ?? {}) as Record<string, unknown>;
  return {
    provider_order_id: null as string | null,
    provider_payment_id: asString(response.id),
    payment_type:
      asString(response.payment_type_id) ?? asString(paymentMethod.type) ?? null,
    status: asString(response.status) ?? "pending",
    status_detail: asString(response.status_detail),
    qr_code: asString(poi.qr_code),
    qr_code_base64: asString(poi.qr_code_base64),
    ticket_url: asString(poi.ticket_url) ?? asString(txDetails.external_resource_url),
    digitable_line: asString(txDetails.digitable_line) ?? asString(txDetails.payment_method_reference_id),
    barcode_content: asString(barcode.content),
    expires_at:
      parseDate(response.date_of_expiration) ??
      parseDate(deepGet(response, ["point_of_interaction", "transaction_data", "expiration_date"])) ??
      fallbackExpiresAt,
  };
}

async function syncOrderFromPayment(row: MercadoPagoPaymentRow) {
  const status = mapPaymentStatus(row.status, row.status_detail);
  const patch: Record<string, unknown> = {
    payment_provider: "mercadopago",
    payment_provider_order_id: row.provider_order_id,
    payment_provider_payment_id: row.provider_payment_id,
    payment_provider_reference: row.external_reference,
    external_reference: row.external_reference,
    payment_method: row.payment_method,
    payment_status: status,
    payment_status_detail: row.status_detail,
    payment_url: row.ticket_url,
    payment_expires_at: row.expires_at,
    payment_amount_cents: row.amount_cents,
    payment_currency: row.currency,
  };
  if (status === "aprovado") {
    patch.paid_at = nowIso();
    patch.delivery_status = "processando";
    patch.voucher_code = `EMP-${Date.now().toString(36).toUpperCase()}`;
  }

  const { data: order } = await db
    .from("orders")
    .select("id, slot_id, service_metadata, payment_status")
    .eq("id", row.order_id)
    .maybeSingle();
  if (status === "recusado" && order?.slot_id && order.payment_status === "pendente") {
    const metadata = (order.service_metadata ?? {}) as Record<string, unknown>;
    if (!metadata.slot_released_after_payment_failure) {
      const { data: slot } = await db
        .from("availability_slots")
        .select("id, booked")
        .eq("id", order.slot_id)
        .maybeSingle();
      if (slot && slot.booked > 0) {
        await db
          .from("availability_slots")
          .update({ booked: Math.max(0, slot.booked - 1) })
          .eq("id", slot.id);
      }
      patch.service_metadata = { ...metadata, slot_released_after_payment_failure: true };
    }
  }

  const { error } = await db.from("orders").update(patch).eq("id", row.order_id);
  if (error) throw new Error(error.message);
}

async function persistPayment(args: {
  localPaymentId?: string;
  orderId: string;
  method: PaymentMethod;
  externalRef: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  rawRequest: Record<string, unknown>;
  rawResponse: Record<string, unknown>;
  fallbackExpiresAt: string | null;
  createdBy?: string | null;
}) {
  const snapshot = snapshotFromResponse(args.rawResponse, args.fallbackExpiresAt);
  const payload = {
    order_id: args.orderId,
    external_reference: args.externalRef,
    payment_method: args.method,
    amount_cents: args.amountCents,
    currency: args.currency,
    idempotency_key: args.idempotencyKey,
    raw_request: args.rawRequest,
    raw_response: args.rawResponse,
    last_checked_at: nowIso(),
    created_by: args.createdBy ?? null,
    ...snapshot,
  };
  const query = args.localPaymentId
    ? db
        .from("mercadopago_payments")
        .update(payload)
        .eq("id", args.localPaymentId)
        .select("*")
        .single()
    : db.from("mercadopago_payments").insert(payload).select("*").single();
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const row = data as MercadoPagoPaymentRow;
  await syncOrderFromPayment(row);
  return row;
}

export const getMercadoPagoAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    const [{ data: setting }, { data: events }, { count: errorCount }] = await Promise.all([
      Promise.resolve({ data: await getMercadoPagoSetting(false) }),
      db
        .from("integration_events")
        .select(
          "id,event_type,provider_event_id,buyer_email,status,processed_at,error_message,created_at",
        )
        .eq("provider", "mercadopago")
        .order("created_at", { ascending: false })
        .limit(20),
      db
        .from("integration_events")
        .select("id", { count: "exact", head: true })
        .eq("provider", "mercadopago")
        .eq("status", "error"),
    ]);
    return {
      setting,
      events: events ?? [],
      errorCount: errorCount ?? 0,
      webhookUrl: "/api/webhooks/mercadopago",
    };
  });

export const saveMercadoPagoSettings = createServerFn({ method: "POST" })
  .middleware([requireModule("configuracoes")])
  .inputValidator((d) =>
    z
      .object({
        is_enabled: z.boolean(),
        environment: z.enum(["test", "production"]),
        test_public_key: z.string().trim().max(300).nullable().optional(),
        test_access_token: z.string().trim().max(500).nullable().optional(),
        test_webhook_secret: z.string().trim().max(300).nullable().optional(),
        prod_public_key: z.string().trim().max(300).nullable().optional(),
        prod_access_token: z.string().trim().max(500).nullable().optional(),
        prod_webhook_secret: z.string().trim().max(300).nullable().optional(),
        default_currency: z.enum(["BRL", "EUR", "USD"]).default("BRL"),
        statement_descriptor: z.string().trim().min(3).max(22).default("EMPURIA"),
        pix_enabled: z.boolean(),
        boleto_enabled: z.boolean(),
        card_enabled: z.boolean(),
        pix_expiration_minutes: z.number().int().min(5).max(1440),
        boleto_expiration_days: z.number().int().min(1).max(30),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const update: Record<string, unknown> = {
      provider: "mercadopago",
      is_enabled: data.is_enabled,
      environment: data.environment,
      default_currency: data.default_currency,
      statement_descriptor: data.statement_descriptor,
      pix_enabled: data.pix_enabled,
      boleto_enabled: data.boleto_enabled,
      card_enabled: data.card_enabled,
      pix_expiration_minutes: data.pix_expiration_minutes,
      boleto_expiration_days: data.boleto_expiration_days,
    };
    // Persist explicit nulls when the user clears a field; only "undefined" means "keep".
    if (data.test_public_key !== undefined) update.test_public_key = emptyToNull(data.test_public_key);
    if (data.test_access_token !== undefined && data.test_access_token !== null && data.test_access_token !== "") {
      update.test_access_token = data.test_access_token;
    }
    if (data.test_webhook_secret !== undefined && data.test_webhook_secret !== null && data.test_webhook_secret !== "") {
      update.test_webhook_secret = data.test_webhook_secret;
    }
    if (data.prod_public_key !== undefined) update.prod_public_key = emptyToNull(data.prod_public_key);
    if (data.prod_access_token !== undefined && data.prod_access_token !== null && data.prod_access_token !== "") {
      update.prod_access_token = data.prod_access_token;
    }
    if (data.prod_webhook_secret !== undefined && data.prod_webhook_secret !== null && data.prod_webhook_secret !== "") {
      update.prod_webhook_secret = data.prod_webhook_secret;
    }
    // Mirror active environment into legacy public_key/access_token/webhook_secret so
    // callers that still read the flat fields keep working.
    const activePublic =
      data.environment === "production"
        ? data.prod_public_key
        : data.test_public_key;
    if (activePublic !== undefined) update.public_key = emptyToNull(activePublic);
    const activeToken =
      data.environment === "production"
        ? data.prod_access_token
        : data.test_access_token;
    if (activeToken !== undefined && activeToken !== null && activeToken !== "") {
      update.access_token = activeToken;
    }
    const activeWebhook =
      data.environment === "production"
        ? data.prod_webhook_secret
        : data.test_webhook_secret;
    if (activeWebhook !== undefined && activeWebhook !== null && activeWebhook !== "") {
      update.webhook_secret = activeWebhook;
    }

    const { error } = await db
      .from("integration_settings")
      .upsert(update, { onConflict: "provider" });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "mercadopago.settings.save",
      module: "configuracoes",
      entity_type: "integration_settings",
      new_data: {
        is_enabled: data.is_enabled,
        environment: data.environment,
        test_public_key: emptyToNull(data.test_public_key ?? null),
        prod_public_key: emptyToNull(data.prod_public_key ?? null),
        test_access_token: data.test_access_token ? "[updated]" : "[unchanged]",
        test_webhook_secret: data.test_webhook_secret ? "[updated]" : "[unchanged]",
        prod_access_token: data.prod_access_token ? "[updated]" : "[unchanged]",
        prod_webhook_secret: data.prod_webhook_secret ? "[updated]" : "[unchanged]",
      } as Json,
    });
    return { ok: true };
  });

export const testMercadoPagoConfiguration = createServerFn({ method: "GET" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    const setting = await getMercadoPagoSetting(true);
    const envLabel = setting.environment === "production" ? "Producao" : "Teste";
    const missing = [
      ...(!setting.public_key ? ["public_key"] : []),
      ...(!setting.access_token ? ["access_token"] : []),
      ...(!setting.webhook_secret ? ["webhook_secret"] : []),
    ];
    if (missing.length) {
      return {
        ok: false,
        missing,
        message: `Configuracao incompleta para o ambiente de ${envLabel}. Preencha as credenciais antes de testar.`,
      };
    }
    try {
      const me = await mpFetch<Record<string, unknown>>("/users/me", setting);
      const siteId = asString(me.site_id);
      const liveMode = (me as { live_mode?: boolean }).live_mode;
      const nickname = asString(me.nickname) ?? asString(me.email) ?? "conta";
      const issues: string[] = [];
      if (siteId && siteId !== "MLB") {
        issues.push(
          `A conta esta no site ${siteId}. Pix exige conta brasileira (site MLB).`,
        );
      }
      if (setting.environment === "production" && liveMode === false) {
        issues.push("Credenciais de teste enviadas no ambiente de Producao.");
      }
      if (setting.environment === "test" && liveMode === true) {
        issues.push(
          "Credenciais de Producao (live) enviadas no ambiente de Teste. Use as credenciais TEST da mesma aplicacao.",
        );
      }
      if (issues.length) {
        return { ok: false, missing: [], message: issues.join(" ") };
      }
      return {
        ok: true,
        missing: [],
        message: `Credenciais ${envLabel} validadas (conta ${nickname}, site ${siteId ?? "?"}, live_mode=${String(liveMode)}).`,
      };
    } catch (error) {
      return {
        ok: false,
        missing: [],
        message: error instanceof Error ? error.message : "Erro ao validar.",
      };
    }
  });

export const getMercadoPagoPublicCheckoutConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const setting = await getMercadoPagoSetting(false);
    return {
      enabled: setting.is_enabled,
      publicKey: setting.public_key,
      methods: {
        pix: setting.pix_enabled,
        boleto: setting.boleto_enabled,
        card: setting.card_enabled,
      },
    };
  });

export const createMercadoPagoPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        orderId: z.string().uuid(),
        method: z.enum(["pix", "boleto", "credit_card"]),
        payer: z
          .object({
            cpf: z.string().trim().max(20).optional(),
            zipCode: z.string().trim().max(20).optional(),
            streetName: z.string().trim().max(120).optional(),
            streetNumber: z.string().trim().max(40).optional(),
            neighborhood: z.string().trim().max(80).optional(),
            city: z.string().trim().max(80).optional(),
            state: z.string().trim().max(2).optional(),
          })
          .optional(),
        card: z
          .object({
            token: z.string().trim().min(8).max(300),
            paymentMethodId: z.string().trim().min(2).max(50),
            installments: z.number().int().min(1).max(12).default(1),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const setting = await getMercadoPagoSetting(true);
    assertPaymentAllowed(setting, data.method);
    const order = await loadOrder(data.orderId, context.effectiveUserId ?? context.userId);
    if (order.payment_status === "aprovado") throw new Error("Pedido ja esta pago.");
    if (data.method === "credit_card" && !data.card) throw new Error("Token do cartao ausente.");
    if (data.method === "boleto") {
      const p = data.payer;
      if (
        !p?.cpf ||
        !p.zipCode ||
        !p.streetName ||
        !p.streetNumber ||
        !p.neighborhood ||
        !p.city ||
        !p.state
      ) {
        throw new Error("Preencha CPF e endereco para gerar boleto.");
      }
    }

    const amountCents = order.payment_amount_cents ?? order.amount_cents;
    const currency = order.payment_currency ?? order.currency;
    if (currency !== "BRL") throw new Error("Mercado Pago Brasil exige cobranca em BRL.");
    if (amountCents <= 0) throw new Error("Pedido sem valor para pagamento.");

    const { data: existing } = await db
      .from("mercadopago_payments")
      .select("*")
      .eq("order_id", order.id)
      .eq("payment_method", data.method)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing && isReusablePending(existing as MercadoPagoPaymentRow)) {
      return {
        payment: publicPayment(existing as MercadoPagoPaymentRow),
        publicKey: setting.public_key,
      };
    }

    const idempotencyKey = randomId();
    const fallbackExpiresAt =
      data.method === "pix"
        ? new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60000).toISOString()
        : data.method === "boleto"
          ? new Date(Date.now() + setting.boleto_expiration_days * 86400000).toISOString()
          : null;
    const payload = buildPaymentPayload({
      order,
      method: data.method,
      setting,
      amountCents,
      fallbackExpiresAt,
      payer: data.payer,
      card: data.card,
    });
    const response = await mpFetch<Record<string, unknown>>("/v1/payments", setting, {
      method: "POST",
      body: payload,
      idempotencyKey,
    });
    const row = await persistPayment({
      orderId: order.id,
      method: data.method,
      externalRef: externalReference(order.id),
      amountCents,
      currency,
      idempotencyKey,
      rawRequest: payload,
      rawResponse: response,
      fallbackExpiresAt,
      createdBy: context.userId,
    });
    return { payment: publicPayment(row), publicKey: setting.public_key };
  });

export const checkMercadoPagoPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const setting = await getMercadoPagoSetting(true);
    const order = await loadOrder(data.orderId, context.effectiveUserId ?? context.userId);
    const { data: latest, error } = await db
      .from("mercadopago_payments")
      .select("*")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!latest) return { payment: null, orderPaymentStatus: order.payment_status };
    const row = latest as MercadoPagoPaymentRow;
    if (!row.provider_payment_id)
      return { payment: publicPayment(row), orderPaymentStatus: order.payment_status };
    const response = await mpFetch<Record<string, unknown>>(
      `/v1/payments/${row.provider_payment_id}`,
      setting,
    );
    const updated = await persistPayment({
      localPaymentId: row.id,
      orderId: row.order_id,
      method: row.payment_method,
      externalRef: row.external_reference,
      amountCents: row.amount_cents,
      currency: row.currency,
      idempotencyKey: row.idempotency_key,
      rawRequest: row.raw_request,
      rawResponse: response,
      fallbackExpiresAt: row.expires_at,
    });
    return {
      payment: publicPayment(updated),
      orderPaymentStatus: mapPaymentStatus(updated.status, updated.status_detail),
    };
  });

export async function validateMercadoPagoWebhook(
  request: Request,
  payload: Record<string, unknown>,
) {
  const setting = await getMercadoPagoSetting(true);
  if (!setting.is_enabled) return { ok: false, message: "Mercado Pago integration disabled" };
  if (!setting.webhook_secret)
    return { ok: false, message: "Mercado Pago webhook secret not configured" };

  const signature = request.headers.get("x-signature") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  const dataId = asString(deepGet(payload, ["data", "id"])) ?? asString(payload.id);
  const parts = Object.fromEntries(
    signature
      .split(",")
      .map((part) => part.split("=", 2).map((value) => value.trim()))
      .filter((part) => part.length === 2),
  );
  if (!dataId || !requestId || !parts.ts || !parts.v1)
    return { ok: false, message: "Invalid Mercado Pago signature headers" };

  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  const digest = await hmacSha256Hex(setting.webhook_secret, manifest);
  const ok = digest.toLowerCase() === parts.v1.toLowerCase();
  return { ok, message: "Invalid Mercado Pago webhook signature" };
}

export async function processMercadoPagoWebhook(
  payload: Record<string, unknown>,
  fallbackEventId: string,
) {
  const setting = await getMercadoPagoSetting(true);
  const eventType = asString(payload.action) ?? asString(payload.type) ?? "unknown";
  const providerEventId =
    asString(payload.id) ?? asString(deepGet(payload, ["data", "id"])) ?? fallbackEventId;
  const { data: eventInsert, error: eventErr } = await db
    .from("integration_events")
    .insert({
      provider: "mercadopago",
      event_type: eventType,
      provider_event_id: providerEventId,
      buyer_email: null,
      payload,
      status: "received",
    })
    .select("id")
    .single();
  if (eventErr) {
    if (eventErr.code === "23505") return { ok: true, status: "duplicate" };
    throw new Error(eventErr.message);
  }

  const eventId = eventInsert.id as string;
  try {
    const dataId = asString(deepGet(payload, ["data", "id"])) ?? providerEventId;
    const { data: payment } = await db
      .from("mercadopago_payments")
      .select("*")
      .eq("provider_payment_id", dataId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = payment as MercadoPagoPaymentRow | null;
    if (!row?.provider_payment_id) {
      await db
        .from("integration_events")
        .update({
          status: "unmatched",
          processed_at: nowIso(),
          error_message: `Pagamento nao encontrado: ${dataId}`,
        })
        .eq("id", eventId);
      return { ok: true, status: "unmatched", eventId };
    }

    const response = await mpFetch<Record<string, unknown>>(
      `/v1/payments/${row.provider_payment_id}`,
      setting,
    );
    const updated = await persistPayment({
      localPaymentId: row.id,
      orderId: row.order_id,
      method: row.payment_method,
      externalRef: row.external_reference,
      amountCents: row.amount_cents,
      currency: row.currency,
      idempotencyKey: row.idempotency_key,
      rawRequest: row.raw_request,
      rawResponse: response,
      fallbackExpiresAt: row.expires_at,
    });
    await db
      .from("integration_events")
      .update({
        status: "processed",
        processed_at: nowIso(),
        buyer_email: asString(deepGet(response, ["payer", "email"])),
      })
      .eq("id", eventId);
    await db
      .from("integration_settings")
      .update({ last_event_at: nowIso() })
      .eq("provider", "mercadopago");
    return {
      ok: true,
      status: "processed",
      eventId,
      orderPaymentStatus: mapPaymentStatus(updated.status, updated.status_detail),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    await db
      .from("integration_events")
      .update({ status: "error", processed_at: nowIso(), error_message: message })
      .eq("id", eventId);
    return { ok: false, status: "error", eventId, message };
  }
}
