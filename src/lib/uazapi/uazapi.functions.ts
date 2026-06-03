/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireModule } from "@/lib/admin/auth";
import type { Json } from "@/integrations/supabase/types";

type WhatsAppMode = "disabled" | "suggestion" | "automatic";
type UazapiConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

type UazapiSetting = {
  provider: "whatsapp";
  is_enabled: boolean;
  webhook_secret: string | null;
  last_event_at: string | null;
  uazapi_base_url: string;
  uazapi_admin_token: string | null;
  uazapi_instance_id: string | null;
  uazapi_instance_token: string | null;
  uazapi_instance_name: string;
  uazapi_connection_status: UazapiConnectionStatus;
  uazapi_profile_name: string | null;
  uazapi_profile_pic_url: string | null;
  uazapi_phone: string | null;
  uazapi_webhook_id: string | null;
  uazapi_webhook_configured_at: string | null;
  uazapi_last_connection_at: string | null;
  uazapi_last_qr_at: string | null;
  whatsapp_mode: WhatsAppMode;
};

type UazapiEventRow = {
  id: string;
  event_type: string;
  provider_event_id: string | null;
  buyer_email: string | null;
  status: string;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
};

type ProcessResult = {
  ok: boolean;
  status: string;
  eventId?: string;
  message?: string;
};

const db = supabaseAdmin as unknown as {
  from: (table: string) => any;
};

const DEFAULT_UAZAPI_BASE_URL = "https://api.uazapi.com";
const DEFAULT_INSTANCE_NAME = "instituto-empuria";
const UAZAPI_EVENTS = ["messages", "messages_update", "connection"] as const;
const UAZAPI_EXCLUDED_MESSAGES = ["wasSentByApi", "isGroupYes"] as const;

function nowIso() {
  return new Date().toISOString();
}

function emptyToNull(value?: string | null) {
  const clean = (value ?? "").trim();
  return clean ? clean : null;
}

function normalizeBaseUrl(value?: string | null) {
  const clean = (value ?? DEFAULT_UAZAPI_BASE_URL).trim().replace(/\/+$/, "");
  return clean || DEFAULT_UAZAPI_BASE_URL;
}

function asString(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asBool(value: unknown) {
  return typeof value === "boolean" ? value : null;
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

function normalizePhone(value?: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function phoneFromChat(value?: string | null) {
  const text = value ?? "";
  const beforeAt = text.includes("@") ? text.split("@")[0] : text;
  return normalizePhone(beforeAt);
}

function firstObjectWithMessageShape(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (
    obj.messageid !== undefined ||
    obj.chatid !== undefined ||
    obj.sender !== undefined ||
    obj.text !== undefined ||
    obj.messageType !== undefined
  ) {
    return obj;
  }
  for (const child of Object.values(obj)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = firstObjectWithMessageShape(item);
        if (found) return found;
      }
    } else if (child && typeof child === "object") {
      const found = firstObjectWithMessageShape(child);
      if (found) return found;
    }
  }
  return null;
}

function safeJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? {})) as Json;
}

function maskedSetting(setting: UazapiSetting): UazapiSetting {
  return {
    ...setting,
    webhook_secret: setting.webhook_secret ? "********" : null,
    uazapi_admin_token: setting.uazapi_admin_token ? "********" : null,
    uazapi_instance_token: setting.uazapi_instance_token ? "********" : null,
  };
}

function fallbackSetting(): UazapiSetting {
  return {
    provider: "whatsapp",
    is_enabled: false,
    webhook_secret: null,
    last_event_at: null,
    uazapi_base_url: DEFAULT_UAZAPI_BASE_URL,
    uazapi_admin_token: null,
    uazapi_instance_id: null,
    uazapi_instance_token: null,
    uazapi_instance_name: DEFAULT_INSTANCE_NAME,
    uazapi_connection_status: "disconnected",
    uazapi_profile_name: null,
    uazapi_profile_pic_url: null,
    uazapi_phone: null,
    uazapi_webhook_id: null,
    uazapi_webhook_configured_at: null,
    uazapi_last_connection_at: null,
    uazapi_last_qr_at: null,
    whatsapp_mode: "suggestion",
  };
}

