/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireModule } from "@/lib/admin/auth";
import { normalizePhone as normalizeE164Phone, phoneToWhatsAppJid } from "@/lib/phone/phone.utils";
import {
  belongsToUazapiInstance,
  confirmedInstanceWebhook,
  equalSecret,
  redactUazapiValue,
  receiptRank,
  uazapiEventType,
  uazapiMessageTime,
} from "@/lib/uazapi/uazapi.webhook";
import { extractUazapiPhone } from "@/lib/uazapi/uazapi.identity";
import {
  allowedMediaMime,
  INBOX_MEDIA_BUCKET,
  MAX_INBOX_MEDIA_BYTES,
  matchesMediaSignature,
  mediaKind,
  safeUazapiMediaUrl,
  type InboxMediaKind,
} from "@/lib/uazapi/uazapi.media";

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
  rpc: (name: string, args: Record<string, unknown>) => any;
};

const DEFAULT_UAZAPI_BASE_URL = "https://senseys.uazapi.com";
const DEFAULT_INSTANCE_NAME = "instituto-empuria";
const PUBLIC_WEBHOOK_URL = "https://institutoempuria.net/api/webhooks/uazapi";
const UAZAPI_EVENTS = ["messages", "messages_update", "connection", "chats"] as const;
const UAZAPI_EXCLUDED_MESSAGES = ["isGroupYes"] as const;

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
  return normalizeE164Phone(`+${digits}`) ?? normalizeE164Phone(digits, "BR") ?? null;
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
  const instance = (
    payload.instance && typeof payload.instance === "object" ? payload.instance : payload
  ) as Record<string, unknown>;
  const statusInfo =
    payload.status && typeof payload.status === "object"
      ? (payload.status as Record<string, unknown>)
      : {};
  const rawStatus = asString(instance.status) ?? asString(payload.status);
  const status = (
    ["disconnected", "connecting", "connected", "hibernated", "error"].includes(rawStatus ?? "")
      ? rawStatus
      : asBool(statusInfo.connected) === true || asBool(payload.connected) === true
        ? "connected"
        : asBool(statusInfo.connected) === false || asBool(payload.connected) === false
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
    phone: extractUazapiPhone(payload),
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
  if (instance.phone || instance.status === "connected") patch.uazapi_phone = instance.phone;
  if (instance.status === "disconnected") {
    patch.uazapi_profile_name = null;
    patch.uazapi_phone = null;
  }
  if (instance.status === "connected") patch.uazapi_last_connection_at = nowIso();
  if (Object.keys(patch).length) {
    const { error } = await db
      .from("integration_settings")
      .update(patch)
      .eq("provider", "whatsapp");
    if (error) throw new Error(error.message);
  }
  return instance;
}

function webhookUrlWithSecret(secret: string) {
  const url = new URL(PUBLIC_WEBHOOK_URL);
  url.searchParams.set("token", secret);
  return url.toString();
}

const mediaExtension: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

