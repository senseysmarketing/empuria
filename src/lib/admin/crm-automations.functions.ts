/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { requireModule } from "./auth";
import { userHasAction } from "./permission-checks";
import { sendCrmWhatsappMessageInternal } from "./crm-whatsapp.functions";

const db = supabaseAdmin as any;

type AutomationFlow = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  trigger_type: "lead_created" | "pipeline_stage_entered" | "inbound_message" | "manual";
  trigger_config: Record<string, any>;
  stop_rules: Record<string, any>;
  schedule_window: Record<string, any>;
  metrics: Record<string, any>;
  created_by: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

type AutomationStep = {
  id: string;
  flow_id: string;
  position: number;
  step_type: "send_whatsapp" | "delay" | "condition" | "action" | "end";
  title: string;
  config: Record<string, any>;
  next_step_id: string | null;
  is_deleted: boolean;
};

type AutomationExecution = {
  id: string;
  flow_id: string;
  lead_id: string;
  status: "running" | "waiting" | "completed" | "stopped" | "failed";
  current_step_id: string | null;
  started_at: string;
  last_activity_at: string;
  last_error: string | null;
};

type PendingAction = {
  id: string;
  execution_id: string;
  flow_id: string;
  lead_id: string;
  step_id: string;
  status: "pending" | "locked" | "done" | "canceled" | "failed";
  run_at: string;
  attempts: number;
  idempotency_key: string;
};

type LeadRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string;
  pipeline_stage: string | null;
  crm_column_id: string | null;
  assigned_to: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  created_at: string;
};

const stepInputSchema = z.object({
  id: z.string().uuid().optional(),
  position: z.number().int().min(1).max(100),
  step_type: z.enum(["send_whatsapp", "delay", "condition", "action", "end"]),
  title: z.string().trim().min(2).max(120),
  config: z.record(z.any()).default({}),
});

const flowInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  status: z.enum(["active", "paused", "archived"]).default("paused"),
  trigger_type: z.enum(["lead_created", "pipeline_stage_entered", "inbound_message", "manual"]),
  trigger_config: z.record(z.any()).default({}),
  stop_rules: z.record(z.any()).default({}),
  schedule_window: z.record(z.any()).default({}),
  steps: z.array(stepInputSchema).min(1).max(30),
});

function defaultStopRules(value?: Record<string, any>) {
  return {
    stop_on_reply: true,
    stop_on_final_stage: true,
    avoid_conflicts: true,
    max_messages_per_lead: 4,
    min_minutes_between_messages: 15,
    block_if_whatsapp_disconnected: true,
    ...(value ?? {}),
  };
}

function defaultScheduleWindow(value?: Record<string, any>) {
  return {
    timezone: "Europe/Madrid",
    weekdays: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "18:00",
    ...(value ?? {}),
  };
}

function isFinalStage(stage: string | null | undefined) {
  return stage === "fechado" || stage === "descartado";
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function delayMinutes(config: Record<string, any>) {
  const amount = Number(config.amount ?? 1);
  const unit = String(config.unit ?? "hours");
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 1;
  if (unit === "minutes") return safeAmount;
  if (unit === "days") return safeAmount * 24 * 60;
  return safeAmount * 60;
}

function timeToMinutes(value: unknown, fallback: string) {
  const text = typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
  const [hour, minute] = text.split(":").map(Number);
  return hour * 60 + minute;
}

function localDateParts(date: Date, timezone: string) {
  const weekdayText = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  const timeText = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const [hour, minute] = timeText.split(":").map(Number);
  return { weekday: weekdayMap[weekdayText] ?? 1, minutes: hour * 60 + minute };
}

function isWithinWindow(date: Date, window: Record<string, any>) {
  const timezone = String(window.timezone ?? "Europe/Madrid");
  const weekdays = Array.isArray(window.weekdays) ? window.weekdays.map(Number) : [1, 2, 3, 4, 5];
  const start = timeToMinutes(window.start, "09:00");
  const end = timeToMinutes(window.end, "18:00");
  const local = localDateParts(date, timezone);
  return weekdays.includes(local.weekday) && local.minutes >= start && local.minutes <= end;
}

function nextAllowedRunAt(now: Date, window: Record<string, any>) {
  let cursor = addMinutes(now, 15);
  for (let i = 0; i < 14 * 24 * 4; i++) {
    if (isWithinWindow(cursor, window)) return cursor;
    cursor = addMinutes(cursor, 15);
  }
  return addMinutes(now, 24 * 60);
}

function firstName(name: string | null | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] || "tudo bem";
}

