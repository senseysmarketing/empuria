/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { normalizePhone as normalizeE164Phone, phoneToWhatsAppJid } from "@/lib/phone/phone.utils";
import {
  getUazapiInboxConnectionInternal,
  sendUazapiMediaInternal,
  sendUazapiTextInternal,
} from "@/lib/uazapi/uazapi.functions";
import {
  allowedMediaMime,
  INBOX_MEDIA_BUCKET,
  matchesMediaSignature,
  MAX_INBOX_MEDIA_BYTES,
  type InboxMediaKind,
} from "@/lib/uazapi/uazapi.media";
import { defaultStopRules } from "./crm-automation.rules";

type CrmWhatsappSendInput = {
  leadId: string;
  message: string;
  actorId?: string | null;
  trackId?: string | null;
  source?: string;
  executionId?: string | null;
  flowId?: string | null;
  stepId?: string | null;
  media?: { kind: InboxMediaKind; path: string; mime: string; name: string; size: number } | null;
};

type LeadForWhatsapp = {
  id: string;
  full_name: string;
  phone: string;
  pipeline_stage: string | null;
};

function isFinalStage(stage: string | null | undefined) {
  return stage === "fechado" || stage === "descartado";
}

async function stableRequestId(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function sendCrmWhatsappMessageInternal(input: CrmWhatsappSendInput) {
  const db = supabaseAdmin as any;
  const { data: lead, error: leadError } = await db
    .from("leads")
    .select("id, full_name, phone, pipeline_stage")
    .eq("id", input.leadId)
    .single();
  if (leadError) throw new Error(leadError.message);

  const leadRow = lead as LeadForWhatsapp;
  const { data: flow, error: flowError } = await db
    .from("crm_automation_flows")
    .select("stop_rules")
    .eq("id", input.flowId)
    .single();
  if (flowError) throw new Error("Fluxo de automacao indisponivel.");
  const rules = defaultStopRules(flow.stop_rules);
  if (rules.stop_on_final_stage && isFinalStage(leadRow.pipeline_stage)) {
    throw new Error("Lead em etapa final nao pode receber automacao.");
  }

  const e164 = normalizeE164Phone(leadRow.phone) ?? normalizeE164Phone(leadRow.phone, "BR");
  const phoneDigits = phoneToWhatsAppJid(e164) ?? leadRow.phone.replace(/\D/g, "");
  if (phoneDigits.length < 8) throw new Error("Lead sem telefone valido para WhatsApp.");
  const connection = await getUazapiInboxConnectionInternal();
  if (!connection.connected) throw new Error("Uazapi desconectada; envio automatico nao iniciado.");

  const sentAt = new Date().toISOString();
  const { data: conversation, error: conversationError } = await db
    .from("crm_conversations")
    .upsert(
      {
        lead_id: leadRow.id,
        provider: "whatsapp",
        provider_chat_id: `wa:${phoneDigits}`,
        phone: e164 ?? leadRow.phone,
        last_message_at: sentAt,
        last_outbound_at: sentAt,
      },
      { onConflict: "provider,provider_chat_id" },
    )
    .select("id")
    .single();
  if (conversationError) throw new Error(conversationError.message);
  const requestId = await stableRequestId(
    input.trackId ?? `automation:${input.executionId}:${input.stepId}`,
  );
  const { data: existing, error: existingError } = await db
    .from("crm_messages")
    .select("id,status,provider_message_id,created_at")
    .eq("client_request_id", requestId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    if (["sending", "uncertain", "failed"].includes(existing.status))
      throw new Error(
        "Envio anterior sem confirmacao; conferir na Uazapi antes de qualquer reenvio.",
      );
    return {
      conversationId: conversation.id as string,
      messageId: existing.id as string,
      providerMessageId: existing.provider_message_id as string,
      status: existing.status as string,
      sentAt: existing.created_at as string,
    };
  }
  const { data: reserved, error: reserveError } = await db.rpc("crm_inbox_ingest", {
    p_chat_id: conversation.provider_chat_id,
    p_phone: e164 ?? leadRow.phone,
    p_name: null,
    p_provider_message_id: null,
    p_direction: "outbound",
    p_type: input.media ? (input.media.kind === "audio" ? "ptt" : input.media.kind) : "text",
    p_body: input.message,
    p_sent_at: sentAt,
    p_status: "sending",
    p_client_request_id: requestId,
  });
  if (reserveError || !reserved?.[0]?.message_id)
    throw new Error("Nao foi possivel reservar o envio automatico.");
  const messageId = reserved[0].message_id as string;
  if (!reserved[0].inserted)
    throw new Error("Envio automatico ja reservado; conferir antes de repetir.");
  const { error: linkError } = await db
    .from("crm_messages")
    .update({
      lead_id: leadRow.id,
      media_kind: input.media?.kind ?? null,
      media_mime: input.media?.mime ?? null,
      media_name: input.media?.name ?? null,
      media_size: input.media?.size ?? null,
      media_path: input.media?.path ?? null,
    })
    .eq("id", messageId);
  if (linkError) throw new Error("Nao foi possivel vincular o envio ao lead.");
  if (input.executionId) {
    const { data: execution } = await db
      .from("crm_automation_executions")
      .select("status,started_at")
      .eq("id", input.executionId)
      .maybeSingle();
    const [{ data: reply }, { data: latestLead }] = await Promise.all([
      rules.stop_on_reply && execution
        ? db
            .from("crm_messages")
            .select("id")
            .eq("lead_id", leadRow.id)
            .eq("direction", "inbound")
            .gt("created_at", execution.started_at)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("leads").select("pipeline_stage").eq("id", leadRow.id).single(),
    ]);
    if (reply && rules.stop_on_reply) {
      const { error: stopError } = await db.rpc("crm_automation_stop_for_lead", {
        p_lead_id: leadRow.id,
        p_reason: "lead_replied",
        p_step_id: null,
      });
      if (stopError) throw new Error(stopError.message);
    }
    if (
      !execution ||
      !["running", "waiting"].includes(execution.status) ||
      reply ||
      (rules.stop_on_final_stage && isFinalStage(latestLead?.pipeline_stage))
    ) {
      await db.from("crm_messages").update({ status: "canceled" }).eq("id", messageId);
      throw new Error("Execucao interrompida antes do envio.");
    }
  }
  let sent;
  try {
    if (input.media) {
      if (
        !input.media.path.startsWith("automations/") ||
        !allowedMediaMime(input.media.kind, input.media.mime) ||
        input.media.size > MAX_INBOX_MEDIA_BYTES
      )
        throw new Error("Midia da automacao invalida.");
      const { data: file, error: downloadError } = await supabaseAdmin.storage
        .from(INBOX_MEDIA_BUCKET)
        .download(input.media.path);
      if (downloadError || !file || file.size !== input.media.size)
        throw new Error("Midia da automacao indisponivel.");
      if (!matchesMediaSignature(input.media.mime, new Uint8Array(await file.arrayBuffer())))
        throw new Error("Conteudo da midia nao corresponde ao tipo informado.");
      const { data: signed, error: signedError } = await supabaseAdmin.storage
        .from(INBOX_MEDIA_BUCKET)
        .createSignedUrl(input.media.path, 120);
      if (signedError || !signed?.signedUrl)
        throw new Error("Midia privada indisponivel para envio.");
      sent = await sendUazapiMediaInternal({
        number: phoneDigits,
        kind: input.media.kind,
        fileUrl: signed.signedUrl,
        caption: input.message,
        docName: input.media.kind === "document" ? input.media.name : undefined,
        trackId: requestId,
      });
    } else {
      sent = await sendUazapiTextInternal({
        number: phoneDigits,
        text: input.message,
        trackId: requestId,
      });
    }
    if (
      !sent.providerMessageId ||
      ["failed", "error", "canceled"].includes(sent.status.toLowerCase())
    )
      throw new Error("Uazapi nao confirmou o envio.");
    const { error: updateError } = await db
      .from("crm_messages")
      .update({
        provider_message_id: sent.providerMessageId,
        status: sent.status,
        sent_by: input.actorId ?? null,
        lead_id: leadRow.id,
      })
      .eq("id", messageId);
    if (updateError) throw new Error("Envio confirmado, mas registro local nao confirmado.");
  } catch (error) {
    await db.from("crm_messages").update({ status: "uncertain" }).eq("id", messageId);
    throw error;
  }

  await Promise.all([
    db
      .from("crm_conversations")
      .update({ last_message_at: sentAt, last_outbound_at: sentAt })
      .eq("id", conversation.id),
    db
      .from("leads")
      .update({ last_outbound_at: sentAt, last_interaction_at: sentAt })
      .eq("id", leadRow.id),
    db.from("lead_activity_log").insert({
      lead_id: leadRow.id,
      kind: "message_outbound",
      payload: {
        message_id: messageId,
        provider: "whatsapp",
        source: input.source ?? "crm_automation",
        execution_id: input.executionId,
        flow_id: input.flowId,
        step_id: input.stepId,
      } as Json,
      actor_id: input.actorId ?? null,
    }),
  ]);

  return {
    conversationId: conversation.id as string,
    messageId,
    providerMessageId: sent.providerMessageId,
    status: sent.status,
    sentAt,
  };
}
