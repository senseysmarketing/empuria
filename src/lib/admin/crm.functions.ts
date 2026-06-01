/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin, requireModule } from "./auth";

const systemStageKeys = new Set(["novo", "em_contato", "reuniao", "fechado", "descartado"]);

const distributionError =
  "Nao foi possivel criar o lead porque nao ha uma regra de distribuicao ativa. Configure um responsavel padrao ou um rodizio de usuarios no CRM.";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type RoleRow = { user_id: string; role: "admin" | "staff"; created_at: string };
type ProfileRow = { id: string; full_name: string | null; avatar_url: string | null };
type CrmUser = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role: "admin" | "staff";
};
type CrmColumnRow = {
  id: string;
  key: string;
  label: string;
  type: "system" | "custom";
  position: number;
  is_locked: boolean;
};
type CrmLeadRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  target_visa: string | null;
  timeline: string | null;
  budget_range: string | null;
  message: string | null;
  notes: string | null;
  source: string | null;
  assigned_to: string | null;
  crm_column_id: string | null;
  created_at: string;
  last_interaction_at: string | null;
  next_followup_at: string | null;
  pipeline_stage: string;
  qualification_answers: JsonValue;
  qualification_score: number | null;
};
type CrmLeadWithOwner = CrmLeadRow & {
  assigned_user: CrmUser | null;
};
type CrmFollowupRow = {
  id: string;
  lead_id: string;
  assigned_to: string | null;
  due_at: string;
  status: "pending" | "done" | "skipped" | "canceled";
  message_preview: string | null;
};

function normalizeDbError(error: { message?: string } | null) {
  if (!error?.message) return "Erro inesperado no CRM";
  if (error.message.includes("regra de distribuicao ativa")) return distributionError;
  if (error.message.includes("responsavel")) return error.message;
  return error.message;
}

function fallbackEmail(fullName: string, phone: string) {
  const digits = phone.replace(/\D/g, "").slice(-12);
  const slug = fullName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/(^\.|\.$)/g, "")
    .slice(0, 40);
  return `${slug || "lead"}.${digits || Date.now()}@crm.empuria.local`;
}

async function listAssignableUsers(db: any): Promise<CrmUser[]> {
  const { data: roles, error: rolesError } = await db
    .from("user_roles")
    .select("user_id, role, created_at")
    .in("role", ["admin", "staff"]);
  if (rolesError) throw new Error(rolesError.message);

  const roleRows = (roles ?? []) as RoleRow[];
  const userIds = Array.from(new Set(roleRows.map((role: RoleRow) => role.user_id)));
  if (userIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await db
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", userIds);
  if (profilesError) throw new Error(profilesError.message);

  const roleByUser = new Map<string, "admin" | "staff">();
  for (const row of roleRows) {
    if (row.role === "admin" || !roleByUser.has(row.user_id))
      roleByUser.set(row.user_id, row.role as "admin" | "staff");
  }

  return ((profiles ?? []) as ProfileRow[])
    .map((profile: ProfileRow) => ({
      id: profile.id,
      full_name: profile.full_name ?? "Equipe Empuria",
      avatar_url: profile.avatar_url,
      role: roleByUser.get(profile.id) ?? "staff",
    }))
    .sort((a: CrmUser, b: CrmUser) => a.full_name.localeCompare(b.full_name, "pt-BR"));
}

function normalizeColumnKey(label: string) {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "")
    .slice(0, 48);
}