function renderTemplate(template: string, lead: LeadRow) {
  return template
    .replaceAll("{{nome}}", lead.full_name ?? "")
    .replaceAll("{{primeiro_nome}}", firstName(lead.full_name))
    .replaceAll("{{email}}", lead.email ?? "")
    .replaceAll("{{telefone}}", lead.phone ?? "");
}

function messageForStep(step: AutomationStep, lead: LeadRow) {
  const template =
    typeof step.config.message === "string" && step.config.message.trim()
      ? step.config.message.trim()
      : "Oi, {{primeiro_nome}}, tudo bem? Passando para dar continuidade ao seu atendimento no Instituto Empuria.";
  return renderTemplate(template, lead);
}

async function canManageAutomations(userId: string, isAdmin?: boolean) {
  return Boolean(isAdmin) || (await userHasAction(userId, "crm.automations.manage"));
}

async function canPauseAutomations(userId: string, isAdmin?: boolean) {
  return (
    Boolean(isAdmin) ||
    (await userHasAction(userId, "crm.automations.pause")) ||
    (await userHasAction(userId, "crm.automations.manage"))
  );
}

async function canCancelPending(userId: string, isAdmin?: boolean) {
  return (
    Boolean(isAdmin) ||
    (await userHasAction(userId, "crm.automations.cancel_pending_action")) ||
    (await userHasAction(userId, "crm.automations.manage"))
  );
}

async function assertManage(userId: string, isAdmin?: boolean) {
  if (!(await canManageAutomations(userId, isAdmin))) {
    throw new Error("Sem permissao para gerenciar automacoes do CRM.");
  }
}

async function logAutomation(event: {
  executionId?: string | null;
  flowId?: string | null;
  leadId?: string | null;
  stepId?: string | null;
  eventType: string;
  message?: string | null;
  metadata?: Record<string, any>;
}) {
  await db.from("crm_automation_execution_logs").insert({
    execution_id: event.executionId ?? null,
    flow_id: event.flowId ?? null,
    lead_id: event.leadId ?? null,
    step_id: event.stepId ?? null,
    event_type: event.eventType,
    message: event.message ?? null,
    metadata: (event.metadata ?? {}) as Json,
  });
}

async function incrementMetric(flowId: string, key: string, amount = 1) {
  await db.rpc("crm_automation_increment_metric", { p_flow_id: flowId, p_key: key, p_amount: amount });
}

async function getFlowSteps(flowId: string) {
  const { data, error } = await db
    .from("crm_automation_steps")
    .select("*")
    .eq("flow_id", flowId)
    .eq("is_deleted", false)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AutomationStep[];
}

function nextStep(steps: AutomationStep[], current: AutomationStep) {
  if (current.next_step_id) {
    return steps.find((step) => step.id === current.next_step_id) ?? null;
  }
  return steps.find((step) => step.position > current.position) ?? null;
}

async function scheduleStep({
  executionId,
  flowId,
  leadId,
  step,
  runAt,
  reason,
}: {
  executionId: string;
  flowId: string;
  leadId: string;
  step: AutomationStep;
  runAt: Date;
  reason?: string;
}) {
  const idempotencyKey = `${executionId}:${step.id}:${runAt.getTime()}`;
  const { error } = await db.from("crm_automation_pending_actions").upsert(
    {
      execution_id: executionId,
      flow_id: flowId,
      lead_id: leadId,
      step_id: step.id,
      action_type: "process_step",
      payload: { reason: reason ?? "scheduled" },
      status: "pending",
      run_at: runAt.toISOString(),
      locked_at: null,
      idempotency_key: idempotencyKey,
    },
    { onConflict: "idempotency_key" },
  );
  if (error) throw new Error(error.message);
}

