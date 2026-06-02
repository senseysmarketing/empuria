import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Hubla / dynamic tables not always in generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

// ---------- Shared filter schema ----------

export const reportFiltersSchema = z.object({
  period: z
    .enum(["today", "7d", "30d", "month", "last_month", "custom"])
    .default("30d"),
  from: z.string().optional(), // ISO date YYYY-MM-DD (custom period)
  to: z.string().optional(),
  compare: z.enum(["none", "prev_period", "prev_month"]).default("prev_period"),
  currency: z.enum(["BRL", "EUR", "both"]).default("both"),
  origin: z.string().optional(), // pdv / esteira / eventos / clube / manual / hubla
});

export type ReportFilters = z.infer<typeof reportFiltersSchema>;

type Range = { start: string; end: string }; // YYYY-MM-DD inclusive

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db_ = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db_ - da) / 86400000);
}

function resolveRange(f: ReportFilters): Range {
  const today = todayISO();
  switch (f.period) {
    case "today":
      return { start: today, end: today };
    case "7d":
      return { start: addDays(today, -6), end: today };
    case "30d":
      return { start: addDays(today, -29), end: today };
    case "month": {
      const d = new Date();
      const start = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
      return { start, end: today };
    }
    case "last_month": {
      const d = new Date();
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth(); // 0..11; previous month = m-1
      const prevMonthDate = new Date(Date.UTC(y, m - 1, 1));
      const start = `${prevMonthDate.getUTCFullYear()}-${String(prevMonthDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
      // last day of previous month = day 0 of current month
      const lastDay = new Date(Date.UTC(y, m, 0));
      const end = `${lastDay.getUTCFullYear()}-${String(lastDay.getUTCMonth() + 1).padStart(2, "0")}-${String(lastDay.getUTCDate()).padStart(2, "0")}`;
      return { start, end };
    }
    case "custom": {
      const start = f.from ?? addDays(today, -29);
      const end = f.to ?? today;
      return { start, end };
    }
  }
}

function previousRange(current: Range, mode: "prev_period" | "prev_month"): Range {
  if (mode === "prev_month") {
    const startDate = new Date(current.start + "T00:00:00Z");
    const prev = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() - 1, 1));
    const start = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0));
    const end = `${lastDay.getUTCFullYear()}-${String(lastDay.getUTCMonth() + 1).padStart(2, "0")}-${String(lastDay.getUTCDate()).padStart(2, "0")}`;
    return { start, end };
  }
  // prev_period: equal-length window immediately before
  const length = diffDays(current.start, current.end) + 1;
  const end = addDays(current.start, -1);
  const start = addDays(end, -(length - 1));
  return { start, end };
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ---------- Finance aggregation (source of truth) ----------

type FinTx = {
  type: "income" | "expense";
  status: string;
  amount_cents: number;
  currency: string;
  due_date: string;
  paid_at: string | null;
  source_module: string;
  category_id: string | null;
};

async function fetchFinanceRange(range: Range, filters: ReportFilters): Promise<FinTx[]> {
  let q = db
    .from("finance_transactions")
    .select(
      "type,status,amount_cents,currency,due_date,paid_at,source_module,category_id",
    )
    .gte("due_date", range.start)
    .lte("due_date", range.end);
  if (filters.currency !== "both") q = q.eq("currency", filters.currency);
  if (filters.origin) q = q.eq("source_module", filters.origin);
  const { data, error } = await q.limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as FinTx[];
}

type FinanceTotals = {
  received: number; // cents
  receivable: number;
  expensesPaid: number;
  expensesPending: number;
  balance: number; // received - expensesPaid
  ordersPaid: number;
  ordersPending: number;
  ticketAvg: number;
};

function summarizeFinance(txs: FinTx[]): FinanceTotals {
  let received = 0,
    receivable = 0,
    expensesPaid = 0,
    expensesPending = 0,
    ordersPaid = 0,
    ordersPending = 0;
  for (const t of txs) {
    if (t.status === "canceled") continue;
    const realized = t.status === "received" || t.status === "paid";
    if (t.type === "income") {
      if (t.status === "received") {
        received += t.amount_cents;
        ordersPaid++;
      } else if (["planned", "pending", "overdue"].includes(t.status)) {
        receivable += t.amount_cents;
        ordersPending++;
      }
    } else {
      if (t.status === "paid") expensesPaid += t.amount_cents;
      else if (["planned", "pending", "overdue"].includes(t.status))
        expensesPending += t.amount_cents;
    }
    void realized;
  }
  const balance = received - expensesPaid;
  const ticketAvg = ordersPaid > 0 ? Math.round(received / ordersPaid) : 0;
  return {
    received,
    receivable,
    expensesPaid,
    expensesPending,
    balance,
    ordersPaid,
    ordersPending,
    ticketAvg,
  };
}

function dailySeries(txs: FinTx[], range: Range) {
  const buckets: Record<string, number> = {};
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) buckets[d] = 0;
  for (const t of txs) {
    if (t.type !== "income" || t.status !== "received") continue;
    if (buckets[t.due_date] !== undefined) buckets[t.due_date] += t.amount_cents / 100;
  }
  return Object.entries(buckets).map(([date, value]) => ({ date, value }));
}

function groupByOrigin(txs: FinTx[]) {
  const map = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== "income" || t.status !== "received") continue;
    map.set(t.source_module, (map.get(t.source_module) ?? 0) + t.amount_cents);
  }
  return Array.from(map, ([label, amount_cents]) => ({ label, amount_cents })).sort(
    (a, b) => b.amount_cents - a.amount_cents,
  );
}

async function groupExpensesByCategory(txs: FinTx[]) {
  const map = new Map<string | null, number>();
  for (const t of txs) {
    if (t.type !== "expense" || t.status === "canceled") continue;
    map.set(t.category_id, (map.get(t.category_id) ?? 0) + t.amount_cents);
  }
  const ids = Array.from(map.keys()).filter((x): x is string => !!x);
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await db.from("finance_categories").select("id,name").in("id", ids);
    for (const c of data ?? []) names.set(c.id, c.name);
  }
  return Array.from(map, ([id, amount_cents]) => ({
    label: id ? names.get(id) ?? "Sem categoria" : "Sem categoria",
    amount_cents,
  })).sort((a, b) => b.amount_cents - a.amount_cents);
}

// ---------- Counts (leads, club, events) ----------

async function countLeads(range: Range): Promise<number> {
  const { count } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", range.start + "T00:00:00")
    .lte("created_at", range.end + "T23:59:59");
  return count ?? 0;
}

async function countNewClubMembers(range: Range): Promise<number> {
  // profiles flagged as club member updated within range
  const { count } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_club_member", true)
    .gte("updated_at", range.start + "T00:00:00")
    .lte("updated_at", range.end + "T23:59:59");
  return count ?? 0;
}

async function countEventTicketsSold(range: Range): Promise<number> {
  const { count } = await db
    .from("event_tickets")
    .select("id", { count: "exact", head: true })
    .gte("created_at", range.start + "T00:00:00")
    .lte("created_at", range.end + "T23:59:59");
  return count ?? 0;
}

async function countPdvSales(range: Range): Promise<number> {
  const { count } = await db
    .from("pdv_sales")
    .select("id", { count: "exact", head: true })
    .gte("created_at", range.start + "T00:00:00")
    .lte("created_at", range.end + "T23:59:59");
  return count ?? 0;
}

// ---------- VISÃO GERAL ----------

export const getReportsOverview = createServerFn({ method: "POST" })
  .middleware([requireModule("relatorios")])
  .inputValidator((d) => reportFiltersSchema.parse(d))
  .handler(async ({ data }) => {
    const range = resolveRange(data);
    const compareRange =
      data.compare === "none" ? null : previousRange(range, data.compare);

    const [
      currentTxs,
      prevTxs,
      leadsCurr,
      leadsPrev,
      clubCurr,
      eventsCurr,
      pdvCurr,
    ] = await Promise.all([
      fetchFinanceRange(range, data),
      compareRange ? fetchFinanceRange(compareRange, data) : Promise.resolve([] as FinTx[]),
      countLeads(range),
      compareRange ? countLeads(compareRange) : Promise.resolve(0),
      countNewClubMembers(range),
      countEventTicketsSold(range),
      countPdvSales(range),
    ]);

    const current = summarizeFinance(currentTxs);
    const previous = summarizeFinance(prevTxs);

    const series = dailySeries(currentTxs, range);
    const byOrigin = groupByOrigin(currentTxs);

    // Alerts
    const alerts: { type: string; message: string; severity: "warn" | "danger" }[] = [];
    const deltaReceived = pctDelta(current.received, previous.received);
    if (compareRange && deltaReceived !== null && deltaReceived < -15) {
      alerts.push({
        type: "revenue_drop",
        message: `Receita caiu ${Math.abs(deltaReceived).toFixed(0)}% vs período anterior.`,
        severity: "danger",
      });
    }
    if (current.expensesPending > 0) {
      alerts.push({
        type: "pending_payments",
        message: `Há ${(current.expensesPending / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em despesas pendentes.`,
        severity: "warn",
      });
    }
    if (current.receivable > 0) {
      alerts.push({
        type: "pending_receivables",
        message: `Há ${(current.receivable / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} a receber.`,
        severity: "warn",
      });
    }

    return {
      range,
      compareRange,
      cards: {
        received: { current: current.received, previous: previous.received, deltaPct: deltaReceived },
        receivable: { current: current.receivable, previous: previous.receivable, deltaPct: pctDelta(current.receivable, previous.receivable) },
        expenses: { current: current.expensesPaid, previous: previous.expensesPaid, deltaPct: pctDelta(current.expensesPaid, previous.expensesPaid) },
        balance: { current: current.balance, previous: previous.balance, deltaPct: pctDelta(current.balance, previous.balance) },
        ordersPaid: { current: current.ordersPaid, previous: previous.ordersPaid, deltaPct: pctDelta(current.ordersPaid, previous.ordersPaid) },
        pdvSales: { current: pdvCurr, previous: 0, deltaPct: null },
        newLeads: { current: leadsCurr, previous: leadsPrev, deltaPct: pctDelta(leadsCurr, leadsPrev) },
        newClubMembers: { current: clubCurr, previous: 0, deltaPct: null },
        eventTickets: { current: eventsCurr, previous: 0, deltaPct: null },
      },
      series, // [{date, value}]
      byOrigin, // [{label, amount_cents}]
      topSources: byOrigin.slice(0, 5),
      alerts,
    };
  });

// ---------- VENDAS & FINANCEIRO ----------

export const getReportsVendas = createServerFn({ method: "POST" })
  .middleware([requireModule("relatorios")])
  .inputValidator((d) => reportFiltersSchema.parse(d))
  .handler(async ({ data }) => {
    const range = resolveRange(data);
    const compareRange =
      data.compare === "none" ? null : previousRange(range, data.compare);

    const [currentTxs, prevTxs] = await Promise.all([
      fetchFinanceRange(range, data),
      compareRange ? fetchFinanceRange(compareRange, data) : Promise.resolve([] as FinTx[]),
    ]);
    const current = summarizeFinance(currentTxs);
    const previous = summarizeFinance(prevTxs);

    const series = dailySeries(currentTxs, range);
    const byOrigin = groupByOrigin(currentTxs);
    const expenseByCategory = await groupExpensesByCategory(currentTxs);

    // Ticket médio por origem
    const ticketByOrigin = new Map<string, { sum: number; count: number }>();
    for (const t of currentTxs) {
      if (t.type !== "income" || t.status !== "received") continue;
      const e = ticketByOrigin.get(t.source_module) ?? { sum: 0, count: 0 };
      e.sum += t.amount_cents;
      e.count += 1;
      ticketByOrigin.set(t.source_module, e);
    }
    const ticketAvgByOrigin = Array.from(ticketByOrigin, ([label, v]) => ({
      label,
      amount_cents: v.count > 0 ? Math.round(v.sum / v.count) : 0,
    })).sort((a, b) => b.amount_cents - a.amount_cents);

    // Pendentes por status
    const pendingByStatus = new Map<string, number>();
    for (const t of currentTxs) {
      if (t.type !== "income") continue;
      if (!["planned", "pending", "overdue"].includes(t.status)) continue;
      pendingByStatus.set(t.status, (pendingByStatus.get(t.status) ?? 0) + t.amount_cents);
    }
    const pendingStatusRows = Array.from(pendingByStatus, ([label, amount_cents]) => ({
      label,
      amount_cents,
    }));

    // Conversão de pagamento = recebidos / (recebidos + receivable em incomes)
    const totalIncomeNonCanceled = current.received + current.receivable;
    const paymentConversionPct =
      totalIncomeNonCanceled > 0 ? (current.received / totalIncomeNonCanceled) * 100 : 0;

    return {
      range,
      compareRange,
      cards: {
        received: { current: current.received, previous: previous.received, deltaPct: pctDelta(current.received, previous.received) },
        receivable: { current: current.receivable, previous: previous.receivable, deltaPct: pctDelta(current.receivable, previous.receivable) },
        expenses: { current: current.expensesPaid, previous: previous.expensesPaid, deltaPct: pctDelta(current.expensesPaid, previous.expensesPaid) },
        balance: { current: current.balance, previous: previous.balance, deltaPct: pctDelta(current.balance, previous.balance) },
        ordersPaid: { current: current.ordersPaid, previous: previous.ordersPaid, deltaPct: pctDelta(current.ordersPaid, previous.ordersPaid) },
        ordersPending: { current: current.ordersPending, previous: previous.ordersPending, deltaPct: pctDelta(current.ordersPending, previous.ordersPending) },
        ticketAvg: { current: current.ticketAvg, previous: previous.ticketAvg, deltaPct: pctDelta(current.ticketAvg, previous.ticketAvg) },
        paymentConversionPct: { current: paymentConversionPct, previous: 0, deltaPct: null },
      },
      series,
      byOrigin,
      ticketAvgByOrigin,
      pendingByStatus: pendingStatusRows,
      expenseByCategory,
    };
  });
