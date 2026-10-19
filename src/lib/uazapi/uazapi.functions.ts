/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireModule } from "@/lib/admin/auth";
import type { Json } from "@/integrations/supabase/types";
import {
  normalizePhone as normalizeE164Phone,
  phoneToWhatsAppJid,
} from "@/lib/phone/phone.utils";
import {
  belongsToUazapiInstance,
  confirmedInstanceWebhook,
  equalSecret,
  redactUazapiValue,
  uazapiEventType,
} from "@/lib/uazapi/uazapi.webhook";


type WhatsAppMode = "disabled" | "suggestion" | "automatic";
type UazapiConnectionStatus = "disconnected" | "connecting" | "connected" | "hibernated" | "error";

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
  httpStatus?: number;
  eventId?: string;
  message?: string;
};

const db = supabaseAdmin as unknown as {
  from: (table: string) => any;
};

const DEFAULT_UAZAPI_BASE_URL = "https://senseys.uazapi.com";
const DEFAULT_INSTANCE_NAME = "instituto-empuria";
const PUBLIC_WEBHOOK_URL = "https://institutoempuria.net/api/webhooks/uazapi";
const UAZAPI_EVENTS = ["messages", "messages_update", "connection"] as const;
const UAZAPI_EXCLUDED_MESSAGES = ["wasSentByApi", "isGroupYes"] as const;