async function stopExecution(execution: AutomationExecution, reason: string, stepId?: string | null) {
  const stoppedAt = new Date().toISOString();
  await Promise.all([
    db
      .from("crm_automation_executions")
      .update({
        status: "stopped",
        stop_reason: reason,
        completed_at: stoppedAt,
        last_activity_at: stoppedAt,
        current_step_id: stepId ?? execution.current_step_id,
      })
      .eq("id", execution.id),
    db
      .from("crm_automation_pending_actions")
      .update({ status: "canceled", last_error: reason, locked_at: null })
      .eq("execution_id", execution.id)
      .in("status", ["pending", "locked"]),
    logAutomation({
      executionId: execution.id,
      flowId: execution.flow_id,
      leadId: execution.lead_id,
      stepId,
      eventType: reason === "lead_replied" ? "lead_replied" : "automation_stopped",
      message:
        reason === "lead_replied"
          ? "Lead respondeu; automacao interrompida."
          : "Automacao interrompida.",
      metadata: { reason },
    }),
  ]);
}

async function hasInboundAfter(leadId: string, startedAt: string) {
  const { data, error } = await db
    .from("crm_messages")
    .select("id")
    .eq("lead_id", leadId)
    .eq("direction", "inbound")
    .gt("created_at", startedAt)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function shouldStopBeforeStep(
  execution: AutomationExecution,
  flow: AutomationFlow,
  lead: LeadRow,
) {
  const stopRules = defaultStopRules(flow.stop_rules);
  if (stopRules.stop_on_final_stage && isFinalStage(lead.pipeline_stage)) return "final_stage";
  if (stopRules.stop_on_reply && (await hasInboundAfter(lead.id, execution.started_at))) {
    return "lead_replied";
  }
  return null;
}

async function messagesSentInExecution(executionId: string) {
  const { count, error } = await db
    .from("crm_automation_execution_logs")
    .select("id", { count: "exact", head: true })
    .eq("execution_id", executionId)
    .eq("event_type", "message_sent");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function completeExecution(execution: AutomationExecution, stepId?: string | null) {
  const now = new Date().toISOString();
  await Promise.all([
    db
      .from("crm_automation_executions")
      .update({
        status: "completed",
        completed_at: now,
        last_activity_at: now,
        current_step_id: stepId ?? execution.current_step_id,
      })
      .eq("id", execution.id),
    logAutomation({
      executionId: execution.id,
      flowId: execution.flow_id,
      leadId: execution.lead_id,
      stepId,
      eventType: "automation_completed",
      message: "Automacao concluida.",
    }),
  ]);
}

async function processStep(action: PendingAction) {
  const [{ data: execution, error: executionError }, { data: flow, error: flowError }, { data: lead, error: leadError }] =
    await Promise.all([
      db.from("crm_automation_executions").select("*").eq("id", action.execution_id).single(),
      db.from("crm_automation_flows").select("*").eq("id", action.flow_id).single(),
      db.from("leads").select("*").eq("id", action.lead_id).single(),
    ]);
  if (executionError) throw new Error(executionError.message);
  if (flowError) throw new Error(flowError.message);
  if (leadError) throw new Error(leadError.message);

  const executionRow = execution as AutomationExecution;
  const flowRow = flow as AutomationFlow;
  const leadRow = lead as LeadRow;
  const steps = await getFlowSteps(flowRow.id);
  const step = steps.find((item) => item.id === action.step_id);
  if (!step) throw new Error("Etapa da automacao nao encontrada.");

  if (flowRow.status !== "active" || flowRow.is_deleted) {
    await stopExecution(executionRow, "flow_not_active", step.id);
    return;
  }
  if (!["running", "waiting"].includes(executionRow.status)) return;

  const stopReason = await shouldStopBeforeStep(executionRow, flowRow, leadRow);
  if (stopReason) {
    await stopExecution(executionRow, stopReason, step.id);
    return;
  }

  const now = new Date();
  if (step.step_type === "send_whatsapp" && !isWithinWindow(now, defaultScheduleWindow(flowRow.schedule_window))) {
    const nextRun = nextAllowedRunAt(now, defaultScheduleWindow(flowRow.schedule_window));
    await db
      .from("crm_automation_pending_actions")
      .update({ status: "pending", run_at: nextRun.toISOString(), locked_at: null })
      .eq("id", action.id);
    await logAutomation({
      executionId: executionRow.id,
      flowId: flowRow.id,
      leadId: leadRow.id,
      stepId: step.id,
      eventType: "schedule_window_rescheduled",
      message: "Envio reagendado para respeitar a janela de atendimento.",
      metadata: { next_run_at: nextRun.toISOString() },
    });
    return;
  }

  const rules = defaultStopRules(flowRow.stop_rules);
  if (step.step_type === "send_whatsapp") {
    if (
      leadRow.last_outbound_at &&
      Date.now() - new Date(leadRow.last_outbound_at).getTime() <
        Number(rules.min_minutes_between_messages ?? 15) * 60 * 1000
    ) {
      const retryAt = addMinutes(now, Number(rules.min_minutes_between_messages ?? 15));
      await db
        .from("crm_automation_pending_actions")
        .update({ status: "pending", run_at: retryAt.toISOString(), locked_at: null })
        .eq("id", action.id);
      await logAutomation({
        executionId: executionRow.id,
        flowId: flowRow.id,
        leadId: leadRow.id,
        stepId: step.id,
        eventType: "anti_spam_rescheduled",
        message: "Envio reagendado por intervalo minimo entre mensagens.",
        metadata: { next_run_at: retryAt.toISOString() },
      });
      return;
    }

    if ((await messagesSentInExecution(executionRow.id)) >= Number(rules.max_messages_per_lead ?? 4)) {
      await stopExecution(executionRow, "max_messages_reached", step.id);
      return;
    }

    const body = messageForStep(step, leadRow);
    const sent = await sendCrmWhatsappMessageInternal({
      leadId: leadRow.id,
      message: body,
      source: "crm_automation",
      executionId: executionRow.id,
      flowId: flowRow.id,
      stepId: step.id,
      trackId: `automation:${executionRow.id}:${step.id}`,
    });
    await Promise.all([
      db
        .from("crm_automation_executions")
        .update({
          current_step_id: step.id,
          conversation_id: sent.conversationId,
          status: "waiting",
          last_activity_at: sent.sentAt,
        })
        .eq("id", executionRow.id),
      logAutomation({
        executionId: executionRow.id,
        flowId: flowRow.id,
        leadId: leadRow.id,
        stepId: step.id,
        eventType: "message_sent",
        message: "Mensagem automatica enviada via WhatsApp.",
        metadata: { message_id: sent.messageId, provider_message_id: sent.providerMessageId },
      }),
      incrementMetric(flowRow.id, "sent", 1),
    ]);
  }

  if (step.step_type === "delay") {
    await logAutomation({
      executionId: executionRow.id,
      flowId: flowRow.id,
      leadId: leadRow.id,
      stepId: step.id,
      eventType: "delay_created",
      message: "Aguardando proxima etapa.",
      metadata: { minutes: delayMinutes(step.config) },
    });
  }

  if (step.step_type === "condition") {
    const inbound = await hasInboundAfter(leadRow.id, executionRow.started_at);
    if (inbound) {
      await stopExecution(executionRow, "lead_replied", step.id);
      return;
    }
    await logAutomation({
      executionId: executionRow.id,
      flowId: flowRow.id,
      leadId: leadRow.id,
      stepId: step.id,
      eventType: "condition_checked",
      message: "Condicao avaliada; lead ainda sem resposta.",
      metadata: { condition: step.config.condition ?? "no_reply" },
    });
  }

  if (step.step_type === "action") {
    if (step.config.action === "move_stage" && typeof step.config.stage === "string") {
      await db
        .from("leads")
        .update({ pipeline_stage: step.config.stage, last_interaction_at: new Date().toISOString() })
        .eq("id", leadRow.id);
    }
    await logAutomation({
      executionId: executionRow.id,
      flowId: flowRow.id,
      leadId: leadRow.id,
      stepId: step.id,
      eventType: "action_executed",
      message: "Acao da automacao executada.",
      metadata: step.config,
    });
  }

  const next = nextStep(steps, step);
  await db
    .from("crm_automation_pending_actions")
    .update({ status: "done", locked_at: null })
    .eq("id", action.id);

  if (!next || step.step_type === "end") {
    await completeExecution(executionRow, step.id);
    return;
  }

  const runAt = step.step_type === "delay" ? addMinutes(now, delayMinutes(step.config)) : now;
  await scheduleStep({
    executionId: executionRow.id,
    flowId: flowRow.id,
    leadId: leadRow.id,
    step: next,
    runAt,
    reason: `after:${step.id}`,
  });
}

async function processPendingAction(action: PendingAction) {
  const { data: locked, error: lockError } = await db
    .from("crm_automation_pending_actions")
    .update({ status: "locked", locked_at: new Date().toISOString(), attempts: action.attempts + 1 })
    .eq("id", action.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (lockError) throw new Error(lockError.message);
  if (!locked) return { status: "skipped" };

  try {
    await processStep(locked as PendingAction);
    return { status: "processed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao processar automacao.";
    const attempts = Number(locked.attempts ?? 1);
    const backoff = attempts === 1 ? 1 : attempts === 2 ? 5 : attempts === 3 ? 15 : null;
    if (backoff) {
      await db
        .from("crm_automation_pending_actions")
        .update({
          status: "pending",
          locked_at: null,
          run_at: addMinutes(new Date(), backoff).toISOString(),
          last_error: message,
        })
        .eq("id", action.id);
    } else {
      await Promise.all([
        db
          .from("crm_automation_pending_actions")
          .update({ status: "failed", locked_at: null, last_error: message })
          .eq("id", action.id),
        db
          .from("crm_automation_executions")
          .update({ status: "failed", last_error: message, last_activity_at: new Date().toISOString() })
          .eq("id", action.execution_id),
        logAutomation({
          executionId: action.execution_id,
          flowId: action.flow_id,
          leadId: action.lead_id,
          stepId: action.step_id,
          eventType: "send_error",
          message,
          metadata: { attempts },
        }),
        incrementMetric(action.flow_id, "errors", 1),
      ]);
    }
    return { status: "error", error: message };
  }
}

export async function processCrmAutomationPendingActionsInternal(limit = 30) {
  const { data, error } = await db
    .from("crm_automation_pending_actions")
    .select("*")
    .eq("status", "pending")
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const results = [];
  for (const action of (data ?? []) as PendingAction[]) {
    results.push(await processPendingAction(action));
  }
  return {
    ok: true,
    checked: (data ?? []).length,
    processed: results.filter((item) => item.status === "processed").length,
    errors: results.filter((item) => item.status === "error").length,
  };
}

function flowMatchesLead(flow: AutomationFlow, triggerType: string, lead: LeadRow, payload?: Record<string, any>) {
  if (flow.status !== "active" || flow.is_deleted || flow.trigger_type !== triggerType) return false;
  if (triggerType === "pipeline_stage_entered") {
    const stage = flow.trigger_config?.stage;
    if (stage && stage !== lead.pipeline_stage && stage !== payload?.stage) return false;
  }
  return true;
}

export async function startMatchingCrmAutomationsForLead(input: {
  leadId: string;
  triggerType: "lead_created" | "pipeline_stage_entered" | "inbound_message" | "manual";
  triggerPayload?: Record<string, any>;
  actorId?: string | null;
}) {
  const [{ data: lead, error: leadError }, { data: flows, error: flowsError }] = await Promise.all([
    db.from("leads").select("*").eq("id", input.leadId).single(),
    db
      .from("crm_automation_flows")
      .select("*")
      .eq("status", "active")
      .eq("is_deleted", false)
      .eq("trigger_type", input.triggerType),
  ]);
  if (leadError) throw new Error(leadError.message);
  if (flowsError) throw new Error(flowsError.message);

  const leadRow = lead as LeadRow;
  if (isFinalStage(leadRow.pipeline_stage)) return { started: 0 };

  let started = 0;
  for (const flow of ((flows ?? []) as AutomationFlow[]).filter((item) =>
    flowMatchesLead(item, input.triggerType, leadRow, input.triggerPayload),
  )) {
    const rules = defaultStopRules(flow.stop_rules);
    const activeQuery = db
      .from("crm_automation_executions")
      .select("id, flow_id")
      .eq("lead_id", leadRow.id)
      .in("status", ["running", "waiting"]);
    if (!rules.avoid_conflicts) activeQuery.eq("flow_id", flow.id);
    const { data: active, error: activeError } = await activeQuery.limit(1);
    if (activeError) throw new Error(activeError.message);
    if ((active ?? []).length) continue;

    const steps = await getFlowSteps(flow.id);
    const first = steps[0];
    if (!first) continue;

    const { data: execution, error: executionError } = await db
      .from("crm_automation_executions")
      .insert({
        flow_id: flow.id,
        lead_id: leadRow.id,
        status: "running",
        current_step_id: first.id,
        trigger_type: input.triggerType,
        trigger_payload: (input.triggerPayload ?? {}) as Json,
      })
      .select("*")
      .single();
    if (executionError) {
      if (executionError.code === "23505") continue;
      throw new Error(executionError.message);
    }

    await Promise.all([
      scheduleStep({
        executionId: execution.id,
        flowId: flow.id,
        leadId: leadRow.id,
        step: first,
        runAt: new Date(),
        reason: input.triggerType,
      }),
      logAutomation({
        executionId: execution.id,
        flowId: flow.id,
        leadId: leadRow.id,
        stepId: first.id,
        eventType: "flow_entered",
        message: "Lead entrou na automacao.",
        metadata: { trigger_type: input.triggerType, actor_id: input.actorId },
      }),
      incrementMetric(flow.id, "entered", 1),
    ]);
    started++;
  }

  return { started };
}

export const listCrmAutomationWorkspace = createServerFn({ method: "GET" })
  .middleware([requireModule("automacoes")])
  .handler(async ({ context }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [
      flowsRes,
      stepsRes,
      executionsRes,
      pendingRes,
      logsRes,
      sentTodayRes,
      replyRes,
      errorRes,
    ] = await Promise.all([
      db
        .from("crm_automation_flows")
        .select("*")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false }),
      db
        .from("crm_automation_steps")
        .select("*")
        .eq("is_deleted", false)
        .order("position", { ascending: true }),
      db
        .from("crm_automation_executions")
        .select("id, flow_id, lead_id, status, current_step_id, started_at, last_activity_at, last_error")
        .in("status", ["running", "waiting"])
        .order("last_activity_at", { ascending: false })
        .limit(200),
      db
        .from("crm_automation_pending_actions")
        .select("*, leads(full_name, phone), crm_automation_flows(name), crm_automation_steps(title, step_type)")
        .eq("status", "pending")
        .order("run_at", { ascending: true })
        .limit(80),
      db
        .from("crm_automation_execution_logs")
        .select("*, leads(full_name), crm_automation_flows(name), crm_automation_steps(title)")
        .order("created_at", { ascending: false })
        .limit(120),
      db
        .from("crm_automation_execution_logs")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "message_sent")
        .gte("created_at", today.toISOString()),
      db
        .from("crm_automation_execution_logs")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "lead_replied")
        .gte("created_at", today.toISOString()),
      db
        .from("crm_automation_execution_logs")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "send_error")
        .gte("created_at", today.toISOString()),
    ]);

    for (const res of [flowsRes, stepsRes, executionsRes, pendingRes, logsRes]) {
      if (res.error) throw new Error(res.error.message);
    }
    if (sentTodayRes.error) throw new Error(sentTodayRes.error.message);
    if (replyRes.error) throw new Error(replyRes.error.message);
    if (errorRes.error) throw new Error(errorRes.error.message);

    const flows = (flowsRes.data ?? []) as AutomationFlow[];
    const steps = (stepsRes.data ?? []) as AutomationStep[];
    const executions = (executionsRes.data ?? []) as AutomationExecution[];
    const stepsByFlow = new Map<string, AutomationStep[]>();
    for (const step of steps) {
      if (!stepsByFlow.has(step.flow_id)) stepsByFlow.set(step.flow_id, []);
      stepsByFlow.get(step.flow_id)!.push(step);
    }
    const activeByFlow = new Map<string, number>();
    for (const execution of executions) {
      activeByFlow.set(execution.flow_id, (activeByFlow.get(execution.flow_id) ?? 0) + 1);
    }

    return {
      flows: flows.map((flow) => ({
        ...flow,
        steps: stepsByFlow.get(flow.id) ?? [],
        activeExecutions: activeByFlow.get(flow.id) ?? 0,
      })),
      pendingActions: pendingRes.data ?? [],
      logs: logsRes.data ?? [],
      metrics: {
        activeFlows: flows.filter((flow) => flow.status === "active").length,
        nextSends: (pendingRes.data ?? []).length,
        messagesSentToday: sentTodayRes.count ?? 0,
        repliesToday: replyRes.count ?? 0,
        errorsToday: errorRes.count ?? 0,
        stoppedByReply: flows.reduce(
          (sum, flow) => sum + Number((flow.metrics ?? {}).stopped_by_reply ?? 0),
          0,
        ),
      },
      permissions: {
        canManage: await canManageAutomations(context.userId, context.isAdmin),
        canPause: await canPauseAutomations(context.userId, context.isAdmin),
        canCancelPending: await canCancelPending(context.userId, context.isAdmin),
      },
    };
  });

