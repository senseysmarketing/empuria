import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { FinanceTransaction } from "./financeiro.functions";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
type Currency = "BRL" | "EUR";

export type FinanceCloseCurrencySnapshot = {
  revenue_realized_cents: number;
  operational_expenses_cents: number;
  team_payouts_cents: number;
  recurring_expenses_cents: number;
  projected_payouts_cents: number;
  recognized_expenses_cents: number;
  result_cents: number;
  distributable_profit_cents: number;
  receivable_cents: number;
  payable_cents: number;
  overdue_previous_cents: number;
  rossini_cents: number;
  luana_cents: number;
};

export type FinanceCloseSnapshot = {
  version: number;
  period_month: string;
  BRL: FinanceCloseCurrencySnapshot;
  EUR: FinanceCloseCurrencySnapshot;
};

export type FinanceMonthClosure = {
  id: string;
  period_month: string;
  status: "ready" | "closed";
  preview_snapshot: FinanceCloseSnapshot | null;
  final_snapshot: FinanceCloseSnapshot | null;
  prepared_at: string | null;
  prepared_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
};

export type FinanceDistribution = {
  id: string;
  partner_code: "rossini" | "luana";
  partner_name: string;
  percentage: number;
  currency: Currency;
  amount_cents: number;
  finance_transaction_id: string | null;
  transaction: FinanceTransaction | null;
};

export type FinanceDashboardData = {
  daily: { day: string; currency: Currency; income_cents: number; expense_cents: number }[];
  accounts: {
    account_id: string;
    account_name: string;
    currency: Currency;
    income_cents: number;
    expense_cents: number;
    net_cents: number;
  }[];
  services: {
    service_id: string | null;
    service_title: string;
    currency: Currency;
    quantity: number;
    revenue_cents: number;
  }[];
  expenses: {
    category_id: string | null;
    category_name: string;
    currency: Currency;
    amount_cents: number;
  }[];
  recurring: {
    currency: Currency;
    planned_cents: number;
    paid_cents: number;
    pending_cents: number;
  }[];
  team: {
    currency: Currency;
    projected_cents: number;
    payable_cents: number;
    paid_cents: number;
  }[];
};

const db = supabaseAdmin as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (name: string, args: Record<string, unknown>) => any;
};

export const getFinanceDashboard = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((input) => z.object({ month: monthSchema }).parse(input))
  .handler(async ({ data }) => {
    const period = `${data.month}-01`;
    const { error: ensureError } = await db.rpc("finance_ensure_month", {
      p_month: period,
      p_actor: null,
    });
    if (ensureError) throw new Error(ensureError.message);
    const [closureQ, liveQ, analyticsQ] = await Promise.all([
      db
        .from("finance_month_closures")
        .select(
          "id,period_month,status,preview_snapshot,final_snapshot,prepared_at,prepared_by,closed_at,closed_by",
        )
        .eq("period_month", period)
        .maybeSingle(),
      db.rpc("finance_month_snapshot", { p_month: period, p_include_projection: true }),
      db.rpc("finance_dashboard_month", { p_month: period }),
    ]);
    for (const query of [closureQ, liveQ, analyticsQ]) {
      if (query.error) throw new Error(query.error.message);
    }
    const closure = (closureQ.data ?? null) as FinanceMonthClosure | null;
    const distributionQ = closure
      ? await db
          .from("finance_month_distributions")
          .select(
            "id,partner_code,partner_name,percentage,currency,amount_cents,finance_transaction_id",
          )
          .eq("closure_id", closure.id)
          .order("currency")
          .order("partner_code")
      : { data: [], error: null };
    if (distributionQ.error) throw new Error(distributionQ.error.message);
    const rows = (distributionQ.data ?? []) as Omit<FinanceDistribution, "transaction">[];
    const txIds = rows.map((row) => row.finance_transaction_id).filter(Boolean);
    const txQ = txIds.length
      ? await db.from("finance_transactions").select("*").in("id", txIds)
      : { data: [], error: null };
    if (txQ.error) throw new Error(txQ.error.message);
    const txMap = new Map(((txQ.data ?? []) as FinanceTransaction[]).map((tx) => [tx.id, tx]));
    return {
      status: closure?.status ?? ("open" as "open" | "ready" | "closed"),
      closure,
      snapshot: (closure?.status === "closed"
        ? closure.final_snapshot
        : closure?.status === "ready"
          ? closure.preview_snapshot
          : liveQ.data) as FinanceCloseSnapshot,
      liveSnapshot: liveQ.data as FinanceCloseSnapshot,
      distributions: rows.map((row) => ({
        ...row,
        transaction: row.finance_transaction_id
          ? (txMap.get(row.finance_transaction_id) ?? null)
          : null,
      })) as FinanceDistribution[],
      analytics: analyticsQ.data as FinanceDashboardData,
    };
  });

export const prepareFinanceMonthClose = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((input) => z.object({ month: monthSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: closure, error } = await db.rpc("finance_prepare_month", {
      p_month: `${data.month}-01`,
      p_actor: context.userId,
    });
    if (error) throw new Error(error.message);
    return closure as FinanceMonthClosure;
  });

export const closeFinanceMonth = createServerFn({ method: "POST" })
  .middleware([requireModule("financeiro")])
  .inputValidator((input) => z.object({ month: monthSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: closure, error } = await db.rpc("finance_close_month", {
      p_month: `${data.month}-01`,
      p_actor: context.userId,
    });
    if (error) throw new Error(error.message);
    return closure as FinanceMonthClosure;
  });