function nowIso() {
  return new Date().toISOString();
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

/** Apenas dígitos (>=8). Usado para extrair número cru de um JID/chatid. */
function digitsOnly(value?: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function phoneFromChat(value?: string | null) {
  const text = value ?? "";
  const beforeAt = text.includes("@") ? text.split("@")[0] : text;
  return digitsOnly(beforeAt);
}

/**
 * Converte um número cru (JID ou digits) para E.164.
 * Como a Uazapi sempre devolve dígitos com DDI, primeiro tenta interpretar
 * o número como já internacional (prefixando '+'); se falhar, assume BR.
 */
function toE164FromRaw(value?: string | null): string | null {
  const digits = digitsOnly(value);
  if (!digits) return null;
  return (
    normalizeE164Phone(`+${digits}`) ??
    normalizeE164Phone(digits, "BR") ??
    null
  );
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

function publicSetting(setting: UazapiSetting) {
  return {
    is_enabled: setting.is_enabled,
    last_event_at: setting.last_event_at,
    uazapi_connection_status: setting.uazapi_connection_status,
    uazapi_profile_name: setting.uazapi_profile_name,
    uazapi_phone: setting.uazapi_phone,
    uazapi_webhook_configured_at: setting.uazapi_webhook_configured_at,
    uazapi_last_qr_at: setting.uazapi_last_qr_at,
    has_instance: Boolean(setting.uazapi_instance_id || setting.uazapi_instance_token),
    has_webhook: Boolean(setting.uazapi_webhook_configured_at),
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
  const row = {
    ...fallbackSetting(),
    ...(data ?? {}),
    uazapi_base_url: DEFAULT_UAZAPI_BASE_URL,
    uazapi_instance_name: DEFAULT_INSTANCE_NAME,
    uazapi_admin_token: null,
    uazapi_instance_token: null,
    webhook_secret: null,
  } as UazapiSetting;
  if (!includeSecrets) return row;
  const { data: secrets, error: secretError } = await db
    .from("uazapi_connection_secrets")
    .select("admin_token, instance_token, webhook_secret")
    .eq("provider", "whatsapp")
    .maybeSingle();
  if (secretError) throw new Error("Nao foi possivel carregar as credenciais da Uazapi.");
  return {
    ...row,
    uazapi_admin_token: secrets?.admin_token ?? null,
    uazapi_instance_token: secrets?.instance_token ?? null,
    webhook_secret: secrets?.webhook_secret ?? null,
  };
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

  let response: Response;
  try {
    response = await fetch(`${DEFAULT_UAZAPI_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        [options.auth === "admin" ? "admintoken" : "token"]: token,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("Nao foi possivel acessar a Uazapi. Tente novamente em instantes.");
  }
  const text = await response.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    if (response.ok) throw new Error("Resposta invalida da Uazapi.");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error("A Uazapi recusou a credencial desta instancia.");
    if (response.status === 429)
      throw new Error("Limite de chamadas da Uazapi atingido. Aguarde e tente novamente.");
    throw new Error(`Uazapi indisponivel ou recusou a operacao (HTTP ${response.status}).`);
  }
  return json as T;
}

function extractInstance(payload: Record<string, unknown>) {
  const instance = (payload.instance && typeof payload.instance === "object"
    ? payload.instance
    : payload) as Record<string, unknown>;
  const rawStatus = asString(instance.status) ?? asString(payload.status);
  const status = (
    ["disconnected", "connecting", "connected", "hibernated", "error"].includes(rawStatus ?? "")
      ? rawStatus
      : asBool(payload.connected) === true
        ? "connected"
        : asBool(payload.connected) === false
          ? "disconnected"
          : null
  ) as UazapiConnectionStatus | null;
  return {
    id: asString(instance.id) ?? asString(payload.instanceId),
    token: asString(instance.token) ?? asString(payload.token),
    name: asString(instance.name) ?? asString(payload.name),
    status,
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
  const patch: Record<string, unknown> = {};
  if (instance.status) patch.uazapi_connection_status = instance.status;
  if (instance.id) patch.uazapi_instance_id = instance.id;
  if (instance.profileName) patch.uazapi_profile_name = instance.profileName;
  if (instance.profilePicUrl) patch.uazapi_profile_pic_url = instance.profilePicUrl;
  if (instance.phone) patch.uazapi_phone = instance.phone;
  if (instance.status === "disconnected") {
    patch.uazapi_profile_name = null;
    patch.uazapi_phone = null;
  }
  if (instance.status === "connected") patch.uazapi_last_connection_at = nowIso();
  if (Object.keys(patch).length) {
    const { error } = await db.from("integration_settings").update(patch).eq("provider", "whatsapp");
    if (error) throw new Error(error.message);
  }
  return instance;
}

function webhookUrlWithSecret(secret: string) {
  const url = new URL(PUBLIC_WEBHOOK_URL);
  url.searchParams.set("token", secret);
  return url.toString();
}

async function ensureUazapiInstance(setting: UazapiSetting) {
  const all = await uazapiFetch<unknown>(setting, "/instance/all", { auth: "admin" });
  const instances = Array.isArray(all) ? all : ((all as Record<string, unknown>).instances ?? []);
  if (!Array.isArray(instances)) throw new Error("Lista de instancias Uazapi invalida.");
  const matches = instances.filter(
    (item) => item && typeof item === "object" &&
      asString((item as Record<string, unknown>).name) === DEFAULT_INSTANCE_NAME,
  );
  if (matches.length > 1)
    throw new Error("Ha mais de uma instancia com o nome esperado; operacao interrompida.");
  const existing = matches[0] as Record<string, unknown> | undefined;

  const payload = existing
    ? existing
    : await uazapiFetch<Record<string, unknown>>(setting, "/instance/create", {
        auth: "admin",
        method: "POST",
        body: { name: DEFAULT_INSTANCE_NAME },
      });

  const instance = extractInstance(payload);
  if (instance.name !== DEFAULT_INSTANCE_NAME || !instance.token || !instance.id)
    throw new Error("Nao foi possivel confirmar identidade e token da instancia Uazapi.");
  if (setting.uazapi_instance_id && setting.uazapi_instance_id !== instance.id)
    throw new Error("A instancia encontrada nao corresponde a configuracao existente.");
  if (setting.uazapi_instance_token && setting.uazapi_instance_token !== instance.token)
    throw new Error("O token da instancia existente mudou; operacao interrompida.");
  const next: UazapiSetting = {
    ...setting,
    uazapi_instance_id: instance.id,
    uazapi_instance_token: instance.token,
    uazapi_instance_name: DEFAULT_INSTANCE_NAME,
    uazapi_connection_status: instance.status ?? setting.uazapi_connection_status,
  };

  const { error: tokenError } = await db
    .from("uazapi_connection_secrets")
    .update({ instance_token: instance.token })
    .eq("provider", "whatsapp");
  if (tokenError) throw new Error("Nao foi possivel guardar o token da instancia.");
  const { error } = await db
    .from("integration_settings")
    .update({
      uazapi_instance_id: next.uazapi_instance_id,
      uazapi_instance_name: DEFAULT_INSTANCE_NAME,
      uazapi_connection_status: next.uazapi_connection_status,
    })
    .eq("provider", "whatsapp");
  if (error) throw new Error(error.message);
  return next;
}

async function ensureWebhookSecret(setting: UazapiSetting) {
  if (setting.webhook_secret) return setting;
  const { data, error } = await db.from("uazapi_connection_secrets")
    .update({
      webhook_secret: Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    })
    .eq("provider", "whatsapp")
    .is("webhook_secret", null)
    .select("webhook_secret")
    .maybeSingle();
  if (error) throw new Error("Nao foi possivel guardar o segredo do webhook.");
  if (data?.webhook_secret) return { ...setting, webhook_secret: data.webhook_secret };
  const current = await getUazapiSetting(true);
  if (!current.webhook_secret) throw new Error("Segredo do webhook indisponivel.");
  return current;
}

async function configureInstanceWebhook(setting: UazapiSetting) {
  if (!setting.webhook_secret) throw new Error("Segredo do webhook indisponivel.");
  const expectedUrl = webhookUrlWithSecret(setting.webhook_secret);
  await uazapiFetch<unknown>(setting, "/webhook", {
    auth: "instance",
    method: "POST",
    body: {
      enabled: true,
      url: expectedUrl,
      events: UAZAPI_EVENTS,
      excludeMessages: UAZAPI_EXCLUDED_MESSAGES,
      addUrlEvents: false,
      addUrlTypesMessages: false,
    },
  });
  const response = await uazapiFetch<unknown>(setting, "/webhook", { auth: "instance" });
  const first = confirmedInstanceWebhook(response, expectedUrl, UAZAPI_EVENTS);
  if (!first) throw new Error("A Uazapi nao confirmou o webhook da instancia.");
  const { error } = await db
    .from("integration_settings")
    .update({
      uazapi_webhook_id: asString(first?.id),
      uazapi_webhook_configured_at: nowIso(),
    })
    .eq("provider", "whatsapp");
  if (error) throw new Error(error.message);
  return first;
}

export const getUazapiAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    const [setting, { data: events }, { count: errorCount }] = await Promise.all([
      getUazapiSetting(true),
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
      setting: publicSetting(setting),
      events: (events ?? []) as UazapiEventRow[],
      errorCount: errorCount ?? 0,
    };
  });

async function startUazapiConnection() {
  let setting = await getUazapiSetting(true);
  if (!setting.uazapi_admin_token) throw new Error("Credencial administrativa indisponivel no servidor.");
  setting = await ensureUazapiInstance(setting);
  setting = await ensureWebhookSecret(setting);
  const { error: enableError } = await db.from("integration_settings")
    .update({ is_enabled: true, whatsapp_mode: "suggestion" })
    .eq("provider", "whatsapp");
  if (enableError) throw new Error("Nao foi possivel ativar o recebimento do webhook.");
  await configureInstanceWebhook(setting);
  const response = await uazapiFetch<Record<string, unknown>>(setting, "/instance/connect", {
    auth: "instance",
    method: "POST",
    body: {},
  });
  const instance = await saveInstanceSnapshot(response);
  if (instance.status === "error" || instance.status === "hibernated")
    throw new Error("A Uazapi nao iniciou o pareamento. Atualize o estado e tente novamente.");
  const qrcode = instance.qrcode ?? asString(deepFind(response, ["qrcode", "qrCode"]));
  const paircode = instance.paircode ?? asString(deepFind(response, ["paircode", "pairCode"]));
  const status = instance.status === "connected" ? "connected" : "connecting";
  const { error: statusError } = await db.from("integration_settings").update({
    uazapi_connection_status: status,
    uazapi_last_qr_at: nowIso(),
  }).eq("provider", "whatsapp");
  if (statusError) throw new Error("Conexao iniciada, mas o estado nao foi salvo.");
  return {
    ok: true,
    status,
    qrcode,
    paircode,
    message: qrcode ? "QR Code gerado. Aguardando pareamento." : "Conexao iniciada. Atualize o status em instantes.",
  };
}

let connectionInFlight: ReturnType<typeof startUazapiConnection> | null = null;

export const generateUazapiQrCode = createServerFn({ method: "POST" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    if (connectionInFlight) return connectionInFlight;
    const operation = startUazapiConnection();
    connectionInFlight = operation;
    try {
      return await operation;
    } finally {
      if (connectionInFlight === operation) connectionInFlight = null;
    }
  });

export const refreshUazapiStatus = createServerFn({ method: "GET" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    let setting = await getUazapiSetting(true);
    if (!setting.uazapi_instance_token) {
      if (!setting.uazapi_admin_token)
        return { ok: true, status: "disconnected" as const, qrcode: null, paircode: null };
      setting = await ensureUazapiInstance(setting);
    }
    const response = await uazapiFetch<Record<string, unknown>>(setting, "/instance/status", {
      auth: "instance",
    });
    const instance = await saveInstanceSnapshot(response);
    if (!instance.status) throw new Error("A Uazapi nao informou um estado de conexao valido.");
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
    await uazapiFetch<Record<string, unknown>>(setting, "/instance/disconnect", {
      auth: "instance",
      method: "POST",
    });
    const { error } = await db
      .from("integration_settings")
      .update({
        uazapi_connection_status: "disconnected",
        uazapi_profile_name: null,
        uazapi_phone: null,
      })
      .eq("provider", "whatsapp");
    if (error) throw new Error("Instancia desconectada, mas nao foi possivel salvar o estado.");
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
    ok: candidates.some((candidate) => equalSecret(candidate as string, setting.webhook_secret as string)),
    message: "Invalid WhatsApp webhook secret",
  };
}

function parseWebhookPayload(payload: Record<string, unknown>, fallbackEventId: string) {
  const message = firstObjectWithMessageShape(payload);
  const eventType = uazapiEventType(payload, Boolean(message));
  const providerEventId =
    (eventType === "connection" ? asString(payload.event_id) : null) ??
    asString(message?.messageid) ??
    asString(payload.id) ??
    asString(payload.event_id) ??
    fallbackEventId;
  const chatId = asString(message?.chatid) ?? asString(deepFind(payload, ["chatid", "wa_chatid"]));
  const sender = asString(message?.sender) ?? asString(deepFind(payload, ["sender", "from"]));
  const rawDigits = phoneFromChat(sender) ?? phoneFromChat(chatId);
  const phoneE164 = toE164FromRaw(rawDigits);
  return {
    eventType,
    providerEventId,
    message,
    chatId,
    rawDigits,
    phone: phoneE164 ?? rawDigits,
    phoneE164,
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
  const target =
    normalizeE164Phone(phone) ?? normalizeE164Phone(phone, "BR") ?? phone;
  return ((data ?? []) as Array<{ id: string; full_name: string; phone: string | null }>).find(
    (lead) => {
      const leadE164 =
        normalizeE164Phone(lead.phone) ?? normalizeE164Phone(lead.phone, "BR");
      return leadE164 === target;
    },
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
  const storedPhone = parsed.phoneE164 ?? parsed.phone;
  const chatIdFallback = parsed.chatId ?? `wa:${parsed.rawDigits ?? storedPhone.replace(/\D/g, "")}`;
  const inboxInsert = {
    provider: "whatsapp",
    provider_message_id: parsed.providerEventId,
    provider_chat_id: chatIdFallback,
    from_phone: storedPhone,
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
        provider_chat_id: chatIdFallback,
        phone: storedPhone,
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

async function recordManualOutboundMessage(
  parsed: ReturnType<typeof parseWebhookPayload>,
  payload: Record<string, unknown>,
) {
  if (!parsed.phone) return { status: "ignored", reason: "Telefone nao identificado." };
  if (!parsed.fromMe || parsed.wasSentByApi || parsed.isGroup) {
    return { status: "ignored", reason: "Nao e uma mensagem manual de saida." };
  }

  const lead = await findLeadByPhone(parsed.phone);
  if (!lead?.id) return { status: "ignored", reason: "Mensagem manual sem lead associado." };

  const sentAt = nowIso();
  const storedPhone = parsed.phoneE164 ?? parsed.phone;
  const chatIdFallback = parsed.chatId ?? `wa:${parsed.rawDigits ?? storedPhone.replace(/\D/g, "")}`;
  const { data: conversation, error: conversationError } = await db
    .from("crm_conversations")
    .upsert(
      {
        lead_id: lead.id,
        provider: "whatsapp",
        provider_chat_id: chatIdFallback,
        phone: storedPhone,
        last_message_at: sentAt,
        last_outbound_at: sentAt,
      },
      { onConflict: "provider,provider_chat_id" },
    )
    .select("id")
    .single();
  if (conversationError) throw new Error(conversationError.message);

  const { error: messageError } = await db.from("crm_messages").insert({
    lead_id: lead.id,
    conversation_id: conversation.id,
    direction: "outbound",
    provider: "whatsapp",
    provider_message_id: parsed.providerEventId,
    body: parsed.body,
    message_type: parsed.messageType,
    status: "manual_sent",
    created_at: sentAt,
  });
  if (messageError) {
    if (messageError.code === "23505") return { status: "duplicate", reason: "Mensagem duplicada." };
    throw new Error(messageError.message);
  }

  await Promise.all([
    db
      .from("leads")
      .update({ last_outbound_at: sentAt, last_interaction_at: sentAt })
      .eq("id", lead.id),
    db.from("lead_activity_log").insert({
      lead_id: lead.id,
      kind: "message_outbound",
      payload: {
        provider: "whatsapp",
        source: "manual_whatsapp",
        raw_payload: safeJson(payload),
      },
      actor_id: null,
    }),
  ]);

  return { status: "processed", leadId: lead.id };
}

export async function processUazapiWebhook(
  payload: Record<string, unknown>,
  fallbackEventId: string,
): Promise<ProcessResult> {
  const setting = await getUazapiSetting(true);
  if (!belongsToUazapiInstance(payload, {
    token: setting.uazapi_instance_token,
    id: setting.uazapi_instance_id,
    name: DEFAULT_INSTANCE_NAME,
    baseUrl: DEFAULT_UAZAPI_BASE_URL,
  })) {
    return { ok: false, status: "unauthorized", httpStatus: 401, message: "Unrecognized Uazapi instance" };
  }
  const parsed = parseWebhookPayload(payload, fallbackEventId);
  const safePayload = redactUazapiValue(payload) as Record<string, unknown>;
  const { data: eventInsert, error: eventErr } = await db
    .from("integration_events")
    .insert({
      provider: "whatsapp",
      event_type: parsed.eventType,
      provider_event_id: parsed.providerEventId,
      payload: safePayload,
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
    if (parsed.eventType === "connection") {
      const live = await uazapiFetch<Record<string, unknown>>(setting, "/instance/status", {
        auth: "instance",
      });
      const snapshot = await saveInstanceSnapshot(live);
      if (!snapshot.status) throw new Error("A Uazapi nao informou um estado de conexao valido.");
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

    const result =
      parsed.fromMe && !parsed.wasSentByApi && !parsed.isGroup
        ? await recordManualOutboundMessage(parsed, safePayload)
        : await recordInboundMessage(parsed, safePayload);
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
  } catch {
    const message = "Erro ao processar webhook Uazapi";
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
  const e164 =
    normalizeE164Phone(number) ?? normalizeE164Phone(number, "BR");
  const phone = phoneToWhatsAppJid(e164) ?? digitsOnly(number);
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
    raw: redactUazapiValue(response),
  };
}
