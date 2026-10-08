import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { normalizeFinanceAccountName } from "@/lib/finance/accounts";
import { confirmOrderPaymentInternal } from "./esteira.functions";

type FinanceType = "income" | "expense";
type FinanceStatus = "pending" | "received" | "paid" | "canceled";

export type FinanceCategory = {
  id: string;
  name: string;
  type: "income" | "expense" | "both";
  is_system: boolean;
  is_active: boolean;
};

export type FinanceAccount = {
  id: string;
  name: string;
  type: string;
  currency: string;
  is_active: boolean;
  normalized_name?: string;
  has_history?: boolean;
};

export type FinanceTransaction = {
  id: string;
  type: FinanceType;
  status: FinanceStatus;
  description: string;
  amount_cents: number;
  currency: string;
  settled_amount_cents: number | null;
  settled_currency: string | null;
  reference_amount_cents: number | null;
  reference_currency: string | null;
  fx_reference_rate: number | null;
  fx_rate: number | null;
  fx_source: string | null;
  fx_date: string | null;
  due_date: string;
  paid_at: string | null;
  category_id: string | null;
  account_id: string | null;
  payment_method: string | null;
  source_module: string;
  source_id: string | null;
  is_automatic: boolean;
  notes: string | null;
  created_at: string;
  category_name?: string | null;
  account_name?: string | null;
};

export type FinanceRecurringRule = {
  id: string;
  type: FinanceType;
  description: string;
  amount_cents: number;
  currency: string;
  category_id: string | null;
  account_id: string | null;
  frequency: "monthly";
  day_of_month: number;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
  next_run_at: string | null;
  created_at: string;
  category_name?: string | null;
  account_name?: string | null;
};

const db = supabaseAdmin as unknown as {
  // Tables are introduced by this migration before Supabase types are regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (name: string, args?: Record<string, unknown>) => any;
};

const moneySchema = z.number().finite().min(0).max(99_999_999);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