export const listCrmWorkspace = createServerFn({ method: "GET" })
  .middleware([requireModule("crm")])
  .handler(async ({ context }) => {
    const db = context.supabase as any;

    const [
      columnsRes,
      leadsRes,
      followupsRes,
      inboxRes,
      distributionRes,
      membersRes,
      activityRes,
      users,
    ] = await Promise.all([
      db
        .from("crm_columns")
        .select("*")
        .eq("is_active", true)
        .order("position", { ascending: true }),
      db.from("leads").select("*").order("created_at", { ascending: false }).limit(400),
      db.from("crm_followups").select("*").order("due_at", { ascending: true }).limit(250),
      db
        .from("crm_inbox_messages")
        .select("*")
        .in("status", ["received", "suggested"])
        .order("created_at", { ascending: false })
        .limit(100),
      db.from("crm_distribution_settings").select("*").eq("is_active", true).maybeSingle(),
      db.from("crm_distribution_members").select("*").order("position", { ascending: true }),
      db.from("lead_activity_log").select("*").order("created_at", { ascending: false }).limit(300),
      listAssignableUsers(db),
    ]);

    for (const res of [columnsRes, leadsRes, followupsRes, inboxRes, membersRes, activityRes]) {
      if (res.error) throw new Error(res.error.message);
    }
    if (distributionRes.error) throw new Error(distributionRes.error.message);

    const profileById = new Map(users.map((user: CrmUser) => [user.id, user]));
    const columns = (columnsRes.data ?? []) as CrmColumnRow[];
    const columnByStage = new Map(columns.map((column: CrmColumnRow) => [column.key, column.id]));

    const leads = ((leadsRes.data ?? []) as CrmLeadRow[]).map((lead: CrmLeadRow) => {
      const legacyStage =
        lead.pipeline_stage === "analise"
          ? "em_contato"
          : lead.pipeline_stage === "qualificado"
            ? "fechado"
            : lead.pipeline_stage;
      return {
        ...lead,
        crm_column_id:
          lead.crm_column_id ?? columnByStage.get(legacyStage) ?? columnByStage.get("novo") ?? null,
        assigned_user: lead.assigned_to ? (profileById.get(lead.assigned_to) ?? null) : null,
      };
    });

    const followups = ((followupsRes.data ?? []) as CrmFollowupRow[]).map(
      (followup: CrmFollowupRow) => ({
        ...followup,
        assigned_user: followup.assigned_to
          ? (profileById.get(followup.assigned_to) ?? null)
          : null,
        lead: leads.find((lead: CrmLeadWithOwner) => lead.id === followup.lead_id) ?? null,
      }),
    );

    return {
      columns,
      leads,
      followups,
      inbox: inboxRes.data ?? [],
      distribution: distributionRes.data ?? null,
      distributionMembers: membersRes.data ?? [],
      activity: activityRes.data ?? [],
      users,
      currentUserId: context.userId,
      isAdmin: Boolean(context.isAdmin),
      whatsappMode: "sugestao" as const,
    };
  });

export const createCrmLead = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z
      .object({
        full_name: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(6).max(30),
        email: z.string().trim().email().max(255).optional().or(z.literal("")),
        target_visa: z.string().trim().max(120).optional().or(z.literal("")),
        message: z.string().trim().max(1000).optional().or(z.literal("")),
        assigned_to: z.string().uuid().optional().or(z.literal("")),
        source: z.enum(["manual", "whatsapp", "site", "webhook"]).default("manual"),
        inbox_message_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: row, error } = await db
      .from("leads")
      .insert({
        full_name: data.full_name,
        email: data.email || fallbackEmail(data.full_name, data.phone),
        phone: data.phone,
        target_visa: data.target_visa || null,
        message: data.message || null,
        first_message: data.message || null,
        pipeline_stage: "novo",
        status: "novo",
        source: data.source,
        source_detail: data.inbox_message_id ? "crm_inbox" : "admin_crm",
        assigned_to: data.assigned_to || null,
        last_interaction_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(normalizeDbError(error));

    await db.from("lead_activity_log").insert({
      lead_id: row.id,
      kind: "note_added",
      payload: { body: "Lead criado manualmente no CRM." },
      actor_id: context.userId,
    });

    if (data.inbox_message_id) {
      await linkInboxToLeadInternal(db, data.inbox_message_id, row.id, context.userId);
    }

    return { ok: true, id: row.id };
  });

export const updateCrmLeadColumn = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z.object({ leadId: z.string().uuid(), columnId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const [{ data: lead, error: leadError }, { data: column, error: columnError }] =
      await Promise.all([
        db.from("leads").select("id, pipeline_stage, crm_column_id").eq("id", data.leadId).single(),
        db.from("crm_columns").select("id, key, label, type").eq("id", data.columnId).single(),
      ]);
    if (leadError) throw new Error(leadError.message);
    if (columnError) throw new Error(columnError.message);

    const patch: Record<string, unknown> = {
      crm_column_id: data.columnId,
      last_interaction_at: new Date().toISOString(),
    };
    if (systemStageKeys.has(column.key)) patch.pipeline_stage = column.key;

    const { error } = await db.from("leads").update(patch).eq("id", data.leadId);
    if (error) throw new Error(error.message);

    if (!systemStageKeys.has(column.key) || lead.pipeline_stage === column.key) {
      await db.from("lead_activity_log").insert({
        lead_id: data.leadId,
        kind: "stage_changed",
        payload: {
          from: lead.crm_column_id ?? lead.pipeline_stage,
          to: column.key,
          to_label: column.label,
        },
        actor_id: context.userId,
      });
    }

    return { ok: true };
  });

export const updateCrmLeadOwner = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z.object({ leadId: z.string().uuid(), assignedTo: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error } = await db
      .from("leads")
      .update({ assigned_to: data.assignedTo, last_interaction_at: new Date().toISOString() })
      .eq("id", data.leadId);
    if (error) throw new Error(normalizeDbError(error));

    await db.from("lead_activity_log").insert({
      lead_id: data.leadId,
      kind: "owner_changed",
      payload: { assigned_to: data.assignedTo },
      actor_id: context.userId,
    });

    return { ok: true };
  });

