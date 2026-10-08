import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
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

function withNames<T extends { category_id: string | null }>(
  rows: T[],
  categories: FinanceCategory[],
) {
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  return rows.map((row) => ({
    ...row,
    category_name: row.category_id ? (categoryMap.get(row.category_id) ?? null) : null,
  }));
}

async function financeMeta() {
  const { data: categories, error: categoryErr } = await db
    .from("finance_categories")
    .select("id, name, type, is_system, is_active")
    .eq("is_system", true)
    .eq("is_active", true)
    .order("type")
    .order("name");
  if (categoryErr) throw new Error(categoryErr.message);
  return { categories: (categories ?? []) as FinanceCategory[] };
}

async function validateOperationalCategory(
  categoryId: string | null | undefined,
  type: FinanceType,
) {
  if (!categoryId) return null;
  const { data, error } = await db
    .from("finance_categories")
    .select("name,is_system,is_active,type")
    .eq("id", categoryId)
    .maybeSingle();
  if (
    error ||
    !data?.is_system ||
    !data.is_active ||
    (data.type !== "both" && data.type !== type)
  ) {
    throw new Error("Categoria padrão inativa ou incompatível com o tipo de lançamento.");
  }
  return data as { name: string; is_system: boolean };
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
    const { categories } = await financeMeta();
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
      rows: withNames((rows ?? []) as FinanceTransaction[], categories),
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
  paymentMethod: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(800).nullable().optional(),
});

export const createFinanceTransaction = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => transactionInput.parse(d))
  .handler(async ({ data, context }) => {
    const category = await validateOperationalCategory(data.categoryId, data.type);
    if (category) {
      if (category.name === "Pedidos/Servicos") {
        throw new Error("Receitas de serviços devem ser criadas na origem Pedidos.");
      }
    }
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
        account_id: null,
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
    if ((tx.reference_currency ?? tx.currency) !== data.settledCurrency && !data.fxRate)
      throw new Error("Cotação aplicada obrigatória para conversão.");
    const patch = {
      status: tx.type === "income" ? "received" : "paid",
      settled_amount_cents: cents(data.settledAmount),
      settled_currency: data.settledCurrency,
      paid_at: new Date(`${data.paidAt}T12:00:00.000Z`).toISOString(),
      account_id: null,
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
    const { categories } = await financeMeta();
    const { data, error } = await db
      .from("finance_recurring_rules")
      .select(
        "id, type, description, amount_cents, currency, category_id, account_id, frequency, day_of_month, starts_on, ends_on, is_active, next_run_at, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return withNames((data ?? []) as FinanceRecurringRule[], categories);
  });

export const createFinanceRecurringRule = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((d) => recurringInput.parse(d))
  .handler(async ({ data, context }) => {
    if (data.endsOn && data.endsOn < data.startsOn) throw new Error("Fim anterior ao início.");
    await validateOperationalCategory(data.categoryId, data.type);
    const { data: inserted, error } = await db
      .from("finance_recurring_rules")
      .insert({
        type: data.type,
        description: data.description,
        amount_cents: cents(data.amount),
        currency: data.currency,
        category_id: data.categoryId ?? null,
        account_id: null,
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
    await validateOperationalCategory(data.categoryId, data.type);
    const { error } = await db
      .from("finance_recurring_rules")
      .update({
        type: data.type,
        description: data.description,
        amount_cents: cents(data.amount),
        currency: data.currency,
        category_id: data.categoryId ?? null,
        account_id: null,
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