function monthRange(month: string) {
  const [year, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, m - 1, 1));
  const end = new Date(Date.UTC(year, m, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function cents(value: number) {
  return Math.round(value * 100);
}

async function ensureFinanceMonth(month: string, actorId?: string) {
  const { error } = await db.rpc("finance_ensure_month", {
    p_month: `${month}-01`,
    p_actor: actorId ?? null,
  });
  if (error) throw new Error(error.message);
}

async function validateRuleAccount(accountId: string | null | undefined, currency: string) {
  if (!accountId) return;
  const { data: account, error } = await db
    .from("finance_accounts")
    .select("currency,is_active")
    .eq("id", accountId)
    .maybeSingle();
  if (error || !account?.is_active || account.currency !== currency) {
    throw new Error("Selecione uma conta ativa na moeda da recorrência.");
  }
}

function withNames<T extends { category_id: string | null; account_id: string | null }>(
  rows: T[],
  categories: FinanceCategory[],
  accounts: FinanceAccount[],
) {
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
  return rows.map((row) => ({
    ...row,
    category_name: row.category_id ? (categoryMap.get(row.category_id) ?? null) : null,
    account_name: row.account_id ? (accountMap.get(row.account_id) ?? null) : null,
  }));
}

async function financeMeta(includeArchived = false) {
  const [{ data: categories, error: categoryErr }, { data: accounts, error: accountErr }] =
    await Promise.all([
      db
        .from("finance_categories")
        .select("id, name, type, is_system, is_active")
        .order("type")
        .order("name"),
      db
        .from("finance_accounts")
        .select("id, name, type, currency, is_active, normalized_name")
        .order("name"),
    ]);
  if (categoryErr) throw new Error(categoryErr.message);
  if (accountErr) throw new Error(accountErr.message);
  return {
    categories: ((categories ?? []) as FinanceCategory[]).filter(
      (row) => includeArchived || row.is_active,
    ),
    accounts: ((accounts ?? []) as FinanceAccount[]).filter(
      (row) => includeArchived || row.is_active,
    ),
  };
}

async function audit(
  actorId: string | undefined,
  action: string,
  entityId: string | null,
  data: Json,
) {
  await supabaseAdmin.from("audit_logs").insert({
    actor_id: actorId ?? null,
    action,
    module: "financeiro",
    entity_type: "finance_transaction",
    entity_id: entityId,
    new_data: data,
  });
}

export const listFinanceMeta = createServerFn({ method: "GET" })
  .middleware([requireModule("financeiro")])
  .handler(async () => financeMeta());

export const listFinanceSettings = createServerFn({ method: "GET" })
  .middleware([requireModule("financeiro")])
  .handler(async () => {
    const meta = await financeMeta(true);
    const [transactions, orders, recurring] = await Promise.all([
      db.from("finance_transactions").select("account_id").not("account_id", "is", null),
      db.from("orders").select("payment_account_id").not("payment_account_id", "is", null),
      db.from("finance_recurring_rules").select("account_id").not("account_id", "is", null),
    ]);
    for (const q of [transactions, orders, recurring])
      if (q.error) throw new Error(q.error.message);
    const used = new Set([
      ...(transactions.data ?? []).map((row: { account_id: string }) => row.account_id),
      ...(orders.data ?? []).map((row: { payment_account_id: string }) => row.payment_account_id),
      ...(recurring.data ?? []).map((row: { account_id: string }) => row.account_id),
    ]);
    return {
      ...meta,
      accounts: meta.accounts.map((account) => ({ ...account, has_history: used.has(account.id) })),
    };
  });

export const listFinanceTransactions = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z
      .object({
        month: monthSchema,
        search: z.string().trim().max(120).optional(),
        type: z.enum(["all", "income", "expense"]).default("all"),
        status: z.enum(["all", "pending", "received", "paid", "canceled"]).default("all"),
        sourceModule: z.string().trim().max(60).optional(),
        categoryId: z.string().uuid().optional(),
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(10).max(100).default(25),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await ensureFinanceMonth(data.month);
    const { start, end } = monthRange(data.month);
    const { categories, accounts } = await financeMeta(true);
    let query = db
      .from("finance_transactions")
      .select(
        "id, type, status, description, amount_cents, currency, settled_amount_cents, settled_currency, reference_amount_cents, reference_currency, fx_reference_rate, fx_rate, fx_source, fx_date, due_date, paid_at, category_id, account_id, payment_method, source_module, source_id, is_automatic, notes, created_at",
        { count: "exact" },
      )
      .gte("due_date", start)
      .lte("due_date", end)
      .order("due_date", { ascending: false })
      .range(data.page * data.pageSize, data.page * data.pageSize + data.pageSize - 1);

    if (data.type !== "all") query = query.eq("type", data.type);
    if (data.status !== "all") query = query.eq("status", data.status);
    else query = query.neq("status", "canceled");
    if (data.categoryId) query = query.eq("category_id", data.categoryId);
    if (data.sourceModule) query = query.eq("source_module", data.sourceModule);
    if (data.search) query = query.ilike("description", `%${data.search.replace(/[%_]/g, "")}%`);

    const { data: rows, error, count } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: withNames((rows ?? []) as FinanceTransaction[], categories, accounts),
      count: count ?? 0,
    };
  });

const transactionInput = z.object({
  type: z.enum(["income", "expense"]),
  description: z.string().trim().min(3).max(180),
  amount: moneySchema,
  currency: z.enum(["BRL", "EUR", "USD"]).default("BRL"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.literal("pending").default("pending"),
  categoryId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  paymentMethod: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(800).nullable().optional(),
});

export const createFinanceTransaction = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => transactionInput.parse(d))
  .handler(async ({ data, context }) => {
    if (data.categoryId) {
      const { data: category, error: categoryError } = await db
        .from("finance_categories")
        .select("name,is_system,is_active,type")
        .eq("id", data.categoryId)
        .single();
      if (categoryError) throw new Error(categoryError.message);
      if (!category.is_active || (category.type !== "both" && category.type !== data.type)) {
        throw new Error("Categoria inativa ou incompatível com o tipo de lançamento.");
      }
      if (category.is_system && category.name === "Pedidos/Servicos") {
        throw new Error("Receitas de serviços devem ser criadas na origem Pedidos.");
      }
    }
    await validateRuleAccount(data.accountId, data.currency);
    const { data: inserted, error } = await db
      .from("finance_transactions")
      .insert({
        type: data.type,
        status: data.status,
        description: data.description,
        amount_cents: cents(data.amount),
        currency: data.currency,
        due_date: data.dueDate,
        paid_at: null,
        settled_amount_cents: null,
        settled_currency: null,
        category_id: data.categoryId ?? null,
        account_id: data.accountId ?? null,
        payment_method: data.paymentMethod ?? null,
        source_module: "manual",
        is_automatic: false,
        notes: data.notes ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.transaction.create", inserted.id, {
      id: inserted.id,
      source_module: "manual",
    });
    return { ok: true, id: inserted.id as string };
  });

export const deleteFinancePendingTransaction = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        reason: z.string().trim().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db.rpc("finance_delete_pending_transaction", {
      p_id: data.id,
      p_actor: context.userId,
      p_reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reverseFinanceSettlement = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db.rpc("finance_reverse_settlement", {
      p_id: data.id,
      p_actor: context.userId,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const settleInput = z.object({
  id: z.string().uuid(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  settledAmount: moneySchema,
  settledCurrency: z.enum(["BRL", "EUR"]),
  accountId: z.string().uuid(),
  fxReferenceRate: z.number().positive().nullable().optional(),
  fxReferenceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  fxRate: z.number().positive().nullable().optional(),
  fxSource: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const settleFinanceTransaction = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((input) => settleInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: tx, error: txError } = await db
      .from("finance_transactions")
      .select("*")
      .eq("id", data.id)
      .single();
    if (txError || !tx) throw new Error(txError?.message ?? "Lançamento não encontrado.");
    if (tx.source_module === "pdv") throw new Error("Vendas PDV já são baixadas na origem.");
    if (tx.source_module === "orders" && tx.source_id) {
      return confirmOrderPaymentInternal(
        {
          orderId: tx.source_id,
          paidAt: data.paidAt,
          settledAmountCents: cents(data.settledAmount),
          settledCurrency: data.settledCurrency,
          paymentAccountId: data.accountId,
          fxReferenceRate: data.fxReferenceRate,
          fxReferenceDate: data.fxReferenceDate,
          fxRate: data.fxRate,
          fxSource: data.fxSource,
          notes: data.notes,
        },
        context.userId,
      );
    }
    if (["received", "paid", "canceled"].includes(tx.status))
      throw new Error("Este lançamento não está pendente de baixa.");
    if (
      tx.is_automatic &&
      tx.source_module !== "team_payout" &&
      tx.source_module !== "partner_distribution" &&
      !tx.source_module.startsWith("recurring:")
    )
      throw new Error("Este lançamento automático deve ser corrigido no módulo de origem.");
    const { data: account } = await db
      .from("finance_accounts")
      .select("currency,is_active")
      .eq("id", data.accountId)
      .single();
    if (!account?.is_active || account.currency !== data.settledCurrency)
      throw new Error("Selecione uma conta ativa na moeda realizada.");
    const patch = {
      status: tx.type === "income" ? "received" : "paid",
      settled_amount_cents: cents(data.settledAmount),
      settled_currency: data.settledCurrency,
      paid_at: new Date(`${data.paidAt}T12:00:00.000Z`).toISOString(),
      account_id: data.accountId,
      fx_reference_rate: data.fxReferenceRate ?? null,
      fx_rate: data.fxRate ?? null,
      fx_source: data.fxSource ?? null,
      fx_date: data.fxReferenceDate ?? null,
      notes: data.notes ?? tx.notes,
    };
    const { error } = await db.from("finance_transactions").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.transaction.settle", data.id, {
      old: tx,
      new: patch,
    } as Json);
    return { ok: true };
  });

const recurringInput = z.object({
  type: z.enum(["income", "expense"]),
  description: z.string().trim().min(3).max(180),
  amount: moneySchema,
  currency: z.enum(["BRL", "EUR"]),
  categoryId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).default(1),
  startsOn: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/),
  endsOn: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/)
    .nullable()
    .optional(),
});

export const listFinanceRecurringRules = createServerFn({ method: "GET" })
  .middleware([requireModule("financeiro")])
  .handler(async () => {
    const { categories, accounts } = await financeMeta(true);
    const { data, error } = await db
      .from("finance_recurring_rules")
      .select(
        "id, type, description, amount_cents, currency, category_id, account_id, frequency, day_of_month, starts_on, ends_on, is_active, next_run_at, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return withNames((data ?? []) as FinanceRecurringRule[], categories, accounts);
  });

export const createFinanceRecurringRule = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => recurringInput.parse(d))
  .handler(async ({ data, context }) => {
    if (data.endsOn && data.endsOn < data.startsOn) throw new Error("Fim anterior ao início.");
    await validateRuleAccount(data.accountId, data.currency);
    const { data: inserted, error } = await db
      .from("finance_recurring_rules")
      .insert({
        type: data.type,
        description: data.description,
        amount_cents: cents(data.amount),
        currency: data.currency,
        category_id: data.categoryId ?? null,
        account_id: data.accountId ?? null,
        frequency: "monthly",
        day_of_month: data.dayOfMonth,
        starts_on: data.startsOn,
        ends_on: data.endsOn ?? null,
        is_active: true,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.recurring.create", inserted.id, inserted as Json);
    return { ok: true, id: inserted.id as string };
  });

export const updateFinanceRecurringRule = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => recurringInput.extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.endsOn && data.endsOn < data.startsOn) throw new Error("Fim anterior ao início.");
    await validateRuleAccount(data.accountId, data.currency);
    const { error } = await db
      .from("finance_recurring_rules")
      .update({
        type: data.type,
        description: data.description,
        amount_cents: cents(data.amount),
        currency: data.currency,
        category_id: data.categoryId ?? null,
        account_id: data.accountId ?? null,
        day_of_month: data.dayOfMonth,
        starts_on: data.startsOn,
        ends_on: data.endsOn ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.recurring.update", data.id, data as Json);
    return { ok: true };
  });

export const endFinanceRecurringRule = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z
      .object({ id: z.string().uuid(), endsOn: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rule, error: fetchError } = await db
      .from("finance_recurring_rules")
      .select("starts_on")
      .eq("id", data.id)
      .single();
    if (fetchError || !rule) throw new Error("Recorrência não encontrada.");
    if (data.endsOn < rule.starts_on) throw new Error("Fim anterior ao início.");
    const { error } = await db
      .from("finance_recurring_rules")
      .update({ ends_on: data.endsOn, is_active: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.recurring.end", data.id, { ends_on: data.endsOn });
    return { ok: true };
  });

export const toggleFinanceRecurringRule = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => z.object({ id: z.string().uuid(), isActive: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db
      .from("finance_recurring_rules")
      .update({ is_active: data.isActive })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.recurring.toggle", data.id, { is_active: data.isActive });
    return { ok: true };
  });

export const createFinanceCategory = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().trim().min(2).max(80),
        type: z.enum(["income", "expense", "both"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await db
      .from("finance_categories")
      .insert({ name: data.name, type: data.type, is_system: false, is_active: true })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.category.create", inserted.id, data);
    return { ok: true };
  });

export const createFinanceAccount = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().trim().min(2).max(80),
        type: z.enum(["cash", "bank", "card", "gateway", "other"]),
        currency: z.enum(["BRL", "EUR", "USD"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const normalizedName = normalizeFinanceAccountName(data.name);
    const { data: existing } = await db
      .from("finance_accounts")
      .select("id")
      .eq("currency", data.currency)
      .eq("normalized_name", normalizedName)
      .maybeSingle();
    if (existing) {
      const { error: reviveError } = await db
        .from("finance_accounts")
        .update({ is_active: true })
        .eq("id", existing.id);
      if (reviveError) throw new Error(reviveError.message);
      await audit(context.userId, "finance.account.reactivate", existing.id, { name: data.name });
      return { ok: true, id: existing.id as string, reused: true };
    }
    const { data: inserted, error } = await db
      .from("finance_accounts")
      .insert({
        name: data.name.trim(),
        normalized_name: normalizedName,
        type: data.type,
        currency: data.currency,
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.account.create", inserted.id, data);
    return { ok: true, id: inserted.id as string, reused: false };
  });

async function accountReferenceCount(id: string) {
  const [tx, orders, recurring] = await Promise.all([
    db
      .from("finance_transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", id),
    db.from("orders").select("id", { count: "exact", head: true }).eq("payment_account_id", id),
    db
      .from("finance_recurring_rules")
      .select("id", { count: "exact", head: true })
      .eq("account_id", id),
  ]);
  for (const q of [tx, orders, recurring]) if (q.error) throw new Error(q.error.message);
  return (tx.count ?? 0) + (orders.count ?? 0) + (recurring.count ?? 0);
}

export const manageFinanceAccount = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["edit", "archive", "reactivate", "remove"]),
        name: z.string().trim().min(2).max(80).optional(),
        type: z.enum(["cash", "bank", "card", "gateway", "other"]).optional(),
        currency: z.enum(["BRL", "EUR", "USD"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: current, error: readError } = await db
      .from("finance_accounts")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (readError || !current) throw new Error("Conta não encontrada.");
    const references = await accountReferenceCount(data.id);
    if (data.action === "edit") {
      if (!data.name || !data.type || !data.currency)
        throw new Error("Preencha nome, tipo e moeda.");
      if (references && data.currency !== current.currency)
        throw new Error("Conta com histórico não pode mudar de moeda.");
      const { error } = await db
        .from("finance_accounts")
        .update({
          name: data.name,
          normalized_name: normalizeFinanceAccountName(data.name),
          type: data.type,
          currency: data.currency,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else if (data.action === "remove" && references === 0) {
      const { error } = await db.from("finance_accounts").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db
        .from("finance_accounts")
        .update({ is_active: data.action === "reactivate" })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    await audit(context.userId, `finance.account.${data.action}`, data.id, {
      previous: current,
      references,
      input: data,
    } as Json);
    return { ok: true, archivedInstead: data.action === "remove" && references > 0 };
  });

async function categoryReferenceCount(id: string) {
  const [tx, recurring] = await Promise.all([
    db
      .from("finance_transactions")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id),
    db
      .from("finance_recurring_rules")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id),
  ]);
  for (const q of [tx, recurring]) if (q.error) throw new Error(q.error.message);
  return (tx.count ?? 0) + (recurring.count ?? 0);
}

export const manageFinanceCategory = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["edit", "archive", "reactivate", "remove"]),
        name: z.string().trim().min(2).max(80).optional(),
        type: z.enum(["income", "expense", "both"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: current, error: readError } = await db
      .from("finance_categories")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (readError || !current) throw new Error("Categoria não encontrada.");
    if (current.is_system) throw new Error("Categoria de sistema não pode ser alterada.");
    const references = await categoryReferenceCount(data.id);
    if (data.action === "edit") {
      if (!data.name || !data.type) throw new Error("Preencha nome e tipo.");
      const { error } = await db
        .from("finance_categories")
        .update({ name: data.name, type: data.type })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else if (data.action === "remove" && references === 0) {
      const { error } = await db.from("finance_categories").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db
        .from("finance_categories")
        .update({ is_active: data.action === "reactivate" })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    await audit(context.userId, `finance.category.${data.action}`, data.id, {
      previous: current,
      references,
      input: data,
    } as Json);
    return { ok: true, archivedInstead: data.action === "remove" && references > 0 };
  });
