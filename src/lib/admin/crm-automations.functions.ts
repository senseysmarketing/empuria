/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { requireModule } from "./auth";

import { sendCrmWhatsappMessageInternal } from "./crm-whatsapp.functions";
import {
  allowedMediaMime,
  INBOX_MEDIA_BUCKET,
  MAX_INBOX_MEDIA_BYTES,
  validMediaName,
  type InboxMediaKind,
} from "@/lib/uazapi/uazapi.media";
import { renderCrmAutomationTemplate } from "./crm-automation.template";
import { defaultScheduleWindow, isWithinWindow, nextAllowedRunAt } from "./crm-automation.schedule";
import { defaultStopRules, shouldStopForLead } from "./crm-automation.rules";

const db = supabaseAdmin as any;

type AutomationFlow = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  trigger_type: "lead_created" | "pipeline_stage_entered" | "manual";
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
  status: "running" | "waiting" | "paused" | "completed" | "stopped" | "failed";
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
  source: string | null;
  target_visa: string | null;
  current_country: string | null;
  qualification_answers: Record<string, unknown> | null;
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
  trigger_type: z.enum(["lead_created", "pipeline_stage_entered", "manual"]),
  trigger_config: z.record(z.any()).default({}),
  stop_rules: z.record(z.any()).default({}),
  schedule_window: z.record(z.any()).default({}),
  steps: z.array(stepInputSchema).min(1).max(30),
});

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

