import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

type FinanceType = "income" | "expense";
type FinanceStatus = "planned" | "pending" | "received" | "paid" | "overdue" | "canceled";
type FinanceFrequency = "monthly" | "weekly" | "yearly";

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
};

export type FinanceTransaction = {
  id: string;
  type: FinanceType;
  status: FinanceStatus;
  description: string;
  amount_cents: number;
  currency: string;
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
  frequency: FinanceFrequency;
  day_of_month: number;
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
};

const moneySchema = z.number().finite().min(0).max(99_999_999);
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

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
        .select("id, name, type, currency, is_active")
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
    const { start, end } = monthRange(data.month);
    const { categories, accounts } = await financeMeta();
    const { data: rows, error } = await db
      .from("finance_transactions")
      .select(
        "id, type, status, description, amount_cents, currency, due_date, paid_at, category_id, account_id, payment_method, source_module, source_id, is_automatic, notes, created_at",
      )
      .gte("due_date", start)
      .lte("due_date", end)
      .order("due_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const txs = withNames((rows ?? []) as FinanceTransaction[], categories, accounts);
    const today = new Date().toISOString().slice(0, 10);
    const totals = {
      received: 0,
      receivable: 0,
      paid: 0,
      payable: 0,
      overdue: 0,
      realizedBalance: 0,
      projectedBalance: 0,
    };
    const byOrigin = new Map<string, number>();
    const expenseByCategory = new Map<string, number>();

    for (const tx of txs) {
      const signed = tx.type === "income" ? tx.amount_cents : -tx.amount_cents;
      const realized = tx.status === "received" || tx.status === "paid";
      if (tx.status !== "canceled") totals.projectedBalance += signed;
      if (realized) totals.realizedBalance += signed;
      if (tx.type === "income" && tx.status === "received") totals.received += tx.amount_cents;
      if (tx.type === "income" && ["planned", "pending", "overdue"].includes(tx.status)) {
        totals.receivable += tx.amount_cents;
      }
      if (tx.type === "expense" && tx.status === "paid") totals.paid += tx.amount_cents;
      if (tx.type === "expense" && ["planned", "pending", "overdue"].includes(tx.status)) {
        totals.payable += tx.amount_cents;
      }
      if (tx.status !== "canceled" && tx.due_date < today && !realized)
        totals.overdue += tx.amount_cents;
      if (tx.status !== "canceled")
        byOrigin.set(tx.source_module, (byOrigin.get(tx.source_module) ?? 0) + signed);
      if (tx.type === "expense" && tx.status !== "canceled") {
        const key = tx.category_name ?? "Sem categoria";
        expenseByCategory.set(key, (expenseByCategory.get(key) ?? 0) + tx.amount_cents);
      }
    }

    return {
      totals,
      byOrigin: Array.from(byOrigin, ([label, amount_cents]) => ({ label, amount_cents })),
      expenseByCategory: Array.from(expenseByCategory, ([label, amount_cents]) => ({
        label,
        amount_cents,
      })),
      pending: txs
        .filter((tx) => tx.status !== "canceled" && !["received", "paid"].includes(tx.status))
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
    const { start, end } = monthRange(data.month);
    const { categories, accounts } = await financeMeta();
    let query = db
      .from("finance_transactions")
      .select(
        "id, type, status, description, amount_cents, currency, due_date, paid_at, category_id, account_id, payment_method, source_module, source_id, is_automatic, notes, created_at",
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
        status: z.enum(["planned", "pending", "received", "paid", "canceled"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: current, error: fetchErr } = await db
      .from("finance_transactions")
      .select("id, type, status, is_automatic, source_module")
      .eq("id", data.id)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);
    if (current.is_automatic) {
      throw new Error("Lancamentos automaticos devem ser corrigidos no modulo de origem.");
    }
    const finalStatus =
      current.type === "income" && data.status === "paid"
        ? "received"
        : current.type === "expense" && data.status === "received"
          ? "paid"
          : data.status;
    const paidAt =
      finalStatus === "received" || finalStatus === "paid" ? new Date().toISOString() : null;
    const { error } = await db
      .from("finance_transactions")
      .update({ status: finalStatus, paid_at: paidAt })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.transaction.status", data.id, {
      old_status: current.status,
      new_status: finalStatus,
    });
    return { ok: true };
  });

const recurringInput = z.object({
  type: z.enum(["income", "expense"]),
  description: z.string().trim().min(3).max(180),
  amount: moneySchema,
  currency: z.enum(["BRL", "EUR", "USD"]).default("BRL"),
  categoryId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  frequency: z.enum(["monthly", "weekly", "yearly"]).default("monthly"),
  dayOfMonth: z.number().int().min(1).max(31).default(1),
});

export const listFinanceRecurringRules = createServerFn({ method: "GET" })
  .middleware([requireModule("financeiro")])
  .handler(async () => {
    const { categories, accounts } = await financeMeta();
    const { data, error } = await db
      .from("finance_recurring_rules")
      .select(
        "id, type, description, amount_cents, currency, category_id, account_id, frequency, day_of_month, is_active, next_run_at, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return withNames((data ?? []) as FinanceRecurringRule[], categories, accounts);
  });

export const createFinanceRecurringRule = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => recurringInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await db
      .from("finance_recurring_rules")
      .insert({
        type: data.type,
        description: data.description,
        amount_cents: cents(data.amount),
        currency: data.currency,
        category_id: data.categoryId ?? null,
        account_id: data.accountId ?? null,
        frequency: data.frequency,
        day_of_month: data.dayOfMonth,
        is_active: true,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(context.userId, "finance.recurring.create", inserted.id, inserted as Json);
    return { ok: true, id: inserted.id as string };
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

export const generateFinanceRecurringForMonth = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => z.object({ month: monthSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const [year, month] = data.month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const { data: rules, error } = await db
      .from("finance_recurring_rules")
      .select("*")
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    const today = new Date().toISOString().slice(0, 10);
    const rows = ((rules ?? []) as FinanceRecurringRule[]).map((rule) => {
      const day = Math.min(rule.day_of_month, lastDay);
      const dueDate = `${data.month}-${String(day).padStart(2, "0")}`;
      return {
        type: rule.type,
        status: dueDate > today ? "planned" : "pending",
        description: rule.description,
        amount_cents: rule.amount_cents,
        currency: rule.currency,
        due_date: dueDate,
        category_id: rule.category_id,
        account_id: rule.account_id,
        source_module: `recurring:${data.month}`,
        source_id: rule.id,
        is_automatic: true,
        notes: `Gerado por recorrencia ${rule.frequency}`,
        created_by: context.userId,
      };
    });
    if (!rows.length) return { ok: true, inserted: 0 };
    const { error: insertErr } = await db
      .from("finance_transactions")
      .upsert(rows, { onConflict: "source_module,source_id", ignoreDuplicates: true });
    if (insertErr) throw new Error(insertErr.message);
    await audit(context.userId, "finance.recurring.generate", null, {
      month: data.month,
      count: rows.length,
    });
    return { ok: true, inserted: rows.length };
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
    const { error } = await db
      .from("finance_accounts")
      .insert({ name: data.name, type: data.type, currency: data.currency, is_active: true });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
