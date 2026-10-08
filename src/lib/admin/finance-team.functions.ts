import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { FinanceTransaction } from "./financeiro.functions";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const monthStartSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/);
const currencySchema = z.enum(["BRL", "EUR"]);
const payeeTypeSchema = z.enum(["team", "contractor", "partner", "supplier", "other"]);
const ruleTypeSchema = z.enum(["fixed_monthly", "revenue_percent", "service_percent"]);

export type FinancePayee = {
  id: string;
  name: string;
  type: z.infer<typeof payeeTypeSchema>;
  profile_id: string | null;
  notes: string | null;
  is_active: boolean;
  archived_at: string | null;
};

export type FinancePayoutRule = {
  id: string;
  payee_id: string;
  rule_type: z.infer<typeof ruleTypeSchema>;
  amount_cents: number | null;
  currency: string | null;
  percentage: number | null;
  service_ids: string[];
  include_brl: boolean;
  include_eur: boolean;
  day_of_month: number | null;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
  archived_at: string | null;
};

export type FinancePayout = {
  id: string;
  payee_id: string;
  rule_id: string;
  period_month: string;
  currency: string;
  base_amount_cents: number;
  percentage: number | null;
  amount_cents: number;
  finance_transaction_id: string | null;
  voided_at: string | null;
};

export type FinanceTeamMember = {
  payee: FinancePayee;
  rule: FinancePayoutRule | null;
  payouts: { payout: FinancePayout; transaction: FinanceTransaction | null }[];
};

export type FinancePayoutProjection = {
  rule_id: string;
  payee_id: string;
  currency: "BRL" | "EUR";
  base_amount_cents: number;
  percentage: number;
  projected_amount_cents: number;
  payout_id: string | null;
};

// Keep the finance calls on a narrow dynamic client while the branch's new
// schema is awaiting deployment to the project used for local development.
const db = supabaseAdmin as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (name: string, args: Record<string, unknown>) => any;
};

async function audit(actorId: string, action: string, entityId: string | null, data: object) {
  await supabaseAdmin.from("audit_logs").insert({
    actor_id: actorId,
    module: "financeiro",
    entity_type: "finance_payout",
    entity_id: entityId,
    action,
    new_data: data as Json,
  });
}