async function messageForStep(step: AutomationStep, lead: LeadRow) {
  const template =
    typeof step.config.message === "string" && step.config.message.trim()
      ? step.config.message.trim()
      : "";
  const [owner, column] = await Promise.all([
    lead.assigned_to
      ? db.from("profiles").select("full_name").eq("id", lead.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
    lead.crm_column_id
      ? db.from("crm_columns").select("label").eq("id", lead.crm_column_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const answers = lead.qualification_answers ?? {};
  return renderCrmAutomationTemplate(template, {
    nome: lead.full_name,
    telefone: lead.phone,
    email: lead.email,
    objetivo: lead.target_visa,
    servico:
      typeof answers.servico === "string"
        ? answers.servico
        : typeof answers.service === "string"
          ? answers.service
          : null,
    responsavel: owner.data?.full_name ?? null,
    etapa: column.data?.label ?? lead.pipeline_stage,
  });
}

async function canManageAutomations(_userId: string, _isAdmin?: boolean) {
  // A central agora faz parte do CRM; o middleware do módulo protege todas as ações visuais.
  return true;
}

async function canPauseAutomations(_userId: string, _isAdmin?: boolean) {
  return true;
}

async function canCancelPending(_userId: string, _isAdmin?: boolean) {
  return true;
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
  await db.rpc("crm_automation_increment_metric", {
    p_flow_id: flowId,
    p_key: key,
    p_amount: amount,
  });
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
  const idempotencyKey = `${executionId}:${step.id}`;
  const { error } = await db.from("crm_automation_pending_actions").insert({
    execution_id: executionId,
    flow_id: flowId,
    lead_id: leadId,
    step_id: step.id,
    action_type: "process_step",
    payload: { reason: reason ?? "scheduled" },
    status: "pending",
    run_at: runAt.toISOString(),
    idempotency_key: idempotencyKey,
  });
  if (error && error.code !== "23505") throw new Error(error.message);
}

async function stopExecution(
  execution: AutomationExecution,
  reason: string,
  stepId?: string | null,
) {
  if (reason === "lead_replied") {
    const { error } = await db.rpc("crm_automation_stop_for_lead", {
      p_lead_id: execution.lead_id,
      p_reason: reason,
      p_step_id: null,
    });
    if (error) throw new Error(error.message);
    return;
  }
  const stoppedAt = new Date().toISOString();
  const { data: stopped, error } = await db
    .from("crm_automation_executions")
    .update({
      status: "stopped",
      stop_reason: reason,
      completed_at: stoppedAt,
      last_activity_at: stoppedAt,
      current_step_id: stepId ?? execution.current_step_id,
    })
    .eq("id", execution.id)
    .in("status", ["running", "waiting", "paused"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!stopped) return;
  await Promise.all([
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
  return shouldStopForLead(
    stopRules,
    lead.pipeline_stage,
    stopRules.stop_on_reply && (await hasInboundAfter(lead.id, execution.started_at)),
  );
}

async function completeExecution(execution: AutomationExecution, stepId?: string | null) {
  const now = new Date().toISOString();
  const { data: completed, error } = await db
    .from("crm_automation_executions")
    .update({
      status: "completed",
      completed_at: now,
      last_activity_at: now,
      current_step_id: stepId ?? execution.current_step_id,
    })
    .eq("id", execution.id)
    .in("status", ["running", "waiting"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (completed)
    await logAutomation({
      executionId: execution.id,
      flowId: execution.flow_id,
      leadId: execution.lead_id,
      stepId,
      eventType: "automation_completed",
      message: "Automacao concluida.",
    });
}

async function processStep(action: PendingAction) {
  const [
    { data: execution, error: executionError },
    { data: flow, error: flowError },
    { data: lead, error: leadError },
  ] = await Promise.all([
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

  if (flowRow.status === "paused") {
    await db
      .from("crm_automation_pending_actions")
      .update({
        status: "pending",
        run_at: addMinutes(new Date(), 5).toISOString(),
        locked_at: null,
      })
      .eq("id", action.id)
      .eq("status", "locked");
    return;
  }
  if (flowRow.status !== "active" || flowRow.is_deleted) {
    await stopExecution(executionRow, "flow_not_active", step.id);
    return;
  }
  if (executionRow.status === "paused") {
    await db
      .from("crm_automation_pending_actions")
      .update({
        status: "pending",
        run_at: addMinutes(new Date(), 5).toISOString(),
        locked_at: null,
      })
      .eq("id", action.id)
      .eq("status", "locked");
    return;
  }
  if (!["running", "waiting"].includes(executionRow.status)) return;

  const stopReason = await shouldStopBeforeStep(executionRow, flowRow, leadRow);
  if (stopReason) {
    await stopExecution(executionRow, stopReason, step.id);
    return;
  }

  const now = new Date();
  if (
    step.step_type === "send_whatsapp" &&
    !isWithinWindow(now, defaultScheduleWindow(flowRow.schedule_window))
  ) {
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

  let skipNext = false;
  if (step.step_type === "send_whatsapp") {
    const body = await messageForStep(step, leadRow);
    const sent = await sendCrmWhatsappMessageInternal({
      leadId: leadRow.id,
      message: body,
      source: "crm_automation",
      executionId: executionRow.id,
      flowId: flowRow.id,
      stepId: step.id,
      trackId: `automation:${executionRow.id}:${step.id}`,
      media: step.config.media_path
        ? {
            kind: step.config.media_kind as InboxMediaKind,
            path: String(step.config.media_path),
            mime: String(step.config.media_mime),
            name: String(step.config.media_name),
            size: Number(step.config.media_size),
          }
        : null,
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
        .eq("id", executionRow.id)
        .in("status", ["running", "waiting"]),
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
    const field = String(step.config.field ?? "source");
    if (!["source", "target_visa", "current_country", "crm_column_id"].includes(field))
      throw new Error("Campo de condicao invalido.");
    const matches =
      String(leadRow[field as keyof LeadRow] ?? "").toLowerCase() ===
      String(step.config.value ?? "").toLowerCase();
    const passed = step.config.operator === "not_equals" ? !matches : matches;
    if (!passed && step.config.on_false !== "skip_next") {
      await stopExecution(executionRow, "condition_not_met", step.id);
      return;
    }
    skipNext = !passed;
    await logAutomation({
      executionId: executionRow.id,
      flowId: flowRow.id,
      leadId: leadRow.id,
      stepId: step.id,
      eventType: "condition_checked",
      message: passed ? "Condicao atendida." : "Condicao nao atendida; proximo bloco pulado.",
      metadata: { field, passed },
    });
  }

  if (step.step_type === "action") {
    if (step.config.action === "move_stage") {
      const { data: column } = await db
        .from("crm_columns")
        .select("id,key,is_active")
        .eq("id", String(step.config.column_id ?? ""))
        .eq("is_active", true)
        .maybeSingle();
      if (!column) throw new Error("Coluna de destino arquivada ou invalida.");
      const patch: Record<string, unknown> = {
        crm_column_id: column.id,
        last_interaction_at: new Date().toISOString(),
      };
      if (["novo", "em_contato", "reuniao", "fechado", "descartado"].includes(column.key))
        patch.pipeline_stage = column.key;
      const { error: moveError } = await db.from("leads").update(patch).eq("id", leadRow.id);
      if (moveError) throw new Error(moveError.message);
    } else if (step.config.action === "followup") {
      if (!leadRow.assigned_to) throw new Error("Lead sem responsavel para follow-up.");
      const hours = Number(step.config.hours ?? 24);
      if (!Number.isInteger(hours) || hours < 1 || hours > 720)
        throw new Error("Prazo de follow-up invalido.");
      const key = `automation:${executionRow.id}:${step.id}`;
      const { error: followupError } = await db.from("crm_followups").insert({
        lead_id: leadRow.id,
        assigned_to: leadRow.assigned_to,
        type: "automation",
        mode: "automatic",
        template_key: key,
        due_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
        message_preview: String(step.config.message ?? "").slice(0, 1000),
      });
      if (followupError && followupError.code !== "23505") throw new Error(followupError.message);
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

  const { data: currentExecution } = await db
    .from("crm_automation_executions")
    .select("status")
    .eq("id", executionRow.id)
    .maybeSingle();
  if (!currentExecution || !["running", "waiting"].includes(currentExecution.status)) {
    await db
      .from("crm_automation_pending_actions")
      .update({ status: "canceled", locked_at: null })
      .eq("id", action.id)
      .eq("status", "locked");
    return;
  }
  if (await hasInboundAfter(leadRow.id, executionRow.started_at)) {
    await stopExecution(executionRow, "lead_replied", step.id);
    return;
  }
  const immediateNext = nextStep(steps, step);
  const next = skipNext && immediateNext ? nextStep(steps, immediateNext) : immediateNext;
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
    .update({
      status: "locked",
      locked_at: new Date().toISOString(),
      attempts: action.attempts + 1,
    })
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
    const { data: current } = await db
      .from("crm_automation_executions")
      .select("status")
      .eq("id", action.execution_id)
      .maybeSingle();
    if (current?.status === "stopped" || current?.status === "completed") {
      return { status: "skipped" };
    }
    const attempts = Number(locked.attempts ?? 1);
    const { data: failedStep } = await db
      .from("crm_automation_steps")
      .select("step_type")
      .eq("id", action.step_id)
      .maybeSingle();
    // A network failure after Uazapi receives a request is ambiguous. Never resend it blindly.
    const backoff =
      failedStep?.step_type === "send_whatsapp"
        ? null
        : attempts === 1
          ? 1
          : attempts === 2
            ? 5
            : attempts === 3
              ? 15
              : null;
    if (backoff) {
      await db
        .from("crm_automation_pending_actions")
        .update({
          status: "pending",
          locked_at: null,
          run_at: addMinutes(new Date(), backoff).toISOString(),
          last_error: message,
        })
        .eq("id", action.id)
        .eq("status", "locked");
    } else {
      await Promise.all([
        db
          .from("crm_automation_pending_actions")
          .update({ status: "failed", locked_at: null, last_error: message })
          .eq("id", action.id)
          .eq("status", "locked"),
        db
          .from("crm_automation_executions")
          .update({
            status: "failed",
            last_error: message,
            last_activity_at: new Date().toISOString(),
          })
          .eq("id", action.execution_id)
          .in("status", ["running", "waiting"]),
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
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: staleLocks, error: staleError } = await db
    .from("crm_automation_pending_actions")
    .select("id,execution_id,flow_id,lead_id,step_id,crm_automation_steps(step_type)")
    .eq("status", "locked")
    .lt("locked_at", staleBefore)
    .limit(50);
  if (staleError) throw new Error(staleError.message);
  for (const stale of staleLocks ?? []) {
    const send = stale.crm_automation_steps?.step_type === "send_whatsapp";
    const { data: changed } = await db
      .from("crm_automation_pending_actions")
      .update({
        status: send ? "failed" : "pending",
        locked_at: null,
        last_error: send
          ? "Retorno de envio incerto; conferir na Uazapi antes de repetir."
          : "Lock vencido; reprocessamento seguro.",
      })
      .eq("id", stale.id)
      .eq("status", "locked")
      .lt("locked_at", staleBefore)
      .select("id")
      .maybeSingle();
    if (send && changed) {
      await db
        .from("crm_automation_executions")
        .update({ status: "failed", last_error: "Envio incerto; revisao necessaria." })
        .eq("id", stale.execution_id)
        .in("status", ["running", "waiting"]);
      await logAutomation({
        executionId: stale.execution_id,
        flowId: stale.flow_id,
        leadId: stale.lead_id,
        stepId: stale.step_id,
        eventType: "send_uncertain",
        message: "Envio pode ter ocorrido; revisao manual necessaria antes de repetir.",
      });
    }
  }
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

function flowMatchesLead(
  flow: AutomationFlow,
  triggerType: string,
  lead: LeadRow,
  payload?: Record<string, any>,
) {
  if (flow.status !== "active" || flow.is_deleted || flow.trigger_type !== triggerType)
    return false;
  if (triggerType === "lead_created") {
    const source = String(flow.trigger_config?.source ?? "all");
    if (source !== "all" && source !== lead.source) return false;
  }
  if (triggerType === "pipeline_stage_entered") {
    const columnId = flow.trigger_config?.column_id;
    if (!columnId || columnId !== payload?.column_id || columnId !== lead.crm_column_id)
      return false;
  }
  return true;
}

export async function startMatchingCrmAutomationsForLead(input: {
  leadId: string;
  triggerType: "lead_created" | "pipeline_stage_entered" | "manual";
  triggerPayload?: Record<string, any>;
  actorId?: string | null;
  flowId?: string;
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
  let started = 0;
  for (const flow of ((flows ?? []) as AutomationFlow[]).filter(
    (item) =>
      (!input.flowId || item.id === input.flowId) &&
      flowMatchesLead(item, input.triggerType, leadRow, input.triggerPayload),
  )) {
    const rules = defaultStopRules(flow.stop_rules);
    if (rules.stop_on_final_stage && isFinalStage(leadRow.pipeline_stage)) continue;
    const activeQuery = db
      .from("crm_automation_executions")
      .select("id, flow_id")
      .eq("lead_id", leadRow.id)
      .in("status", ["running", "waiting", "paused"]);
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
        trigger_key:
          input.triggerType === "lead_created"
            ? `lead_created:${leadRow.id}`
            : input.triggerType === "pipeline_stage_entered"
              ? `column:${String(input.triggerPayload?.event_id ?? `${leadRow.id}:${input.triggerPayload?.column_id}`)}`
              : `manual:${crypto.randomUUID()}`,
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
  .middleware([requireModule("crm")])
  .handler(async ({ context }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [flowsRes, stepsRes, columnsRes] = await Promise.all([
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
        .from("crm_columns")
        .select("id,label,key,type")
        .eq("is_active", true)
        .order("position", { ascending: true }),
    ]);
    if (flowsRes.error) throw new Error(flowsRes.error.message);
    if (stepsRes.error) throw new Error(stepsRes.error.message);
    if (columnsRes.error) throw new Error(columnsRes.error.message);
    const flows = (flowsRes.data ?? []) as AutomationFlow[];

    const [
      pendingRes,
      logsRes,
      pendingCountRes,
      sentTodayRes,
      replyRes,
      errorRes,
      activeCountResults,
    ] = await Promise.all([
      db
        .from("crm_automation_pending_actions")
        .select(
          "*, leads(full_name, phone), crm_automation_flows(name), crm_automation_steps(title, step_type)",
        )
        .eq("status", "pending")
        .order("run_at", { ascending: true })
        .limit(20),
      db
        .from("crm_automation_execution_logs")
        .select("*, leads(full_name), crm_automation_flows(name), crm_automation_steps(title)")
        .order("created_at", { ascending: false })
        .limit(30),
      db
        .from("crm_automation_pending_actions")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
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
      Promise.all(
        flows.map((flow) =>
          db
            .from("crm_automation_executions")
            .select("id", { count: "exact", head: true })
            .eq("flow_id", flow.id)
            .in("status", ["running", "waiting", "paused"]),
        ),
      ),
    ]);

    for (const res of [pendingRes, logsRes, pendingCountRes]) {
      if (res.error) throw new Error(res.error.message);
    }
    if (sentTodayRes.error) throw new Error(sentTodayRes.error.message);
    if (replyRes.error) throw new Error(replyRes.error.message);
    if (errorRes.error) throw new Error(errorRes.error.message);

    const steps = (stepsRes.data ?? []) as AutomationStep[];
    const stepsByFlow = new Map<string, AutomationStep[]>();
    for (const step of steps) {
      if (!stepsByFlow.has(step.flow_id)) stepsByFlow.set(step.flow_id, []);
      stepsByFlow.get(step.flow_id)!.push(step);
    }
    const activeByFlow = new Map<string, number>();
    for (const [index, result] of activeCountResults.entries()) {
      if (result.error) throw new Error(result.error.message);
      activeByFlow.set(flows[index].id, result.count ?? 0);
    }

    return {
      flows: flows.map((flow) => ({
        ...flow,
        steps: stepsByFlow.get(flow.id) ?? [],
        activeExecutions: activeByFlow.get(flow.id) ?? 0,
      })),
      columns: columnsRes.data ?? [],
      pendingActions: pendingRes.data ?? [],
      logs: logsRes.data ?? [],
      metrics: {
        activeFlows: flows.filter((flow) => flow.status === "active").length,
        nextSends: pendingCountRes.count ?? 0,
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

export const getCrmLeadAutomationState = createServerFn({ method: "GET" })
  .middleware([requireModule("crm")])
  .inputValidator((d) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const [executions, flows] = await Promise.all([
      db
        .from("crm_automation_executions")
        .select(
          "id,flow_id,status,current_step_id,started_at,last_activity_at,crm_automation_flows(name,schedule_window),crm_automation_steps(title)",
        )
        .eq("lead_id", data.leadId)
        .in("status", ["running", "waiting", "paused"])
        .order("last_activity_at", { ascending: false })
        .limit(5),
      db
        .from("crm_automation_flows")
        .select("id,name")
        .eq("trigger_type", "manual")
        .eq("status", "active")
        .eq("is_deleted", false)
        .order("name", { ascending: true }),
    ]);
    if (executions.error) throw new Error(executions.error.message);
    if (flows.error) throw new Error(flows.error.message);
    const ids = (executions.data ?? []).map((row: { id: string }) => row.id);
    const { data: actions, error } = ids.length
      ? await db
          .from("crm_automation_pending_actions")
          .select("execution_id,run_at,crm_automation_steps(title,step_type)")
          .in("execution_id", ids)
          .eq("status", "pending")
          .order("run_at", { ascending: true })
      : { data: [], error: null };
    if (error) throw new Error(error.message);
    return { executions: executions.data ?? [], flows: flows.data ?? [], actions: actions ?? [] };
  });

export const controlCrmLeadAutomation = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("start"),
          leadId: z.string().uuid(),
          flowId: z.string().uuid(),
        }),
        z.object({
          action: z.enum(["pause", "resume", "cancel"]),
          leadId: z.string().uuid(),
          executionId: z.string().uuid(),
        }),
      ])
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertManage(context.userId, context.isAdmin);
    if (data.action === "start") {
      const result = await startMatchingCrmAutomationsForLead({
        leadId: data.leadId,
        flowId: data.flowId,
        triggerType: "manual",
        actorId: context.userId,
      });
      if (!result.started)
        throw new Error("Fluxo indisponivel ou outro fluxo ja esta em andamento.");
      return { ok: true };
    }
    const { data: execution } = await db
      .from("crm_automation_executions")
      .select("id")
      .eq("id", data.executionId)
      .eq("lead_id", data.leadId)
      .maybeSingle();
    if (!execution) throw new Error("Execucao nao encontrada para este lead.");
    const { error } = await db.rpc("crm_automation_control_execution", {
      p_execution_id: data.executionId,
      p_action: data.action,
      p_actor: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveCrmAutomationFlow = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) => flowInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertManage(context.userId, context.isAdmin);
    const window = defaultScheduleWindow(data.schedule_window);
    if (window.enabled) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: window.timezone });
      } catch {
        throw new Error("Fuso horario invalido.");
      }
      if (
        !Array.isArray(window.weekdays) ||
        window.weekdays.length === 0 ||
        window.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(window.start)) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(window.end)) ||
        String(window.start) >= String(window.end)
      )
        throw new Error("Janela de envio invalida.");
    }
    const rules = defaultStopRules(data.stop_rules);
    if (rules.on_reply_move_stage_enabled) {
      if (!rules.stop_on_reply || !rules.on_reply_move_stage)
        throw new Error("Selecione uma coluna ativa e habilite a parada por resposta.");
      const { data: destination } = await db
        .from("crm_columns")
        .select("id")
        .eq("id", rules.on_reply_move_stage)
        .eq("is_active", true)
        .maybeSingle();
      if (!destination) throw new Error("A coluna escolhida foi arquivada ou removida.");
    }
    if (data.steps.some((step, index) => step.position !== index + 1))
      throw new Error("Os blocos devem ter posicoes consecutivas.");
    const allowedVariables = new Set([
      "nome",
      "primeiro_nome",
      "telefone",
      "email",
      "objetivo",
      "servico",
      "serviço",
      "responsavel",
      "etapa",
    ]);
    for (const step of data.steps) {
      if (step.step_type === "send_whatsapp") {
        const message = String(step.config.message ?? "");
        const mediaPath = step.config.media_path;
        if ((!message.trim() && !mediaPath) || message.length > 4000)
          throw new Error("Mensagem ou midia invalida.");
        if (
          mediaPath &&
          (typeof mediaPath !== "string" ||
            !/^automations\/[0-9a-f-]{36}\/file\.[a-z0-9]{2,5}$/i.test(mediaPath) ||
            !["image", "video", "audio", "document"].includes(String(step.config.media_kind)) ||
            !allowedMediaMime(
              step.config.media_kind as InboxMediaKind,
              String(step.config.media_mime),
            ) ||
            !validMediaName(String(step.config.media_name), String(step.config.media_mime)))
        )
          throw new Error("Anexo do fluxo invalido.");
        for (const match of message.matchAll(/\{\{?([^{}]+)\}\}?/g)) {
          if (!allowedVariables.has(match[1].trim().toLowerCase()))
            throw new Error(`Variavel desconhecida: ${match[1]}`);
        }
      }
      if (
        step.step_type === "delay" &&
        (!Number.isInteger(Number(step.config.amount)) ||
          Number(step.config.amount) < 1 ||
          !["minutes", "hours", "days"].includes(String(step.config.unit)))
      )
        throw new Error("Delay invalido.");
      if (step.step_type === "action" && step.config.action === "move_stage") {
        const { data: column } = await db
          .from("crm_columns")
          .select("id")
          .eq("id", String(step.config.column_id ?? ""))
          .eq("is_active", true)
          .maybeSingle();
        if (!column) throw new Error("Coluna de destino invalida ou arquivada.");
      }
    }
    const payload = {
      id: data.id,
      name: data.name,
      description: data.description || null,
      trigger_type: data.trigger_type,
      trigger_config: data.trigger_config,
      stop_rules: { ...data.stop_rules, ...rules },
      schedule_window: window,
    };
    const { data: flowId, error } = await db.rpc("crm_automation_save_flow_atomic", {
      p_flow: payload as Json,
      p_steps: data.steps as Json,
      p_actor: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, id: flowId as string };
  });

export const prepareCrmAutomationMedia = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z
      .object({
        kind: z.enum(["image", "video", "audio", "document"]),
        mime: z.string().max(150),
        name: z.string().trim().min(1).max(180),
        size: z.number().int().min(1).max(MAX_INBOX_MEDIA_BYTES),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertManage(context.userId, context.isAdmin);
    if (!allowedMediaMime(data.kind, data.mime) || !validMediaName(data.name, data.mime))
      throw new Error("Tipo de anexo nao suportado.");
    const extension = data.name.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
    if (!extension) throw new Error("Extensao de arquivo invalida.");
    const path = `automations/${crypto.randomUUID()}/file.${extension}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from(INBOX_MEDIA_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error("Nao foi possivel preparar o anexo privado.");
    return { path: signed.path, token: signed.token };
  });

export const updateCrmAutomationFlowStatus = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
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

    const { error } = await db
      .from("crm_automation_flows")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    if (data.status === "archived") {
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
  .middleware([requireModule("crm")])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertManage(context.userId, context.isAdmin);
    const [{ data: flow, error: flowError }, steps] = await Promise.all([
      db.from("crm_automation_flows").select("*").eq("id", data.id).single(),
      getFlowSteps(data.id),
    ]);
    if (flowError) throw new Error(flowError.message);
    const { data: copyId, error: copyError } = await db.rpc("crm_automation_save_flow_atomic", {
      p_flow: {
        name: `${flow.name} (copia)`,
        description: flow.description,
        trigger_type: flow.trigger_type,
        trigger_config: flow.trigger_config,
        stop_rules: flow.stop_rules,
        schedule_window: flow.schedule_window,
      } as Json,
      p_steps: steps.map((step) => ({
        step_type: step.step_type,
        title: step.title,
        config: step.config,
      })) as Json,
      p_actor: context.userId,
    });
    if (copyError) throw new Error(copyError.message);
    return { ok: true, id: copyId as string };
  });

export const cancelCrmAutomationPendingAction = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
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