async function fetchBoundedProviderFile(url: string): Promise<Uint8Array> {
  let current = url;
  for (let redirects = 0; redirects < 3; redirects += 1) {
    if (!safeUazapiMediaUrl(current)) throw new Error("Origem da midia nao autorizada.");
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirecionamento de midia invalido.");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok || !response.body) throw new Error("Midia indisponivel na Uazapi.");
    const length = Number(response.headers.get("content-length"));
    if (length > MAX_INBOX_MEDIA_BYTES) throw new Error("Midia excede o limite de 16 MB.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_INBOX_MEDIA_BYTES) throw new Error("Midia excede o limite de 16 MB.");
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }
  throw new Error("Muitos redirecionamentos ao recuperar midia.");
}

export async function persistUazapiMedia(
  messageId: string,
  providerMessageId: string,
  kind: InboxMediaKind,
) {
  const { data: existing, error: lookupError } = await db
    .from("crm_messages")
    .select("id,provider_message_id,media_path,media_name")
    .eq("id", messageId)
    .eq("provider", "whatsapp")
    .single();
  if (lookupError || existing?.provider_message_id !== providerMessageId)
    throw new Error("Mensagem de midia nao encontrada.");
  if (existing.media_path) return existing.media_path as string;
  const setting = await getUazapiSetting(true);
  if (!setting.is_enabled || setting.uazapi_connection_status !== "connected")
    throw new Error("Uazapi desconectada; midia nao pode ser recuperada agora.");
  const download = await uazapiFetch<Record<string, unknown>>(setting, "/message/download", {
    auth: "instance",
    method: "POST",
    body: {
      id: providerMessageId,
      return_base64: false,
      transcribe: false,
      generate_mp3: kind === "audio",
    },
  });
  const url = asString(download.fileURL);
  const mime = asString(download.mimetype)?.toLowerCase().split(";")[0].trim();
  if (!url || !mime || !allowedMediaMime(kind, mime))
    throw new Error("Formato da midia nao suportado.");
  const bytes = await fetchBoundedProviderFile(url);
  if (!bytes.length || !matchesMediaSignature(mime, bytes))
    throw new Error("Arquivo de midia invalido.");
  const path = `${messageId}/received.${mediaExtension[mime]}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(INBOX_MEDIA_BUCKET)
    .upload(path, new Blob([new Uint8Array(bytes)], { type: mime }), {
      contentType: mime,
      upsert: false,
    });
  if (uploadError && !/already exists|duplicate/i.test(uploadError.message))
    throw new Error("Nao foi possivel preservar a midia privada.");
  const { error: updateError } = await db
    .from("crm_messages")
    .update({
      media_kind: kind,
      media_mime: mime,
      media_size: bytes.length,
      media_path: path,
    })
    .eq("id", messageId)
    .is("media_path", null);
  if (updateError) throw new Error("Midia preservada, mas metadados nao foram atualizados.");
  return path;
}

async function ensureUazapiInstance(setting: UazapiSetting) {
  const all = await uazapiFetch<unknown>(setting, "/instance/all", { auth: "admin" });
  const instances = Array.isArray(all) ? all : ((all as Record<string, unknown>).instances ?? []);
  if (!Array.isArray(instances)) throw new Error("Lista de instancias Uazapi invalida.");
  const matches = instances.filter(
    (item) =>
      item &&
      typeof item === "object" &&
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
  const { data, error } = await db
    .from("uazapi_connection_secrets")
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
  if (!setting.uazapi_admin_token)
    throw new Error("Credencial administrativa indisponivel no servidor.");
  setting = await ensureUazapiInstance(setting);
  setting = await ensureWebhookSecret(setting);
  const { error: enableError } = await db
    .from("integration_settings")
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
  const { error: statusError } = await db
    .from("integration_settings")
    .update({
      uazapi_connection_status: status,
      uazapi_last_qr_at: nowIso(),
    })
    .eq("provider", "whatsapp");
  if (statusError) throw new Error("Conexao iniciada, mas o estado nao foi salvo.");
  return {
    ok: true,
    status,
    qrcode,
    paircode,
    message: qrcode
      ? "QR Code gerado. Aguardando pareamento."
      : "Conexao iniciada. Atualize o status em instantes.",
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
    ok: candidates.some((candidate) =>
      equalSecret(candidate as string, setting.webhook_secret as string),
    ),
    message: "Invalid WhatsApp webhook secret",
  };
}

function parseWebhookPayload(payload: Record<string, unknown>, fallbackEventId: string) {
  const message = firstObjectWithMessageShape(payload);
  const content =
    message?.content && typeof message.content === "object"
      ? (message.content as Record<string, unknown>)
      : {};
  const eventType = uazapiEventType(payload, Boolean(message));
  const providerEventId =
    (eventType !== "messages" ? (asString(payload.event_id) ?? fallbackEventId) : null) ??
    asString(message?.messageid) ??
    asString(payload.id) ??
    asString(payload.event_id) ??
    fallbackEventId;
  const chatId = asString(message?.chatid) ?? asString(deepFind(payload, ["chatid", "wa_chatid"]));
  const sender = asString(message?.sender) ?? asString(deepFind(payload, ["sender", "from"]));
  const individualChat = chatId && /@(s\.whatsapp\.net|c\.us)$/.test(chatId);
  const rawDigits =
    (individualChat ? phoneFromChat(chatId) : null) ??
    phoneFromChat(asString(message?.sender_pn)) ??
    (!chatId ? phoneFromChat(sender) : null);
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
      asString(content.caption) ??
      asString(deepFind(payload, ["text", "conversation", "caption", "body"])) ??
      null,
    mediaMime: asString(content.mimetype),
    mediaName: asString(content.fileName) ?? asString(content.title),
    mediaSize: Number.isSafeInteger(Number(content.fileLength)) ? Number(content.fileLength) : null,
    providerStatus: asString(message?.status),
    sentAt: uazapiMessageTime(message?.messageTimestamp, nowIso()),
    clientRequestId: (() => {
      const value = asString(message?.track_id) ?? asString(payload.track_id);
      return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
        ? value
        : null;
    })(),
  };
}

export async function ingestUazapiMessage(
  parsed: ReturnType<typeof parseWebhookPayload>,
  persistMedia = false,
) {
  if (!asString(parsed.message?.messageid))
    return { status: "ignored", reason: "Mensagem sem ID de provedor." };
  if (
    !parsed.phone ||
    parsed.isGroup ||
    parsed.chatId?.includes("@g.us") ||
    parsed.chatId?.includes("@broadcast")
  )
    return { status: "ignored", reason: "Conversa individual nao identificada." };
  const storedPhone = parsed.phoneE164 ?? parsed.phone;
  const digits = storedPhone.replace(/\D/g, "");
  if (digits.length < 8) return { status: "ignored", reason: "Telefone nao identificado." };
  const { data, error } = await db.rpc("crm_inbox_ingest", {
    p_chat_id: `wa:${digits}`,
    p_phone: storedPhone,
    p_name: parsed.senderName,
    p_provider_message_id: parsed.providerEventId,
    p_direction: parsed.fromMe ? "outbound" : "inbound",
    p_type: parsed.messageType,
    p_body: parsed.body,
    p_sent_at: parsed.sentAt,
    p_status: parsed.fromMe
      ? (parsed.providerStatus ?? (parsed.wasSentByApi ? "sent" : "manual_sent"))
      : "received",
    p_client_request_id: parsed.clientRequestId,
  });
  if (error) throw new Error(error.message);
  const kind = mediaKind(parsed.messageType);
  if (kind && data?.[0]?.message_id) {
    const messageId = data[0].message_id as string;
    await db
      .from("crm_messages")
      .update({
        media_kind: kind,
        media_mime:
          parsed.mediaMime && allowedMediaMime(kind, parsed.mediaMime) ? parsed.mediaMime : null,
        media_name: parsed.mediaName?.slice(0, 180) ?? null,
        media_size:
          parsed.mediaSize && parsed.mediaSize <= MAX_INBOX_MEDIA_BYTES ? parsed.mediaSize : null,
      })
      .eq("id", messageId)
      .is("media_path", null);
    if (persistMedia && parsed.message?.messageid) {
      try {
        await persistUazapiMedia(messageId, parsed.message.messageid as string, kind);
      } catch {
        /* Metadata remains available for explicit recovery in the Inbox. */
      }
    }
  }
  return { status: data?.[0]?.inserted ? "processed" : "duplicate" };
}

export async function processUazapiWebhook(
  payload: Record<string, unknown>,
  fallbackEventId: string,
): Promise<ProcessResult> {
  const setting = await getUazapiSetting(true);
  if (
    !belongsToUazapiInstance(payload, {
      token: setting.uazapi_instance_token,
      id: setting.uazapi_instance_id,
      name: DEFAULT_INSTANCE_NAME,
      baseUrl: DEFAULT_UAZAPI_BASE_URL,
    })
  ) {
    return {
      ok: false,
      status: "unauthorized",
      httpStatus: 401,
      message: "Unrecognized Uazapi instance",
    };
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

    let result: { status: string; reason?: string };
    if (parsed.eventType === "messages_update") {
      const event = payload.event as Record<string, unknown> | undefined;
      const ids = Array.isArray(event?.MessageIDs)
        ? event.MessageIDs.filter((id): id is string => typeof id === "string")
        : [];
      const status = asString(payload.state) ?? asString(event?.Type);
      if (event?.IsGroup === true || !status || !ids.length) {
        result = { status: "ignored", reason: "Recibo sem mensagem individual." };
      } else {
        const { data: rows, error } = await db
          .from("crm_messages")
          .select("id, status, provider_message_id")
          .eq("provider", "whatsapp")
          .in("provider_message_id", ids);
        if (error) throw new Error(error.message);
        for (const row of rows ?? []) {
          if (receiptRank(status) > receiptRank(row.status)) {
            const { error: updateError } = await db
              .from("crm_messages")
              .update({ status })
              .eq("id", row.id)
              .eq("status", row.status);
            if (updateError) throw new Error(updateError.message);
          }
        }
        result = { status: "processed" };
      }
    } else if (parsed.eventType === "chats") {
      const chat = payload.chat as Record<string, unknown> | undefined;
      const jid = asString(chat?.wa_chatid);
      const digits = phoneFromChat(jid);
      if (chat?.wa_isGroup || !digits || !jid?.endsWith("@s.whatsapp.net")) {
        result = { status: "ignored", reason: "Chat nao individual." };
      } else {
        const { error } = await db
          .from("crm_conversations")
          .update({ contact_name: asString(chat?.name) ?? asString(chat?.wa_name) })
          .eq("provider", "whatsapp")
          .eq("provider_chat_id", `wa:${digits}`);
        if (error) throw new Error(error.message);
        result = { status: "processed" };
      }
    } else if (parsed.eventType === "messages") {
      result = await ingestUazapiMessage(parsed, true);
    } else {
      result = { status: "ignored", reason: "Evento nao suportado." };
    }
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
  const e164 = normalizeE164Phone(number) ?? normalizeE164Phone(number, "BR");
  const phone = phoneToWhatsAppJid(e164) ?? digitsOnly(number);
  if (!phone) throw new Error("Telefone invalido para envio via WhatsApp.");

  const response = await uazapiFetch<Record<string, unknown>>(setting, "/send/text", {
    auth: "instance",
    method: "POST",
    body: {
      number: phone,
      text,
      readchat: false,
      readmessages: false,
      track_source: "empuria_crm",
      track_id: trackId ?? undefined,
      async: false,
    },
  });
  return {
    providerMessageId: asString(deepFind(response, ["messageid", "messageId", "id"])),
    status: asString(deepFind(response, ["status", "response"])) ?? "sent",
    raw: redactUazapiValue(response),
  };
}

export async function sendUazapiMediaInternal({
  number,
  kind,
  fileUrl,
  caption,
  docName,
  trackId,
}: {
  number: string;
  kind: InboxMediaKind;
  fileUrl: string;
  caption: string;
  docName?: string;
  trackId: string;
}) {
  const setting = await getUazapiSetting(true);
  if (
    !setting.is_enabled ||
    setting.whatsapp_mode === "disabled" ||
    setting.uazapi_connection_status !== "connected"
  )
    throw new Error("WhatsApp/Uazapi nao esta conectado.");
  const e164 = normalizeE164Phone(number) ?? normalizeE164Phone(number, "BR");
  const phone = phoneToWhatsAppJid(e164);
  if (!phone) throw new Error("Telefone invalido para envio via WhatsApp.");
  const response = await uazapiFetch<Record<string, unknown>>(setting, "/send/media", {
    auth: "instance",
    method: "POST",
    body: {
      number: phone,
      type: kind === "audio" ? "ptt" : kind,
      file: fileUrl,
      text: kind === "audio" ? undefined : caption || undefined,
      docName: kind === "document" ? docName : undefined,
      readchat: false,
      readmessages: false,
      track_source: "empuria_crm",
      track_id: trackId,
      async: false,
    },
  });
  return {
    providerMessageId: asString(deepFind(response, ["messageid", "messageId", "id"])),
    status: asString(deepFind(response, ["status", "response"])) ?? "sent",
  };
}

export async function getUazapiInboxConnectionInternal() {
  const setting = await getUazapiSetting(true);
  return {
    connected: setting.is_enabled && setting.uazapi_connection_status === "connected",
    status: setting.uazapi_connection_status,
  };
}

export async function syncUazapiInboxPageInternal(offset: number) {
  const setting = await getUazapiSetting(true);
  if (!setting.is_enabled || setting.uazapi_connection_status !== "connected")
    throw new Error("Conecte o WhatsApp antes de sincronizar.");
  const response = await uazapiFetch<unknown>(setting, "/chat/find", {
    auth: "instance",
    method: "POST",
    body: { limit: 10, offset },
  });
  const wrapper =
    response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const chats = Array.isArray(response) ? response : wrapper.chats;
  if (!Array.isArray(chats)) throw new Error("Formato da lista de chats Uazapi nao reconhecido.");
  let imported = 0;
  for (const item of chats) {
    if (!item || typeof item !== "object") continue;
    const chat = item as Record<string, unknown>;
    const jid = asString(chat.wa_chatid);
    const phone = phoneFromChat(jid);
    if (!jid?.endsWith("@s.whatsapp.net") || !phone || chat.wa_isGroup === true) continue;
    const messages = await uazapiFetch<unknown>(setting, "/message/find", {
      auth: "instance",
      method: "POST",
      body: { chatid: jid, limit: 20, offset: 0 },
    });
    const messageWrapper =
      messages && typeof messages === "object" ? (messages as Record<string, unknown>) : {};
    const page = Array.isArray(messages) ? messages : messageWrapper.messages;
    if (!Array.isArray(page)) throw new Error("Formato das mensagens Uazapi nao reconhecido.");
    for (const row of page) {
      if (!row || typeof row !== "object") continue;
      const parsed = parseWebhookPayload(
        { EventType: "messages", message: row },
        crypto.randomUUID(),
      );
      if (!parsed.message || !asString(parsed.message.messageid)) continue;
      const result = await ingestUazapiMessage({
        ...parsed,
        chatId: jid,
        phone: toE164FromRaw(phone) ?? phone,
      });
      if (result.status === "processed") imported += 1;
    }
  }
  const pagination = wrapper.pagination as Record<string, unknown> | undefined;
  return {
    imported,
    nextOffset:
      pagination?.hasMore === true || (!pagination && chats.length === 10)
        ? Number(pagination?.nextOffset ?? offset + 10)
        : null,
  };
}

export async function syncUazapiConversationPageInternal(chatId: string, offset: number) {
  const setting = await getUazapiSetting(true);
  if (!setting.is_enabled || setting.uazapi_connection_status !== "connected")
    throw new Error("Conecte o WhatsApp antes de sincronizar.");
  const phone = chatId.match(/^wa:([0-9]{8,20})$/)?.[1];
  if (!phone) throw new Error("Conversa invalida.");
  const jid = `${phone}@s.whatsapp.net`;
  const response = await uazapiFetch<unknown>(setting, "/message/find", {
    auth: "instance",
    method: "POST",
    body: { chatid: jid, limit: 20, offset },
  });
  const wrapper =
    response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const page = Array.isArray(response) ? response : wrapper.messages;
  if (!Array.isArray(page)) throw new Error("Formato das mensagens Uazapi nao reconhecido.");
  let imported = 0;
  for (const row of page) {
    if (!row || typeof row !== "object") continue;
    const parsed = parseWebhookPayload(
      { EventType: "messages", message: row },
      crypto.randomUUID(),
    );
    if (!parsed.message || !asString(parsed.message.messageid)) continue;
    const result = await ingestUazapiMessage({
      ...parsed,
      chatId: jid,
      phone: toE164FromRaw(phone) ?? phone,
    });
    if (result.status === "processed") imported += 1;
  }
  const pagination = wrapper.pagination as Record<string, unknown> | undefined;
  return {
    imported,
    nextOffset:
      pagination?.hasMore === true || (!pagination && page.length === 20)
        ? Number(pagination?.nextOffset ?? offset + 20)
        : null,
  };
}
