import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { normalizeFinanceAccountName } from "@/lib/finance/accounts";
import { confirmOrderPaymentInternal } from "./esteira.functions";

type FinanceType = "income" | "expense";
type FinanceStatus = "planned" | "pending" | "received" | "paid" | "overdue" | "canceled";

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

async function financeMeta() {
  const [{ data: categories, error: categoryErr }, { data: accounts, error: accountErr }] =
    await Promise.all([
      db
        .from("finance_categories")
        .select("id, name, type, is_system, is_active")
        .eq("is_active", true)
        .order("type")
        .order("name"),
      db
        .from("finance_accounts")
        .select("id, name, type, currency, is_active, normalized_name")
        .eq("is_active", true)
        .order("name"),
    ]);
  if (categoryErr) throw new Error(categoryErr.message);
  if (accountErr) throw new Error(accountErr.message);
  return {
    categories: (categories ?? []) as FinanceCategory[],
    accounts: (accounts ?? []) as FinanceAccount[],
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

export const getFinanceOverview = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => z.object({ month: monthSchema }).parse(d))
  .handler(async ({ data }) => {
    await ensureFinanceMonth(data.month);
    const { start, end } = monthRange(data.month);
    const { categories, accounts } = await financeMeta();
    const startPaidAt = `${start}T00:00:00.000Z`;
    const endPaidAt = `${end}T23:59:59.999Z`;
    const { data: rows, error } = await db
      .from("finance_transactions")
      .select(
        "id, type, status, description, amount_cents, currency, settled_amount_cents, settled_currency, reference_amount_cents, reference_currency, fx_reference_rate, fx_rate, fx_source, fx_date, due_date, paid_at, category_id, account_id, payment_method, source_module, source_id, is_automatic, notes, created_at",
      )
      .or(
        `and(due_date.gte.${start},due_date.lte.${end}),and(paid_at.gte.${startPaidAt},paid_at.lte.${endPaidAt})`,
      )
      .order("due_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const { data: previousRows, error: previousError } = await db
      .from("finance_transactions")
      .select(
        "id, type, status, description, amount_cents, currency, settled_amount_cents, settled_currency, reference_amount_cents, reference_currency, fx_reference_rate, fx_rate, fx_source, fx_date, due_date, paid_at, category_id, account_id, payment_method, source_module, source_id, is_automatic, notes, created_at",
      )
      .in("status", ["planned", "pending", "overdue"])
      .lt("due_date", start)
      .order("due_date", { ascending: true })
      .limit(500);
    if (previousError) throw new Error(previousError.message);

    const txs = withNames((rows ?? []) as FinanceTransaction[], categories, accounts);
    const today = new Date().toISOString().slice(0, 10);
    const emptyTotals = () => ({
      received: 0,
      receivable: 0,
      paid: 0,
      payable: 0,
      overdue: 0,
      realizedBalance: 0,
      projectedBalance: 0,
    });
    const totals = { BRL: emptyTotals(), EUR: emptyTotals() };

    for (const tx of txs) {
      const realized = tx.status === "received" || tx.status === "paid";
      const dueInMonth = tx.due_date >= start && tx.due_date <= end;
      const paidInMonth = !!tx.paid_at && tx.paid_at >= startPaidAt && tx.paid_at <= endPaidAt;
      if (
        realized &&
        paidInMonth &&
        (tx.settled_currency === "BRL" || tx.settled_currency === "EUR")
      ) {
        const bucket = totals[tx.settled_currency];
        const amount = tx.settled_amount_cents ?? 0;
        const signed = tx.type === "income" ? amount : -amount;
        bucket.realizedBalance += signed;
        if (tx.type === "income") bucket.received += amount;
        else bucket.paid += amount;
      }
      if (
        !realized &&
        tx.status !== "canceled" &&
        dueInMonth &&
        (tx.currency === "BRL" || tx.currency === "EUR")
      ) {
        const bucket = totals[tx.currency];
        const signed = tx.type === "income" ? tx.amount_cents : -tx.amount_cents;
        bucket.projectedBalance += signed;
        if (tx.type === "income") bucket.receivable += tx.amount_cents;
        else bucket.payable += tx.amount_cents;
        if (tx.due_date < today) bucket.overdue += tx.amount_cents;
      }
    }

    for (const currency of ["BRL", "EUR"] as const) {
      totals[currency].projectedBalance += totals[currency].realizedBalance;
    }

    return {
      totals,
      overduePrevious: {
        BRL: withNames(
          ((previousRows ?? []) as FinanceTransaction[]).filter((row) => row.currency === "BRL"),
          categories,
          accounts,
        ),
        EUR: withNames(
          ((previousRows ?? []) as FinanceTransaction[]).filter((row) => row.currency === "EUR"),
          categories,
          accounts,
        ),
      },
      pending: txs
        .filter(
          (tx) =>
            tx.due_date >= start &&
            tx.due_date <= end &&
            tx.status !== "canceled" &&
            !["received", "paid"].includes(tx.status),
        )
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 8),
      recent: txs.slice(0, 8),
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
        status: z
          .enum(["all", "planned", "pending", "received", "paid", "overdue", "canceled"])
          .default("all"),
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
    const { categories, accounts } = await financeMeta();
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
  status: z.enum(["planned", "pending", "received", "paid"]).default("pending"),
  categoryId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  paymentMethod: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(800).nullable().optional(),
});

export const createFinanceTransaction = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => transactionInput.parse(d))
  .handler(async ({ data, context }) => {
    const finalStatus =
      data.type === "income" && data.status === "paid"
        ? "received"
        : data.type === "expense" && data.status === "received"
          ? "paid"
          : data.status;
    const paidAt =
      finalStatus === "received" || finalStatus === "paid" ? new Date().toISOString() : null;
    const { data: inserted, error } = await db
      .from("finance_transactions")
      .insert({
        type: data.type,
        status: finalStatus,
        description: data.description,
        amount_cents: cents(data.amount),
        currency: data.currency,
        due_date: data.dueDate,
        paid_at: paidAt,
        settled_amount_cents: paidAt ? cents(data.amount) : null,
        settled_currency: paidAt ? data.currency : null,
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
    await audit(context.userId, "finance.transaction.create", inserted.id, inserted as Json);
    return { ok: true, id: inserted.id as string };
  });

export const updateFinanceTransactionStatus = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.literal("canceled"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: current, error: fetchErr } = await db
      .from("finance_transactions")
      .select(
        "id, type, status, is_automatic, source_module, settled_amount_cents, settled_currency",
      )
      .eq("id", data.id)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);
    if (current.is_automatic) {
      throw new Error("Lancamentos automaticos devem ser corrigidos no modulo de origem.");
    }
    if (
      ["received", "paid"].includes(current.status) ||
      current.settled_amount_cents != null ||
      current.settled_currency != null
    ) {
      throw new Error("Lancamento realizado nao pode ser cancelado por esta acao.");
    }
    const { error } = await db
      .from("finance_transactions")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.transaction.status", data.id, {
      old_status: current.status,
      new_status: data.status,
    });
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
    const { categories, accounts } = await financeMeta();
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
  .handler(async ({ data }) => {
    const { error } = await db
      .from("finance_categories")
      .insert({ name: data.name, type: data.type, is_system: false, is_active: true });
    if (error) throw new Error(error.message);
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
  .handler(async ({ data }) => {
    const normalizedName = normalizeFinanceAccountName(data.name);
    const { data: existing } = await db
      .from("finance_accounts")
      .select("id")
      .eq("currency", data.currency)
      .eq("normalized_name", normalizedName)
      .maybeSingle();
    if (existing) return { ok: true, id: existing.id as string, reused: true };
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
    return { ok: true, id: inserted.id as string, reused: false };
  });