async function getUazapiSetting(includeSecrets = false): Promise<UazapiSetting> {
  const { data, error } = await db
    .from("integration_settings")
    .select("*")
    .eq("provider", "whatsapp")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = { ...fallbackSetting(), ...(data ?? {}) } as UazapiSetting;
  return includeSecrets ? row : maskedSetting(row);
}

async function uazapiFetch<T>(
  setting: UazapiSetting,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    auth: "admin" | "instance";
  },
) {
  const token =
    options.auth === "admin" ? setting.uazapi_admin_token : setting.uazapi_instance_token;
  if (!token) {
    throw new Error(
      options.auth === "admin"
        ? "Admin token da Uazapi nao configurado."
        : "Token da instancia Uazapi nao configurado.",
    );
  }

  const response = await fetch(`${normalizeBaseUrl(setting.uazapi_base_url)}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      [options.auth === "admin" ? "admintoken" : "token"]: token,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      asString((json as Record<string, unknown>).error) ??
      asString((json as Record<string, unknown>).message) ??
      `Uazapi respondeu HTTP ${response.status}`;
    throw new Error(message);
  }
  return json as T;
}

function extractInstance(payload: Record<string, unknown>) {
  const instance = (payload.instance ?? payload) as Record<string, unknown>;
  const status =
    asString(instance.status) ??
    (asBool(deepFind(payload, ["connected"])) ? "connected" : null) ??
    "disconnected";
  return {
    id: asString(instance.id) ?? asString(payload.instanceId),
    token: asString(instance.token) ?? asString(payload.token),
    name: asString(instance.name) ?? asString(payload.name),
    status: status as UazapiConnectionStatus,
    profileName: asString(instance.profileName),
    profilePicUrl: asString(instance.profilePicUrl),
    phone:
      phoneFromChat(asString(deepFind(payload, ["jid", "user"]))) ??
      phoneFromChat(asString(instance.owner)) ??
      null,
    qrcode: asString(instance.qrcode) ?? asString(payload.qrcode),
    paircode: asString(instance.paircode) ?? asString(payload.paircode),
  };
}

async function saveInstanceSnapshot(payload: Record<string, unknown>) {
  const instance = extractInstance(payload);
  const patch: Record<string, unknown> = {
    uazapi_connection_status: instance.status,
  };
  if (instance.id) patch.uazapi_instance_id = instance.id;
  if (instance.token) patch.uazapi_instance_token = instance.token;
  if (instance.name) patch.uazapi_instance_name = instance.name;
  if (instance.profileName) patch.uazapi_profile_name = instance.profileName;
  if (instance.profilePicUrl) patch.uazapi_profile_pic_url = instance.profilePicUrl;
  if (instance.phone) patch.uazapi_phone = instance.phone;
  if (instance.status === "connected") patch.uazapi_last_connection_at = nowIso();
  const { error } = await db.from("integration_settings").update(patch).eq("provider", "whatsapp");
  if (error) throw new Error(error.message);
  return instance;
}

function webhookUrlWithSecret(webhookUrl: string, secret: string | null) {
  const url = new URL(webhookUrl);
  if (secret) url.searchParams.set("token", secret);
  return url.toString();
}

async function ensureUazapiInstance(setting: UazapiSetting) {
  if (setting.uazapi_instance_token) return setting;

  const all = await uazapiFetch<unknown>(setting, "/instance/all", { auth: "admin" });
  const instances = Array.isArray(all) ? all : ((all as Record<string, unknown>).instances ?? []);
  const existing = Array.isArray(instances)
    ? instances.find((item) => {
        const instance = item as Record<string, unknown>;
        return asString(instance.name) === setting.uazapi_instance_name;
      })
    : null;

  const payload = existing
    ? (existing as Record<string, unknown>)
    : await uazapiFetch<Record<string, unknown>>(setting, "/instance/create", {
        auth: "admin",
        method: "POST",
        body: {
          name: setting.uazapi_instance_name,
          adminField01: "instituto-empuria",
          adminField02: "created-by-admin-settings",
        },
      });

  const instance = extractInstance(payload);
  const next: UazapiSetting = {
    ...setting,
    uazapi_instance_id: instance.id ?? setting.uazapi_instance_id,
    uazapi_instance_token: instance.token ?? setting.uazapi_instance_token,
    uazapi_instance_name: instance.name ?? setting.uazapi_instance_name,
    uazapi_connection_status: instance.status ?? setting.uazapi_connection_status,
  };

  const { error } = await db
    .from("integration_settings")
    .update({
      uazapi_instance_id: next.uazapi_instance_id,
      uazapi_instance_token: next.uazapi_instance_token,
      uazapi_instance_name: next.uazapi_instance_name,
      uazapi_connection_status: next.uazapi_connection_status,
    })
    .eq("provider", "whatsapp");
  if (error) throw new Error(error.message);
  if (!next.uazapi_instance_token) throw new Error("A Uazapi nao retornou token da instancia.");
  return next;
}

async function configureInstanceWebhook(setting: UazapiSetting, publicWebhookUrl: string) {
  if (!setting.webhook_secret) {
    throw new Error("Configure um segredo de webhook antes de conectar o WhatsApp.");
  }
  const response = await uazapiFetch<unknown>(setting, "/webhook", {
    auth: "instance",
    method: "POST",
    body: {
      enabled: true,
      url: webhookUrlWithSecret(publicWebhookUrl, setting.webhook_secret),
      events: UAZAPI_EVENTS,
      excludeMessages: UAZAPI_EXCLUDED_MESSAGES,
      addUrlEvents: false,
      addUrlTypesMessages: false,
    },
  });
  const first = Array.isArray(response)
    ? (response[0] as Record<string, unknown> | undefined)
    : null;
  const { error } = await db
    .from("integration_settings")
    .update({
      uazapi_webhook_id: asString(first?.id),
      uazapi_webhook_configured_at: nowIso(),
    })
    .eq("provider", "whatsapp");
  if (error) throw new Error(error.message);
  return response;
}

export const getUazapiAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    const [{ data: setting }, { data: events }, { count: errorCount }] = await Promise.all([
      Promise.resolve({ data: await getUazapiSetting(false) }),
      db
        .from("integration_events")
        .select(
          "id, event_type, provider_event_id, buyer_email, status, processed_at, error_message, created_at",
        )
        .eq("provider", "whatsapp")
        .order("created_at", { ascending: false })
        .limit(12),
      db
        .from("integration_events")
        .select("id", { count: "exact", head: true })
        .eq("provider", "whatsapp")
        .eq("status", "error"),
    ]);
    return {
      setting,
      events: (events ?? []) as UazapiEventRow[],
      errorCount: errorCount ?? 0,
      webhookUrl: "/api/webhooks/uazapi",
    };
  });

export const saveUazapiSettings = createServerFn({ method: "POST" })
  .middleware([requireModule("configuracoes")])
  .inputValidator((d) =>
    z
      .object({
        is_enabled: z.boolean(),
        uazapi_base_url: z.string().trim().url().max(500).optional().nullable(),
        uazapi_admin_token: z.string().trim().min(8).max(500).optional().nullable(),
        uazapi_instance_name: z.string().trim().min(3).max(80),
        webhook_secret: z.string().trim().min(8).max(240).optional().nullable(),
        whatsapp_mode: z.enum(["disabled", "suggestion", "automatic"]).default("suggestion"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const update: Record<string, unknown> = {
      provider: "whatsapp",
      is_enabled: data.is_enabled,
      uazapi_base_url: normalizeBaseUrl(data.uazapi_base_url),
      uazapi_instance_name: data.uazapi_instance_name,
      whatsapp_mode: data.whatsapp_mode,
    };
    if (data.uazapi_admin_token) update.uazapi_admin_token = data.uazapi_admin_token;
    if (data.webhook_secret) update.webhook_secret = data.webhook_secret;

    const { error } = await db
      .from("integration_settings")
      .upsert(update, { onConflict: "provider" });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "uazapi.settings.save",
      module: "configuracoes",
      entity_type: "integration_settings",
      new_data: {
        ...update,
        uazapi_admin_token: data.uazapi_admin_token ? "[updated]" : "[unchanged]",
        webhook_secret: data.webhook_secret ? "[updated]" : "[unchanged]",
      } as Json,
    });
    return { ok: true };
  });

export const testUazapiConfiguration = createServerFn({ method: "GET" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    const setting = await getUazapiSetting(true);
    const missing = [
      ...(!setting.uazapi_admin_token ? ["admin_token"] : []),
      ...(!setting.webhook_secret ? ["webhook_secret"] : []),
    ];
    if (missing.length) {
      return { ok: false, missing, message: "Configuracao incompleta." };
    }
    await uazapiFetch(setting, "/instance/all", { auth: "admin" });
    return { ok: true, missing: [], message: "Credenciais Uazapi respondendo corretamente." };
  });

export const generateUazapiQrCode = createServerFn({ method: "POST" })
  .middleware([requireModule("configuracoes")])
  .inputValidator((d) => z.object({ webhookUrl: z.string().trim().url() }).parse(d))
  .handler(async ({ data }) => {
    let setting = await getUazapiSetting(true);
    if (!setting.is_enabled) throw new Error("Ative a integracao antes de gerar o QR Code.");
    setting = await ensureUazapiInstance(setting);
    await configureInstanceWebhook(setting, data.webhookUrl);

    const response = await uazapiFetch<Record<string, unknown>>(setting, "/instance/connect", {
      auth: "instance",
      method: "POST",
      body: {},
    });
    const instance = await saveInstanceSnapshot(response);
    const qrcode = instance.qrcode ?? asString(deepFind(response, ["qrcode", "qrCode"]));
    const paircode = instance.paircode ?? asString(deepFind(response, ["paircode", "pairCode"]));

    await db
      .from("integration_settings")
      .update({
        uazapi_connection_status: instance.status === "connected" ? "connected" : "connecting",
        uazapi_last_qr_at: nowIso(),
      })
      .eq("provider", "whatsapp");

    return {
      ok: true,
      status: instance.status,
      qrcode,
      paircode,
      message: qrcode ? "QR Code gerado." : "Conexao iniciada. Atualize o status em instantes.",
    };
  });

export const refreshUazapiStatus = createServerFn({ method: "GET" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    const setting = await getUazapiSetting(true);
    if (!setting.uazapi_instance_token) {
      return { ok: true, status: "disconnected" as const, qrcode: null, paircode: null };
    }
    const response = await uazapiFetch<Record<string, unknown>>(setting, "/instance/status", {
      auth: "instance",
    });
    const instance = await saveInstanceSnapshot(response);
    return {
      ok: true,
      status: instance.status,
      qrcode: instance.qrcode,
      paircode: instance.paircode,
      profileName: instance.profileName,
      phone: instance.phone,
    };
  });

export const disconnectUazapiInstance = createServerFn({ method: "POST" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    const setting = await getUazapiSetting(true);
    if (!setting.uazapi_instance_token) return { ok: true, status: "disconnected" as const };
    const response = await uazapiFetch<Record<string, unknown>>(setting, "/instance/disconnect", {
      auth: "instance",
      method: "POST",
    });
    await saveInstanceSnapshot(response);
    await db
      .from("integration_settings")
      .update({ uazapi_connection_status: "disconnected" })
      .eq("provider", "whatsapp");
    return { ok: true, status: "disconnected" as const };
  });

export async function validateUazapiWebhookSecret(request: Request) {
  const setting = await getUazapiSetting(true);
  if (!setting.is_enabled) return { ok: false, message: "WhatsApp integration disabled" };
  if (!setting.webhook_secret)
    return { ok: false, message: "WhatsApp webhook secret not configured" };
  const auth = request.headers.get("authorization") ?? "";
  const candidates = [
    request.headers.get("x-uazapi-secret"),
    request.headers.get("x-webhook-secret"),
    auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : null,
    new URL(request.url).searchParams.get("token"),
  ].filter(Boolean);
  return {
    ok: candidates.some((candidate) => candidate === setting.webhook_secret),
    message: "Invalid WhatsApp webhook secret",
  };
}

function parseWebhookPayload(payload: Record<string, unknown>, fallbackEventId: string) {
  const message = firstObjectWithMessageShape(payload);
  const eventType =
    asString(payload.event) ??
    asString(payload.type) ??
    asString(payload.event_type) ??
    (message ? "messages" : "unknown");
  const providerEventId =
    asString(message?.messageid) ??
    asString(payload.id) ??
    asString(payload.event_id) ??
    fallbackEventId;
  const chatId = asString(message?.chatid) ?? asString(deepFind(payload, ["chatid", "wa_chatid"]));
  const sender = asString(message?.sender) ?? asString(deepFind(payload, ["sender", "from"]));
  const phone = phoneFromChat(sender) ?? phoneFromChat(chatId);
  return {
    eventType,
    providerEventId,
    message,
    chatId,
    phone,
    senderName:
      asString(message?.senderName) ??
      asString(deepFind(payload, ["senderName", "pushName", "name", "wa_name"])),
    fromMe: asBool(message?.fromMe) ?? asBool(deepFind(payload, ["fromMe"])) ?? false,
    isGroup:
      asBool(message?.isGroup) ?? asBool(deepFind(payload, ["isGroup", "wa_isGroup"])) ?? false,
    wasSentByApi:
      asBool(message?.wasSentByApi) ?? asBool(deepFind(payload, ["wasSentByApi"])) ?? false,
    messageType:
      asString(message?.messageType) ??
      asString(deepFind(payload, ["messageType", "type"])) ??
      "text",
    body:
      asString(message?.text) ??
      asString(deepFind(payload, ["text", "conversation", "caption", "body"])) ??
      null,
  };
}

async function findLeadByPhone(phone: string | null) {
  if (!phone) return null;
  const { data, error } = await db
    .from("leads")
    .select("id, full_name, phone")
    .order("created_at", { ascending: false })
    .limit(800);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; full_name: string; phone: string | null }>).find(
    (lead) => normalizePhone(lead.phone) === phone,
  );
}

async function recordInboundMessage(
  parsed: ReturnType<typeof parseWebhookPayload>,
  payload: Record<string, unknown>,
) {
  if (!parsed.phone) return { status: "ignored", reason: "Telefone nao identificado." };
  if (parsed.fromMe || parsed.wasSentByApi || parsed.isGroup) {
    return { status: "ignored", reason: "Mensagem enviada pela propria instancia, API ou grupo." };
  }

  const lead = await findLeadByPhone(parsed.phone);
  const inboxInsert = {
    provider: "whatsapp",
    provider_message_id: parsed.providerEventId,
    provider_chat_id: parsed.chatId ?? `wa:${parsed.phone}`,
    from_phone: parsed.phone,
    from_name: parsed.senderName,
    message_type: parsed.messageType,
    body: parsed.body,
    raw_payload: payload,
    matched_lead_id: lead?.id ?? null,
    status: lead?.id ? "linked" : "received",
  };
  const { data: inbox, error: inboxError } = await db
    .from("crm_inbox_messages")
    .insert(inboxInsert)
    .select("id")
    .single();
  if (inboxError) {
    if (inboxError.code === "23505") return { status: "duplicate", reason: "Mensagem duplicada." };
    throw new Error(inboxError.message);
  }

  if (!lead?.id) return { status: "received", inboxId: inbox.id as string };

  const receivedAt = nowIso();
  const { data: conversation, error: conversationError } = await db
    .from("crm_conversations")
    .upsert(
      {
        lead_id: lead.id,
        provider: "whatsapp",
        provider_chat_id: parsed.chatId ?? `wa:${parsed.phone}`,
        phone: parsed.phone,
        last_message_at: receivedAt,
        last_inbound_at: receivedAt,
      },
      { onConflict: "provider,provider_chat_id" },
    )
    .select("id")
    .single();
  if (conversationError) throw new Error(conversationError.message);

  const { error: messageError } = await db.from("crm_messages").insert({
    lead_id: lead.id,
    conversation_id: conversation.id,
    direction: "inbound",
    provider: "whatsapp",
    provider_message_id: parsed.providerEventId,
    body: parsed.body,
    message_type: parsed.messageType,
    status: "received",
    created_at: receivedAt,
  });
  if (messageError) {
    if (messageError.code !== "23505") throw new Error(messageError.message);
  }

  await db
    .from("leads")
    .update({ last_inbound_at: receivedAt, last_interaction_at: receivedAt })
    .eq("id", lead.id);

  return { status: "processed", inboxId: inbox.id as string, leadId: lead.id };
}

export async function processUazapiWebhook(
  payload: Record<string, unknown>,
  fallbackEventId: string,
): Promise<ProcessResult> {
  const parsed = parseWebhookPayload(payload, fallbackEventId);
  const { data: eventInsert, error: eventErr } = await db
    .from("integration_events")
    .insert({
      provider: "whatsapp",
      event_type: parsed.eventType,
      provider_event_id: parsed.providerEventId,
      payload,
      status: "received",
    })
    .select("id")
    .single();

  if (eventErr) {
    if (eventErr.code === "23505") {
      return { ok: true, status: "duplicate", message: "Duplicate event" };
    }
    throw new Error(eventErr.message);
  }

  const eventId = eventInsert.id as string;
  try {
    if (parsed.eventType.includes("connection")) {
      await saveInstanceSnapshot(payload);
      await db
        .from("integration_events")
        .update({ status: "processed", processed_at: nowIso() })
        .eq("id", eventId);
      await db
        .from("integration_settings")
        .update({ last_event_at: nowIso() })
        .eq("provider", "whatsapp");
      return { ok: true, status: "processed", eventId };
    }

    const result = await recordInboundMessage(parsed, payload);
    await db
      .from("integration_events")
      .update({
        status:
          result.status === "processed" || result.status === "received"
            ? "processed"
            : result.status,
        processed_at: nowIso(),
        error_message: result.reason ?? null,
      })
      .eq("id", eventId);
    await db
      .from("integration_settings")
      .update({ last_event_at: nowIso() })
      .eq("provider", "whatsapp");
    return { ok: true, status: result.status, eventId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao processar webhook Uazapi";
    await db
      .from("integration_events")
      .update({ status: "error", processed_at: nowIso(), error_message: message })
      .eq("id", eventId);
    return { ok: false, status: "error", eventId, message };
  }
}

export async function sendUazapiTextInternal({
  number,
  text,
  trackId,
}: {
  number: string;
  text: string;
  trackId?: string | null;
}) {
  const setting = await getUazapiSetting(true);
  if (!setting.is_enabled || setting.whatsapp_mode === "disabled") {
    throw new Error("WhatsApp/Uazapi esta desativado.");
  }
  if (setting.uazapi_connection_status !== "connected") {
    throw new Error("WhatsApp/Uazapi ainda nao esta conectado.");
  }
  const phone = normalizePhone(number);
  if (!phone) throw new Error("Telefone invalido para envio via WhatsApp.");

  const response = await uazapiFetch<Record<string, unknown>>(setting, "/send/text", {
    auth: "instance",
    method: "POST",
    body: {
      number: phone,
      text,
      readchat: true,
      readmessages: true,
      track_source: "empuria_crm",
      track_id: trackId ?? undefined,
      async: false,
    },
  });
  return {
    providerMessageId:
      asString(deepFind(response, ["messageid", "messageId", "id"])) ?? trackId ?? null,
    status: asString(deepFind(response, ["status", "response"])) ?? "sent",
    raw: response,
  };
}