const payeeInput = z.object({
  name: z.string().trim().min(2).max(120),
  type: payeeTypeSchema,
  profileId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const ruleInput = z
  .object({
    payeeId: z.string().uuid(),
    ruleType: ruleTypeSchema,
    amount: z.number().finite().min(0).max(21_474_836).nullable().optional(),
    currency: currencySchema.nullable().optional(),
    percentage: z.number().finite().positive().max(100).nullable().optional(),
    serviceIds: z.array(z.string().uuid()).max(50).default([]),
    includeBrl: z.boolean().default(true),
    includeEur: z.boolean().default(true),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    startsOn: monthStartSchema,
    endsOn: monthStartSchema.nullable().optional(),
  })
  .superRefine((rule, ctx) => {
    if (rule.endsOn && rule.endsOn < rule.startsOn) {
      ctx.addIssue({ code: "custom", message: "Fim anterior ao início." });
    }
    if (rule.ruleType === "fixed_monthly") {
      if (rule.amount == null || !rule.currency || !rule.dayOfMonth) {
        ctx.addIssue({ code: "custom", message: "Valor, moeda e vencimento são obrigatórios." });
      }
    } else if (
      !rule.percentage ||
      (rule.ruleType === "service_percent" && !rule.serviceIds.length)
    ) {
      ctx.addIssue({ code: "custom", message: "Percentual e serviço são obrigatórios." });
    }
    if (rule.ruleType !== "fixed_monthly" && !rule.includeBrl && !rule.includeEur) {
      ctx.addIssue({ code: "custom", message: "Selecione BRL, EUR ou ambas." });
    }
  });

function rulePatch(data: z.infer<typeof ruleInput>) {
  const fixed = data.ruleType === "fixed_monthly";
  return {
    payee_id: data.payeeId,
    rule_type: data.ruleType,
    amount_cents: fixed ? Math.round((data.amount ?? 0) * 100) : null,
    currency: fixed ? data.currency : null,
    percentage: fixed ? null : data.percentage,
    include_brl: data.includeBrl,
    include_eur: data.includeEur,
    day_of_month: fixed ? data.dayOfMonth : null,
    starts_on: data.startsOn,
    ends_on: data.endsOn ?? null,
  };
}

export const listFinanceTeamMonth = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z.object({ month: monthSchema, showArchived: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data }) => {
    const period = `${data.month}-01`;
    const { error: ensureError } = await db.rpc("finance_ensure_month", {
      p_month: period,
      p_actor: null,
    });
    if (ensureError) throw new Error(ensureError.message);
    const [payeesQ, rulesQ, payoutsQ, servicesQ, ruleServicesQ] = await Promise.all([
      db
        .from("finance_payees")
        .select("id,name,type,profile_id,notes,is_active,archived_at")
        .order("name"),
      db
        .from("finance_payout_rules")
        .select(
          "id,payee_id,rule_type,amount_cents,currency,percentage,day_of_month,starts_on,ends_on,is_active,archived_at,include_brl,include_eur",
        )
        .order("created_at", { ascending: false }),
      db
        .from("finance_payouts")
        .select(
          "id,payee_id,rule_id,period_month,currency,base_amount_cents,percentage,amount_cents,finance_transaction_id,voided_at",
        )
        .eq("period_month", period),
      supabaseAdmin.from("services").select("id,title").order("title"),
      db.from("finance_payout_rule_services").select("rule_id,service_id"),
    ]);
    for (const query of [payeesQ, rulesQ, payoutsQ, servicesQ, ruleServicesQ]) {
      if (query.error) throw new Error(query.error.message);
    }
    const payouts = (payoutsQ.data ?? []) as FinancePayout[];
    const transactionIds = payouts.map((payout) => payout.finance_transaction_id).filter(Boolean);
    const transactionsQ = transactionIds.length
      ? await db
          .from("finance_transactions")
          .select(
            "id,status,due_date,amount_cents,currency,settled_amount_cents,settled_currency,paid_at,account_id,reference_amount_cents,reference_currency,fx_reference_rate,fx_rate,fx_source,fx_date,type,description,category_id,payment_method,source_module,source_id,is_automatic,notes,created_at",
          )
          .in("id", transactionIds)
      : { data: [], error: null };
    if (transactionsQ.error) throw new Error(transactionsQ.error.message);
    const rules = ((rulesQ.data ?? []) as Omit<FinancePayoutRule, "service_ids">[]).map((r) => ({
      ...r,
      service_ids: (ruleServicesQ.data ?? [])
        .filter((rs: { rule_id: string; service_id: string }) => rs.rule_id === r.id)
        .map((rs: { service_id: string }) => rs.service_id),
    }));
    const txMap = new Map(
      ((transactionsQ.data ?? []) as FinanceTransaction[]).map((tx) => [tx.id, tx]),
    );
    const totals = {
      BRL: { payable: 0, paid: 0 },
      EUR: { payable: 0, paid: 0 },
    };
    const members: FinanceTeamMember[] = ((payeesQ.data ?? []) as FinancePayee[])
      .filter((payee) => data.showArchived || !payee.archived_at)
      .map((payee) => {
        const ownRules = rules.filter((rule) => rule.payee_id === payee.id && !rule.archived_at);
        const rule =
          ownRules.find(
            (item) => item.starts_on <= period && (!item.ends_on || item.ends_on >= period),
          ) ??
          ownRules.find((item) => item.starts_on <= period) ??
          null;
        const ownPayouts = payouts
          .filter((payout) => payout.payee_id === payee.id && !payout.voided_at)
          .map((payout) => ({
            payout,
            transaction: payout.finance_transaction_id
              ? (txMap.get(payout.finance_transaction_id) ?? null)
              : null,
          }));
        for (const { payout, transaction } of ownPayouts) {
          if (!transaction || !["BRL", "EUR"].includes(payout.currency)) continue;
          if (transaction.status === "paid") {
            const currency = transaction.settled_currency === "EUR" ? "EUR" : "BRL";
            totals[currency].paid += transaction.settled_amount_cents ?? payout.amount_cents;
          } else if (transaction.status === "pending") {
            const currency = payout.currency === "EUR" ? "EUR" : "BRL";
            totals[currency].payable += payout.amount_cents;
          }
        }
        return { payee, rule, payouts: ownPayouts };
      });
    return {
      members,
      totals,
      services: servicesQ.data ?? [],
    };
  });

const teamMemberInput = z
  .object({
    payeeId: z.string().uuid().nullable().optional(),
    month: monthStartSchema,
    mode: z.enum(["current", "next_month"]),
    reversePaid: z.boolean().default(false),
    name: z.string().trim().min(2).max(120),
    type: payeeTypeSchema,
    profileId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    ruleType: ruleTypeSchema,
    amountCents: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
    currency: currencySchema.nullable().optional(),
    percentage: z.number().finite().positive().max(100).nullable().optional(),
    includeBrl: z.boolean(),
    includeEur: z.boolean(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    serviceIds: z.array(z.string().uuid()).max(50),
  })
  .superRefine((input, ctx) => {
    if (input.ruleType === "fixed_monthly") {
      if (input.amountCents == null || !input.currency || !input.dayOfMonth)
        ctx.addIssue({ code: "custom", message: "Informe valor, moeda e dia." });
    } else if (
      !input.percentage ||
      (!input.includeBrl && !input.includeEur) ||
      (input.ruleType === "service_percent" && !input.serviceIds.length)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Informe percentual, moeda e serviços quando necessário.",
      });
    }
  });