export const saveCrmAutomationFlow = createServerFn({ method: "POST" })
  .middleware([requireModule("automacoes")])
  .inputValidator((d) => flowInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertManage(context.userId, context.isAdmin);
    const payload = {
      name: data.name,
      description: data.description || null,
      status: data.status,
      trigger_type: data.trigger_type,
      trigger_config: data.trigger_config as Json,
      stop_rules: defaultStopRules(data.stop_rules) as Json,
      schedule_window: defaultScheduleWindow(data.schedule_window) as Json,
      created_by: context.userId,
      is_deleted: false,
    };

    const { data: flow, error } = data.id
      ? await db.from("crm_automation_flows").update(payload).eq("id", data.id).select("*").single()
      : await db.from("crm_automation_flows").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await db
      .from("crm_automation_steps")
      .update({ is_deleted: true })
      .eq("flow_id", flow.id);

    for (const step of data.steps.sort((a, b) => a.position - b.position)) {
      const row = {
        flow_id: flow.id,
        position: step.position,
        step_type: step.step_type,
        title: step.title,
        config: step.config as Json,
        is_deleted: false,
      };
      const { error: stepError } = step.id
        ? await db.from("crm_automation_steps").upsert({ id: step.id, ...row })
        : await db.from("crm_automation_steps").insert(row);
      if (stepError) throw new Error(stepError.message);
    }

    await logAutomation({
      flowId: flow.id,
      eventType: "flow_saved",
      message: "Fluxo salvo pela equipe.",
      metadata: { actor_id: context.userId, status: data.status },
    });
    return { ok: true, id: flow.id as string };
  });

