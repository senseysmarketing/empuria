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
  totals: Record<
    Currency,
    {
      received: number;
      receivable: number;
      paid: number;
      payable: number;
      realizedBalance: number;
    }
  >;
  daily: { day: string; currency: Currency; income_cents: number; expense_cents: number }[];
  services: {
    service_id: string | null;
    service_title: string;
    sales_count: number;
    paid_count: number;
    pending_count: number;
    currencies: Record<
      Currency,
      {
        sold_cents: number;
        received_cents: number;
        receivable_cents: number;
      }
    >;
  }[];
  expenses: {
    category_id: string | null;
    category_name: string;
    currency: Currency;
    amount_cents: number;
  }[];
  recurring: {
    currency: Currency;
    paid_cents: number;
    pending_cents: number;
  }[];
  team: {
    currency: Currency;
    payable_cents: number;
    paid_cents: number;
  }[];
  pdv: {
    currency: Currency;
    received_cents: number;
    pending_cents: number;
  }[];
  snapshot: FinanceCloseSnapshot;
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
    const { data: dashboard, error } = await db.rpc("finance_dashboard_month", {
      p_month: period,
    });
    if (error) throw new Error(error.message);
    return dashboard as FinanceDashboardData;
  });