export const saveFinanceTeamMember = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => teamMemberInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await db.rpc("finance_save_team_member", {
      p_data: data,
      p_actor: context.userId,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const setFinanceTeamMemberState = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z
      .object({
        payeeId: z.string().uuid(),
        month: monthStartSchema,
        action: z.enum(["pause", "reactivate", "remove"]),
        removePending: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db.rpc("finance_set_team_member_state", {
      p_payee_id: data.payeeId,
      p_month: data.month,
      p_action: data.action,
      p_remove_pending: data.removePending,
      p_actor: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createFinancePayee = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => payeeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await db
      .from("finance_payees")
      .insert({
        name: data.name,
        type: data.type,
        profile_id: data.profileId ?? null,
        notes: data.notes ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.payee.create", inserted.id, data);
    return { ok: true, id: inserted.id as string };
  });

export const updateFinancePayee = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => payeeInput.extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db
      .from("finance_payees")
      .update({
        name: data.name,
        type: data.type,
        profile_id: data.profileId ?? null,
        notes: data.notes ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.payee.update", data.id, data);
    return { ok: true };
  });

export const toggleFinancePayee = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => z.object({ id: z.string().uuid(), isActive: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db
      .from("finance_payees")
      .update({ is_active: data.isActive })
      .eq("id", data.id)
      .is("archived_at", null);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.payee.toggle", data.id, data);
    return { ok: true };
  });

export const archiveFinancePayee = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db
      .from("finance_payees")
      .update({
        is_active: false,
        archived_at: new Date().toISOString(),
        archived_by: context.userId,
      })
      .eq("id", data.id)
      .is("archived_at", null);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.payee.archive", data.id, data);
    return { ok: true };
  });

export const searchFinancePayeeProfiles = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => z.object({ query: z.string().trim().min(2).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const query = data.query.replace(/[%_,()]/g, "");
    const [{ data: profiles, error }, auth] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id,full_name,phone")
        .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(20),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    ]);
    if (error) throw new Error(error.message);
    if (auth.error) throw new Error(auth.error.message);
    const emailMap = new Map((auth.data.users ?? []).map((user) => [user.id, user.email ?? null]));
    const ids = new Set((profiles ?? []).map((profile) => profile.id));
    const emailMatches = (auth.data.users ?? [])
      .filter(
        (user) => user.email?.toLowerCase().includes(query.toLowerCase()) && !ids.has(user.id),
      )
      .slice(0, 20);
    const { data: extra } = emailMatches.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id,full_name,phone")
          .in(
            "id",
            emailMatches.map((user) => user.id),
          )
      : { data: [] as typeof profiles };
    return [...(profiles ?? []), ...(extra ?? [])].slice(0, 20).map((profile) => ({
      ...profile,
      email: emailMap.get(profile.id) ?? null,
    }));
  });

export const createFinancePayoutRule = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => ruleInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await db
      .from("finance_payout_rules")
      .insert({ ...rulePatch(data), created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { error: servicesError } = await db.rpc("finance_set_payout_rule_services", {
      p_rule_id: inserted.id,
      p_service_ids: data.ruleType === "service_percent" ? data.serviceIds : [],
    });
    if (servicesError) throw new Error(servicesError.message);
    await audit(context.userId, "finance.payout_rule.create", inserted.id, data);
    return { ok: true, id: inserted.id as string };
  });

export const updateFinancePayoutRule = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => z.object({ id: z.string().uuid(), rule: ruleInput }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db
      .from("finance_payout_rules")
      .update(rulePatch(data.rule))
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    const { error: servicesError } = await db.rpc("finance_set_payout_rule_services", {
      p_rule_id: data.id,
      p_service_ids: data.rule.ruleType === "service_percent" ? data.rule.serviceIds : [],
    });
    if (servicesError) throw new Error(servicesError.message);
    await audit(context.userId, "finance.payout_rule.update", data.id, data.rule);
    return { ok: true };
  });

export const toggleFinancePayoutRule = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => z.object({ id: z.string().uuid(), isActive: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db
      .from("finance_payout_rules")
      .update({ is_active: data.isActive })
      .eq("id", data.id)
      .is("archived_at", null);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.payout_rule.toggle", data.id, data);
    return { ok: true };
  });

export const archiveFinancePayoutRule = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db
      .from("finance_payout_rules")
      .update({
        is_active: false,
        archived_at: new Date().toISOString(),
        archived_by: context.userId,
      })
      .eq("id", data.id)
      .is("archived_at", null);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.payout_rule.archive", data.id, data);
    return { ok: true };
  });

export const endFinancePayoutRule = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => z.object({ id: z.string().uuid(), endsOn: monthStartSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rule, error: fetchError } = await db
      .from("finance_payout_rules")
      .select("starts_on")
      .eq("id", data.id)
      .single();
    if (fetchError || !rule) throw new Error("Regra não encontrada.");
    if (data.endsOn < rule.starts_on) throw new Error("Fim anterior ao início.");
    const { error } = await db
      .from("finance_payout_rules")
      .update({ ends_on: data.endsOn, is_active: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.payout_rule.end", data.id, data);
    return { ok: true };
  });

export const materializeFinancePayout = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z.object({ ruleId: z.string().uuid(), month: monthSchema, currency: currencySchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: payoutId, error } = await db.rpc("finance_materialize_payout", {
      p_rule_id: data.ruleId,
      p_month: `${data.month}-01`,
      p_currency: data.currency,
      p_actor: context.userId,
    });
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.payout.materialize", payoutId, data);
    return { ok: true, id: payoutId as string };
  });
