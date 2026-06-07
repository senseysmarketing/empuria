/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { normalizePhone as normalizeE164Phone, phoneToWhatsAppJid } from "@/lib/phone/phone.utils";
import { sendUazapiTextInternal } from "@/lib/uazapi/uazapi.functions";

type CrmWhatsappSendInput = {
  leadId: string;
  message: string;
  actorId?: string | null;
  trackId?: string | null;
  source?: string;
  executionId?: string | null;
  flowId?: string | null;
  stepId?: string | null;
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

export async function sendCrmWhatsappMessageInternal(input: CrmWhatsappSendInput) {
  const db = supabaseAdmin as any;
  const { data: lead, error: leadError } = await db
    .from("leads")
    .select("id, full_name, phone, pipeline_stage")
    .eq("id", input.leadId)
    .single();
  if (leadError) throw new Error(leadError.message);

  const leadRow = lead as LeadForWhatsapp;
  if (isFinalStage(leadRow.pipeline_stage)) {
    throw new Error("Lead em etapa final nao pode receber automacao.");
  }

  const e164 = normalizeE164Phone(leadRow.phone) ?? normalizeE164Phone(leadRow.phone, "BR");
  const phoneDigits = phoneToWhatsAppJid(e164) ?? leadRow.phone.replace(/\D/g, "");
  if (phoneDigits.length < 8) throw new Error("Lead sem telefone valido para WhatsApp.");

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

  const sent = await sendUazapiTextInternal({
    number: phoneDigits,
    text: input.message,
    trackId: input.trackId ?? `automation:${input.flowId ?? "flow"}:${input.leadId}`,
  });

  const { data: message, error: messageError } = await db
    .from("crm_messages")
    .insert({
      lead_id: leadRow.id,
      conversation_id: conversation.id,
      direction: "outbound",
      provider: "whatsapp",
      provider_message_id: sent.providerMessageId,
      body: input.message,
      message_type: "text",
      status: sent.status,
      sent_by: input.actorId ?? null,
      created_at: sentAt,
    })
    .select("id")
    .single();
  if (messageError) throw new Error(messageError.message);

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
        message_id: message.id,
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
    messageId: message.id as string,
    providerMessageId: sent.providerMessageId,
    status: sent.status,
    sentAt,
  };
}
