/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getUazapiInboxConnectionInternal,
  sendUazapiTextInternal,
  syncUazapiConversationPageInternal,
  syncUazapiInboxPageInternal,
} from "@/lib/uazapi/uazapi.functions";

const db = supabaseAdmin as any;

export const listCrmConversations = createServerFn({ method: "GET" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z
      .object({
        offset: z.number().int().min(0).max(100000).default(0),
        search: z.string().trim().max(80).default(""),
        unreadOnly: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    let query = db
      .from("crm_conversations")
      .select(
        "id,lead_id,provider_chat_id,phone,contact_name,last_preview,last_message_at,unread_count",
        { count: "exact" },
      )
      .eq("provider", "whatsapp")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(data.offset, data.offset + 19);
    if (data.unreadOnly) query = query.gt("unread_count", 0);
    if (data.search) {
      const search = data.search.replace(/[%_,().]/g, " ").trim();
      if (search) query = query.or(`phone.ilike.%${search}%,contact_name.ilike.%${search}%`);
    }
    const { data: rows, error, count } = await query;
    if (error) throw new Error("Nao foi possivel listar as conversas.");
    return {
      items: rows ?? [],
      nextOffset: data.offset + (rows?.length ?? 0) < (count ?? 0) ? data.offset + 20 : null,
    };
  });

export const listCrmConversationMessages = createServerFn({ method: "GET" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z
      .object({
        conversationId: z.string().uuid(),
        offset: z.number().int().min(0).max(100000).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: rows, error } = await db
      .from("crm_messages")
      .select("id,direction,body,message_type,status,created_at,provider_message_id")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(data.offset, data.offset + 20);
    if (error) throw new Error("Nao foi possivel carregar as mensagens.");
    return {
      items: (rows ?? []).slice(0, 20),
      nextOffset: (rows?.length ?? 0) > 20 ? data.offset + 20 : null,
    };
  });

export const markCrmConversationRead = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await db
      .from("crm_conversations")
      .update({ unread_count: 0, last_read_at: new Date().toISOString() })
      .eq("id", data.conversationId)
      .eq("provider", "whatsapp");
    if (error) throw new Error("Nao foi possivel marcar a conversa como lida.");
    return { ok: true };
  });

export const linkCrmConversationLead = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z.object({ conversationId: z.string().uuid(), leadId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { error } = await db.rpc("crm_inbox_bind_lead", {
      p_conversation_id: data.conversationId,
      p_lead_id: data.leadId,
    });
    if (error) throw new Error("Nao foi possivel vincular a conversa ao lead selecionado.");
    return { ok: true };
  });

export const getCrmInboxConnection = createServerFn({ method: "GET" })
  .middleware([requireModule("crm")])
  .handler(() => getUazapiInboxConnectionInternal());

export const reconcileLegacyCrmInbox = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .handler(async () => {
    const { data: rows, error } = await db
      .from("crm_inbox_messages")
      .select("provider_message_id,from_phone,from_name,message_type,body,created_at")
      .in("status", ["received", "suggested"])
      .eq("provider", "whatsapp")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("Nao foi possivel conciliar o Inbox legado.");
    let imported = 0;
    for (const row of rows ?? []) {
      const digits = String(row.from_phone ?? "").replace(/\D/g, "");
      if (!row.provider_message_id || digits.length < 8) continue;
      const { data, error: ingestError } = await db.rpc("crm_inbox_ingest", {
        p_chat_id: `wa:${digits}`,
        p_phone: row.from_phone,
        p_name: row.from_name,
        p_provider_message_id: row.provider_message_id,
        p_direction: "inbound",
        p_type: row.message_type,
        p_body: row.body,
        p_sent_at: row.created_at,
        p_status: "received",
      });
      if (ingestError) throw new Error("Falha ao conciliar uma mensagem legada.");
      if (data?.[0]?.inserted) imported += 1;
    }
    return { imported };
  });

export const syncCrmInboxChats = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) => z.object({ offset: z.number().int().min(0).max(10000) }).parse(d))
  .handler(({ data }) => syncUazapiInboxPageInternal(data.offset));

export const syncCrmInboxHistory = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z
      .object({ conversationId: z.string().uuid(), offset: z.number().int().min(0).max(10000) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: conversation, error } = await db
      .from("crm_conversations")
      .select("provider_chat_id")
      .eq("id", data.conversationId)
      .eq("provider", "whatsapp")
      .single();
    if (error || !conversation?.provider_chat_id) throw new Error("Conversa nao encontrada.");
    return syncUazapiConversationPageInternal(conversation.provider_chat_id, data.offset);
  });

export const sendCrmInboxText = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z
      .object({
        conversationId: z.string().uuid(),
        text: z.string().trim().min(1).max(4000),
        requestId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: conversation, error } = await db
      .from("crm_conversations")
      .select("id,phone,provider_chat_id")
      .eq("id", data.conversationId)
      .eq("provider", "whatsapp")
      .single();
    if (error || !conversation) throw new Error("Conversa nao encontrada.");
    const { connected } = await getUazapiInboxConnectionInternal();
    if (!connected) throw new Error("Conecte o WhatsApp antes de responder.");
    const { data: existing } = await db
      .from("crm_messages")
      .select("id,status")
      .eq("client_request_id", data.requestId)
      .maybeSingle();
    if (existing)
      return {
        ok: !["uncertain", "sending", "failed"].includes(existing.status),
        status: existing.status,
        messageId: existing.id,
      };
    const { data: ingested, error: ingestError } = await db.rpc("crm_inbox_ingest", {
      p_chat_id: conversation.provider_chat_id,
      p_phone: conversation.phone,
      p_name: null,
      p_provider_message_id: null,
      p_direction: "outbound",
      p_type: "text",
      p_body: data.text,
      p_sent_at: new Date().toISOString(),
      p_status: "sending",
      p_client_request_id: data.requestId,
    });
    if (ingestError || !ingested?.[0]?.message_id)
      throw new Error("Nao foi possivel reservar o envio.");
    const messageId = ingested[0].message_id as string;
    await db.from("crm_messages").update({ sent_by: context.userId }).eq("id", messageId);
    if (!ingested[0].inserted) return { ok: false, status: "uncertain", messageId };
    try {
      const sent = await sendUazapiTextInternal({
        number: conversation.phone,
        text: data.text,
        trackId: data.requestId,
      });
      if (
        !sent.providerMessageId ||
        ["failed", "error", "canceled"].includes(sent.status.toLowerCase())
      )
        throw new Error("API nao confirmou o envio da mensagem");
      const { error: updateError } = await db
        .from("crm_messages")
        .update({ provider_message_id: sent.providerMessageId, status: sent.status })
        .eq("id", messageId);
      if (updateError)
        throw new Error("Envio confirmado, mas o estado local precisa de conferencia.");
      return { ok: true, status: sent.status, messageId };
    } catch {
      await db.from("crm_messages").update({ status: "uncertain" }).eq("id", messageId);
      return { ok: false, status: "uncertain", messageId };
    }
  });