export const updateCrmAutomationFlowStatus = createServerFn({ method: "POST" })
  .middleware([requireModule("automacoes")])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), status: z.enum(["active", "paused", "archived"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.status === "paused") {
      if (!(await canPauseAutomations(context.userId, context.isAdmin))) {
        throw new Error("Sem permissao para pausar automacoes.");
      }
    } else {
      await assertManage(context.userId, context.isAdmin);
    }

    const { error } = await db.from("crm_automation_flows").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);

    if (data.status !== "active") {
      await db
        .from("crm_automation_pending_actions")
        .update({ status: "canceled", last_error: `flow_${data.status}` })
        .eq("flow_id", data.id)
        .eq("status", "pending");
    }

    await logAutomation({
      flowId: data.id,
      eventType: "flow_status_changed",
      message: `Fluxo alterado para ${data.status}.`,
      metadata: { actor_id: context.userId, status: data.status },
    });
    return { ok: true };
  });

export const duplicateCrmAutomationFlow = createServerFn({ method: "POST" })
  .middleware([requireModule("automacoes")])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertManage(context.userId, context.isAdmin);
    const [{ data: flow, error: flowError }, steps] = await Promise.all([
      db.from("crm_automation_flows").select("*").eq("id", data.id).single(),
      getFlowSteps(data.id),
    ]);
    if (flowError) throw new Error(flowError.message);
    const { data: copy, error: copyError } = await db
      .from("crm_automation_flows")
      .insert({
        name: `${flow.name} (copia)`,
        description: flow.description,
        status: "paused",
        trigger_type: flow.trigger_type,
        trigger_config: flow.trigger_config,
        stop_rules: flow.stop_rules,
        schedule_window: flow.schedule_window,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (copyError) throw new Error(copyError.message);

    for (const step of steps) {
      const { error } = await db.from("crm_automation_steps").insert({
        flow_id: copy.id,
        position: step.position,
        step_type: step.step_type,
        title: step.title,
        config: step.config,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true, id: copy.id as string };
  });

export const cancelCrmAutomationPendingAction = createServerFn({ method: "POST" })
  .middleware([requireModule("automacoes")])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().max(300).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await canCancelPending(context.userId, context.isAdmin))) {
      throw new Error("Sem permissao para cancelar envios pendentes.");
    }
    const { data: action, error } = await db
      .from("crm_automation_pending_actions")
      .update({
        status: "canceled",
        last_error: data.reason || "Cancelado pela equipe.",
        locked_at: null,
      })
      .eq("id", data.id)
      .eq("status", "pending")
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await logAutomation({
      executionId: action.execution_id,
      flowId: action.flow_id,
      leadId: action.lead_id,
      stepId: action.step_id,
      eventType: "pending_action_canceled",
      message: "Envio pendente cancelado pela equipe.",
      metadata: { actor_id: context.userId, reason: data.reason ?? null },
    });
    return { ok: true };
  });