export const updateCrmLeadNotes = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z
      .object({
        leadId: z.string().uuid(),
        notes: z.string().max(4000).optional(),
        qualification_score: z.number().int().min(0).max(100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error } = await db
      .from("leads")
      .update({
        notes: data.notes ?? null,
        qualification_score: data.qualification_score ?? null,
        last_interaction_at: new Date().toISOString(),
      })
      .eq("id", data.leadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addCrmLeadNote = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z.object({ leadId: z.string().uuid(), body: z.string().trim().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error: activityError } = await db.from("lead_activity_log").insert({
      lead_id: data.leadId,
      kind: "note_added",
      payload: { body: data.body },
      actor_id: context.userId,
    });
    if (activityError) throw new Error(activityError.message);

    const { data: current } = await db.from("leads").select("notes").eq("id", data.leadId).single();
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const notes = `[${stamp}] ${data.body}\n${current?.notes ?? ""}`.trim();
    const { error } = await db
      .from("leads")
      .update({ notes, last_interaction_at: new Date().toISOString() })
      .eq("id", data.leadId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const createCrmFollowup = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z
      .object({
        leadId: z.string().uuid(),
        assignedTo: z.string().uuid(),
        dueAt: z.string().datetime(),
        messagePreview: z.string().trim().max(1000).optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: followup, error } = await db
      .from("crm_followups")
      .insert({
        lead_id: data.leadId,
        assigned_to: data.assignedTo,
        due_at: data.dueAt,
        message_preview: data.messagePreview || null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await Promise.all([
      db.from("leads").update({ next_followup_at: data.dueAt }).eq("id", data.leadId),
      db.from("lead_activity_log").insert({
        lead_id: data.leadId,
        kind: "followup_created",
        payload: { followup_id: followup.id, due_at: data.dueAt },
        actor_id: context.userId,
      }),
    ]);

    return { ok: true, id: followup.id };
  });

export const updateCrmFollowupStatus = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z
      .object({
        followupId: z.string().uuid(),
        status: z.enum(["pending", "done", "skipped", "canceled"]),
        dueAt: z.string().datetime().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const patch: Record<string, unknown> = { status: data.status };
    if (data.dueAt) patch.due_at = data.dueAt;
    if (data.status === "done") patch.completed_at = new Date().toISOString();

    const { data: followup, error } = await db
      .from("crm_followups")
      .update(patch)
      .eq("id", data.followupId)
      .select("lead_id, due_at")
      .single();
    if (error) throw new Error(error.message);

    if (data.status === "done") {
      await db.from("lead_activity_log").insert({
        lead_id: followup.lead_id,
        kind: "followup_done",
        payload: { followup_id: data.followupId },
        actor_id: context.userId,
      });
    }

    const { data: nextPending } = await db
      .from("crm_followups")
      .select("due_at")
      .eq("lead_id", followup.lead_id)
      .eq("status", "pending")
      .order("due_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    await db
      .from("leads")
      .update({ next_followup_at: nextPending?.due_at ?? null })
      .eq("id", followup.lead_id);

    return { ok: true };
  });

export const saveCrmColumn = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        label: z.string().trim().min(2).max(60),
        position: z.number().int().min(1).max(899),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const key = normalizeColumnKey(data.label);
    const payload = {
      key,
      label: data.label,
      type: "custom",
      position: data.position,
      is_active: true,
      is_locked: false,
      created_by: context.userId,
    };

    const query = data.id
      ? db
          .from("crm_columns")
          .update({ label: data.label, position: data.position })
          .eq("id", data.id)
          .eq("is_locked", false)
      : db.from("crm_columns").insert(payload);
    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deactivateCrmColumn = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: novo } = await db.from("crm_columns").select("id").eq("key", "novo").single();
    const { error } = await db
      .from("leads")
      .update({ crm_column_id: novo?.id ?? null, pipeline_stage: "novo" })
      .eq("crm_column_id", data.id);
    if (error) throw new Error(error.message);
    const { error: columnError } = await db
      .from("crm_columns")
      .update({ is_active: false })
      .eq("id", data.id)
      .eq("is_locked", false);
    if (columnError) throw new Error(columnError.message);
    return { ok: true };
  });

export const saveCrmDistribution = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((d) =>
    z
      .object({
        mode: z.enum(["fixed", "round_robin"]),
        fixedUserId: z.string().uuid().optional().or(z.literal("")),
        memberIds: z.array(z.string().uuid()).min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.mode === "fixed" && !data.fixedUserId)
      throw new Error("Escolha o responsavel padrao do CRM.");

    const db = context.supabase as any;
    const { data: existing } = await db
      .from("crm_distribution_settings")
      .select("id")
      .eq("is_active", true)
      .maybeSingle();

    const payload = {
      mode: data.mode,
      fixed_user_id: data.mode === "fixed" ? data.fixedUserId : null,
      is_active: true,
    };
    const { error } = existing?.id
      ? await db.from("crm_distribution_settings").update(payload).eq("id", existing.id)
      : await db.from("crm_distribution_settings").insert(payload);
    if (error) throw new Error(error.message);

    await db.from("crm_distribution_members").update({ is_active: false });
    for (const [index, userId] of data.memberIds.entries()) {
      const { error: memberError } = await db
        .from("crm_distribution_members")
        .upsert({ user_id: userId, position: index, is_active: true }, { onConflict: "user_id" });
      if (memberError) throw new Error(memberError.message);
    }

    return { ok: true };
  });

export const linkInboxToLead = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) =>
    z.object({ inboxId: z.string().uuid(), leadId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    await linkInboxToLeadInternal(db, data.inboxId, data.leadId, context.userId);
    return { ok: true };
  });

export const ignoreCrmInboxMessage = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) => z.object({ inboxId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error } = await db
      .from("crm_inbox_messages")
      .update({ status: "ignored" })
      .eq("id", data.inboxId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const logCrmWhatsappOpened = createServerFn({ method: "POST" })
  .middleware([requireModule("crm")])
  .inputValidator((d) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error } = await db.from("lead_activity_log").insert({
      lead_id: data.leadId,
      kind: "whatsapp_opened",
      payload: {},
      actor_id: context.userId,
    });
    if (error) throw new Error(error.message);
    await db
      .from("leads")
      .update({
        last_outbound_at: new Date().toISOString(),
        last_interaction_at: new Date().toISOString(),
      })
      .eq("id", data.leadId);
    return { ok: true };
  });

async function linkInboxToLeadInternal(db: any, inboxId: string, leadId: string, actorId: string) {
  const { data: inbox, error: inboxError } = await db
    .from("crm_inbox_messages")
    .select("*")
    .eq("id", inboxId)
    .single();
  if (inboxError) throw new Error(inboxError.message);

  const { data: conversation, error: conversationError } = await db
    .from("crm_conversations")
    .upsert(
      {
        lead_id: leadId,
        provider: inbox.provider,
        provider_chat_id: inbox.provider_chat_id,
        phone: inbox.from_phone,
        last_message_at: inbox.created_at,
        last_inbound_at: inbox.created_at,
      },
      { onConflict: "lead_id,provider,phone" },
    )
    .select("id")
    .single();
  if (conversationError) throw new Error(conversationError.message);

  const { error: messageError } = await db.from("crm_messages").insert({
    lead_id: leadId,
    conversation_id: conversation.id,
    direction: "inbound",
    provider: inbox.provider,
    provider_message_id: inbox.provider_message_id,
    body: inbox.body,
    message_type: inbox.message_type,
    status: "received",
    created_at: inbox.created_at,
  });
  if (messageError) throw new Error(messageError.message);

  const { error } = await db
    .from("crm_inbox_messages")
    .update({ status: "linked", matched_lead_id: leadId })
    .eq("id", inboxId);
  if (error) throw new Error(error.message);

  await Promise.all([
    db
      .from("leads")
      .update({ last_inbound_at: inbox.created_at, last_interaction_at: inbox.created_at })
      .eq("id", leadId),
    db.from("lead_activity_log").insert({
      lead_id: leadId,
      kind: "inbox_message_linked",
      payload: { inbox_id: inboxId, body: inbox.body },
      actor_id: actorId,
    }),
  ]);
}
