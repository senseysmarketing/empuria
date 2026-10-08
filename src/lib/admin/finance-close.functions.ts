import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
    const [snapshotQ, analyticsQ] = await Promise.all([
      db.rpc("finance_month_snapshot", { p_month: period, p_include_projection: true }),
      db.rpc("finance_dashboard_month", { p_month: period }),
    ]);
    if (snapshotQ.error) throw new Error(snapshotQ.error.message);
    if (analyticsQ.error) throw new Error(analyticsQ.error.message);
    return {
      snapshot: snapshotQ.data as FinanceCloseSnapshot,
      analytics: analyticsQ.data as FinanceDashboardData,
    };
  });
