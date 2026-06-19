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

    // Extras: leads funnel + low stock + unreplied + inactive subs
    const [funnelRows, lowStockRows, unrepliedRows, inactiveSubsCount] = await Promise.all([
      db.from("leads").select("pipeline_stage,status").limit(5000),
      db
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("track_stock", true)
        .lte("stock_quantity", 5),
      db
        .from("crm_inbox_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "received"),
      db
        .from("club_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("access_status", "inactive"),
    ]);
    const STAGES = ["novo", "qualificado", "analise", "fechado", "perdido"];
    const STAGE_LBL: Record<string, string> = {
      novo: "Novo",
      qualificado: "Qualificado",
      analise: "Em análise",
      fechado: "Fechado",
      perdido: "Perdido",
    };
    const funnelAgg = new Map<string, number>();
    for (const r of (funnelRows.data ?? []) as { pipeline_stage: string; status: string }[]) {
      if (r.status === "won" || r.status === "lost") continue;
      funnelAgg.set(r.pipeline_stage, (funnelAgg.get(r.pipeline_stage) ?? 0) + 1);
    }
    const leadsFunnel = STAGES.map((s) => ({
      label: STAGE_LBL[s] ?? s,
      count: funnelAgg.get(s) ?? 0,
    }));
    const lowStockCount = lowStockRows.count ?? 0;
    const unrepliedCount = unrepliedRows.count ?? 0;
    const inactiveSubs = inactiveSubsCount.count ?? 0;

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
        message: `Há ${(current.expensesPending / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })} em despesas pendentes.`,
        severity: "warn",
      });
    }
    if (current.receivable > 0) {
      alerts.push({
        type: "pending_receivables",
        message: `Há ${(current.receivable / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })} a receber.`,
        severity: "warn",
      });
    }
    if (lowStockCount > 0) {
      alerts.push({
        type: "low_stock",
        message: `${lowStockCount} produto(s) com estoque ≤ 5 unidades.`,
        severity: "warn",
      });
    }
    if (unrepliedCount > 0) {
      alerts.push({
        type: "unreplied_leads",
        message: `${unrepliedCount} mensagem(ns) de WhatsApp sem resposta no inbox CRM.`,
        severity: "warn",
      });
    }
    if (inactiveSubs > 0) {
      alerts.push({
        type: "inactive_subs",
        message: `${inactiveSubs} assinatura(s) do Clube inativas/inadimplentes.`,
        severity: "warn",
      });
    }

    const totalRevenue = current.received + current.receivable;
    const totalRevenuePrev = previous.received + previous.receivable;

    return {
      range,
      compareRange,
      cards: {
        totalRevenue: { current: totalRevenue, previous: totalRevenuePrev, deltaPct: pctDelta(totalRevenue, totalRevenuePrev) },
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
      series,
      byOrigin,
      topSources: byOrigin.slice(0, 5),
      leadsFunnel,
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

// ---------- PDV & ESTOQUE ----------

type PdvSaleLite = {
  id: string;
  cashier_id: string;
  payment_method: string;
  total_eur_cents: number;
  total_brl_cents: number;
  discount_eur_cents: number;
  discount_brl_cents: number;
  status: string;
  closed_at: string;
};

type PdvSaleItemLite = {
  sale_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  qty: number;
  total_eur_cents: number;
  total_brl_cents: number;
};

const PAYMENT_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  cartao: "Cartão",
  pix: "PIX",
  wise: "Wise",
  mbway: "MB WAY",
  multibanco: "Multibanco",
  transferencia: "Transferência",
  cortesia: "Cortesia",
};

const VOIDED_STATUSES = ["anulada", "voided", "cancelada"];

export const getReportsPdv = createServerFn({ method: "POST" })
  .middleware([requireModule("relatorios")])
  .inputValidator((d) => reportFiltersSchema.parse(d))
  .handler(async ({ data }) => {
    const range = resolveRange(data);
    const compareRange =
      data.compare === "none" ? null : previousRange(range, data.compare);

    const fetchSales = async (r: Range): Promise<PdvSaleLite[]> => {
      const { data: rows, error } = await db
        .from("pdv_sales")
        .select(
          "id,cashier_id,payment_method,total_eur_cents,total_brl_cents,discount_eur_cents,discount_brl_cents,status,closed_at",
        )
        .gte("closed_at", r.start + "T00:00:00")
        .lte("closed_at", r.end + "T23:59:59")
        .limit(5000);
      if (error) throw new Error(error.message);
      return (rows ?? []) as PdvSaleLite[];
    };

    const [currentSales, prevSales] = await Promise.all([
      fetchSales(range),
      compareRange ? fetchSales(compareRange) : Promise.resolve([] as PdvSaleLite[]),
    ]);

    const summarize = (sales: PdvSaleLite[]) => {
      let revenueEur = 0,
        revenueBrl = 0,
        voided = 0,
        completed = 0,
        discountsEur = 0,
        discountsBrl = 0;
      for (const s of sales) {
        if (VOIDED_STATUSES.includes(s.status)) {
          voided++;
          continue;
        }
        revenueEur += s.total_eur_cents;
        revenueBrl += s.total_brl_cents ?? 0;
        discountsEur += s.discount_eur_cents ?? 0;
        discountsBrl += s.discount_brl_cents ?? 0;
        completed++;
      }
      const ticketEur = completed > 0 ? Math.round(revenueEur / completed) : 0;
      const ticketBrl = completed > 0 ? Math.round(revenueBrl / completed) : 0;
      return { revenueEur, revenueBrl, voided, completed, ticketEur, ticketBrl, discountsEur, discountsBrl };
    };
    const curr = summarize(currentSales);
    const prev = summarize(prevSales);

    // Histograma por hora do dia
    const hourly = new Array(24).fill(0).map((_, h) => ({
      hour: h,
      revenue: 0,
      revenueBrl: 0,
      sales: 0,
    }));
    for (const s of currentSales) {
      if (VOIDED_STATUSES.includes(s.status)) continue;
      const h = new Date(s.closed_at).getHours();
      hourly[h].revenue += s.total_eur_cents;
      hourly[h].revenueBrl += s.total_brl_cents ?? 0;
      hourly[h].sales += 1;
    }

    const completedIds = currentSales
      .filter((s) => !VOIDED_STATUSES.includes(s.status))
      .map((s) => s.id);

    let items: PdvSaleItemLite[] = [];
    if (completedIds.length) {
      const { data: itemRows, error: itemErr } = await db
        .from("pdv_sale_items")
        .select("sale_id,product_id,product_name_snapshot,qty,total_eur_cents,total_brl_cents")
        .in("sale_id", completedIds)
        .limit(20000);
      if (itemErr) throw new Error(itemErr.message);
      items = (itemRows ?? []) as PdvSaleItemLite[];
    }

    const productMap = new Map<
      string,
      { name: string; qty: number; revenue: number; revenueBrl: number }
    >();
    let totalItemsSold = 0;
    for (const it of items) {
      totalItemsSold += it.qty;
      const key = it.product_id ?? it.product_name_snapshot;
      const e = productMap.get(key) ?? {
        name: it.product_name_snapshot,
        qty: 0,
        revenue: 0,
        revenueBrl: 0,
      };
      e.qty += it.qty;
      e.revenue += it.total_eur_cents;
      e.revenueBrl += it.total_brl_cents ?? 0;
      productMap.set(key, e);
    }
    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    const cashierAgg = new Map<string, { revenue: number; revenueBrl: number; count: number }>();
    for (const s of currentSales) {
      if (VOIDED_STATUSES.includes(s.status)) continue;
      const e = cashierAgg.get(s.cashier_id) ?? { revenue: 0, revenueBrl: 0, count: 0 };
      e.revenue += s.total_eur_cents;
      e.revenueBrl += s.total_brl_cents ?? 0;
      e.count += 1;
      cashierAgg.set(s.cashier_id, e);
    }
    const cashierIds = Array.from(cashierAgg.keys()).filter(Boolean);
    const profileMap = new Map<string, string>();
    if (cashierIds.length) {
      const { data: profs } = await db
        .from("profiles")
        .select("id,full_name")
        .in("id", cashierIds);
      for (const p of profs ?? []) profileMap.set(p.id, p.full_name ?? "—");
    }
    const topCashiers = Array.from(cashierAgg, ([id, v]) => ({
      label: profileMap.get(id) ?? "—",
      revenue: v.revenue,
      revenueBrl: v.revenueBrl,
      count: v.count,
    }))
      .sort((a, b) => b.revenueBrl - a.revenueBrl)
      .slice(0, 10);

    const paymentAgg = new Map<string, { revenue: number; revenueBrl: number; count: number }>();
    for (const s of currentSales) {
      if (VOIDED_STATUSES.includes(s.status)) continue;
      const e = paymentAgg.get(s.payment_method) ?? { revenue: 0, revenueBrl: 0, count: 0 };
      e.revenue += s.total_eur_cents;
      e.revenueBrl += s.total_brl_cents ?? 0;
      e.count += 1;
      paymentAgg.set(s.payment_method, e);
    }
    const paymentMethods = Array.from(paymentAgg, ([method, v]) => ({
      label: PAYMENT_LABEL[method] ?? method,
      revenue: v.revenue,
      revenueBrl: v.revenueBrl,
      count: v.count,
    })).sort((a, b) => b.revenueBrl - a.revenueBrl);

    const { data: lowStockRows } = await db
      .from("products")
      .select("id,name,stock_quantity,track_stock")
      .eq("track_stock", true)
      .lte("stock_quantity", 5)
      .order("stock_quantity", { ascending: true })
      .limit(20);
    const lowStock = (lowStockRows ?? []).map(
      (p: { id: string; name: string; stock_quantity: number }) => ({
        id: p.id,
        name: p.name,
        stock_quantity: p.stock_quantity,
      }),
    );

    return {
      range,
      compareRange,
      cards: {
        revenue: {
          current: curr.revenueBrl,
          previous: prev.revenueBrl,
          deltaPct: pctDelta(curr.revenueBrl, prev.revenueBrl),
          currentEur: curr.revenueEur,
          previousEur: prev.revenueEur,
        },
        salesCount: {
          current: curr.completed,
          previous: prev.completed,
          deltaPct: pctDelta(curr.completed, prev.completed),
        },
        ticket: {
          current: curr.ticketBrl,
          previous: prev.ticketBrl,
          deltaPct: pctDelta(curr.ticketBrl, prev.ticketBrl),
          currentEur: curr.ticketEur,
          previousEur: prev.ticketEur,
        },
        itemsSold: { current: totalItemsSold, previous: 0, deltaPct: null },
        voided: {
          current: curr.voided,
          previous: prev.voided,
          deltaPct: pctDelta(curr.voided, prev.voided),
        },
        discounts: {
          current: curr.discountsBrl,
          previous: prev.discountsBrl,
          deltaPct: pctDelta(curr.discountsBrl, prev.discountsBrl),
          currentEur: curr.discountsEur,
          previousEur: prev.discountsEur,
        },
      },
      topProducts,
      topCashiers,
      paymentMethods,
      lowStock,
      hourly,
    };
  });

// ---------- SERVIÇOS & AGENDA ----------

type ApptLite = {
  id: string;
  service_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
};

const APPT_STATUS_LABEL: Record<string, string> = {
  confirmado: "Confirmado",
  pendente: "Pendente",
  concluido: "Concluído",
  cancelado: "Cancelado",
  no_show: "Não compareceu",
};

const WEEKDAY = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export const getReportsServicos = createServerFn({ method: "POST" })
  .middleware([requireModule("relatorios")])
  .inputValidator((d) => reportFiltersSchema.parse(d))
  .handler(async ({ data }) => {
    const range = resolveRange(data);
    const compareRange =
      data.compare === "none" ? null : previousRange(range, data.compare);

    const fetchAppts = async (r: Range): Promise<ApptLite[]> => {
      const { data: rows, error } = await db
        .from("appointments")
        .select("id,service_id,status,starts_at,ends_at")
        .gte("starts_at", r.start + "T00:00:00")
        .lte("starts_at", r.end + "T23:59:59")
        .limit(5000);
      if (error) throw new Error(error.message);
      return (rows ?? []) as ApptLite[];
    };

    const [current, previous] = await Promise.all([
      fetchAppts(range),
      compareRange ? fetchAppts(compareRange) : Promise.resolve([] as ApptLite[]),
    ]);

    const summarize = (appts: ApptLite[]) => {
      let confirmed = 0,
        completed = 0,
        canceled = 0,
        noShow = 0;
      for (const a of appts) {
        if (a.status === "confirmado") confirmed++;
        else if (a.status === "concluido") completed++;
        else if (a.status === "cancelado") canceled++;
        else if (a.status === "no_show") noShow++;
      }
      const total = appts.length;
      const noShowRate = total > 0 ? (noShow / total) * 100 : 0;
      const cancelRate = total > 0 ? (canceled / total) * 100 : 0;
      return { total, confirmed, completed, canceled, noShow, noShowRate, cancelRate };
    };
    const curr = summarize(current);
    const prev = summarize(previous);

    const serviceIds = Array.from(new Set(current.map((a) => a.service_id))).filter(Boolean);
    const serviceMap = new Map<string, { title: string; category: string | null }>();
    if (serviceIds.length) {
      const { data: services } = await db
        .from("services")
        .select("id,title,category")
        .in("id", serviceIds);
      for (const s of services ?? [])
        serviceMap.set(s.id, { title: s.title, category: s.category });
    }

    const serviceAgg = new Map<string, number>();
    const categoryAgg = new Map<string, number>();
    const weekdayAgg = new Map<number, number>();
    for (const a of current) {
      if (a.status === "cancelado") continue;
      serviceAgg.set(a.service_id, (serviceAgg.get(a.service_id) ?? 0) + 1);
      const cat = serviceMap.get(a.service_id)?.category ?? "Sem categoria";
      categoryAgg.set(cat, (categoryAgg.get(cat) ?? 0) + 1);
      const day = new Date(a.starts_at).getDay();
      weekdayAgg.set(day, (weekdayAgg.get(day) ?? 0) + 1);
    }
    const topServices = Array.from(serviceAgg, ([id, count]) => ({
      label: serviceMap.get(id)?.title ?? "—",
      count,
    }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const byCategory = Array.from(categoryAgg, ([label, count]) => ({ label, count })).sort(
      (a, b) => b.count - a.count,
    );

    const byWeekday = WEEKDAY.map((label, idx) => ({
      label,
      count: weekdayAgg.get(idx) ?? 0,
    }));

    const statusAgg = new Map<string, number>();
    for (const a of current) {
      statusAgg.set(a.status, (statusAgg.get(a.status) ?? 0) + 1);
    }
    const byStatus = Array.from(statusAgg, ([k, count]) => ({
      label: APPT_STATUS_LABEL[k] ?? k,
      count,
    })).sort((a, b) => b.count - a.count);

    // Slots / ocupação
    const { data: slotRows } = await db
      .from("availability_slots")
      .select("id,service_id,capacity,booked,is_active,starts_at")
      .eq("is_active", true)
      .gte("starts_at", range.start + "T00:00:00")
      .lte("starts_at", range.end + "T23:59:59")
      .limit(10000);
    const slots = (slotRows ?? []) as Array<{
      capacity: number;
      booked: number;
    }>;
    let totalCapacity = 0,
      totalBooked = 0,
      slotsOpen = 0,
      slotsFull = 0;
    for (const s of slots) {
      totalCapacity += s.capacity;
      totalBooked += s.booked;
      if (s.booked >= s.capacity) slotsFull += 1;
      else slotsOpen += 1;
    }
    const occupancyRate = totalCapacity > 0 ? (totalBooked / totalCapacity) * 100 : 0;

    return {
      range,
      compareRange,
      cards: {
        total: { current: curr.total, previous: prev.total, deltaPct: pctDelta(curr.total, prev.total) },
        confirmed: { current: curr.confirmed, previous: prev.confirmed, deltaPct: pctDelta(curr.confirmed, prev.confirmed) },
        completed: { current: curr.completed, previous: prev.completed, deltaPct: pctDelta(curr.completed, prev.completed) },
        canceled: { current: curr.canceled, previous: prev.canceled, deltaPct: pctDelta(curr.canceled, prev.canceled) },
        noShow: { current: curr.noShow, previous: prev.noShow, deltaPct: pctDelta(curr.noShow, prev.noShow) },
        noShowRate: { current: curr.noShowRate, previous: prev.noShowRate, deltaPct: null },
        cancelRate: { current: curr.cancelRate, previous: prev.cancelRate, deltaPct: null },
        occupancyRate: { current: occupancyRate, previous: 0, deltaPct: null },
        slotsOpen: { current: slotsOpen, previous: 0, deltaPct: null },
        slotsFull: { current: slotsFull, previous: 0, deltaPct: null },
      },
      topServices,
      byCategory,
      byWeekday,
      byStatus,
    };
  });

// ---------- EVENTOS ----------

type EventLite = {
  id: string;
  title: string;
  starts_at: string;
  is_published: boolean;
};

type TierLite = {
  id: string;
  event_id: string;
  name: string;
  price_cents: number;
  capacity: number | null;
  sold: number;
};

type TicketLite = {
  id: string;
  event_id: string;
  tier_id: string;
  status: string;
  checked_in_at: string | null;
  created_at: string;
};

export const getReportsEventos = createServerFn({ method: "POST" })
  .middleware([requireModule("relatorios")])
  .inputValidator((d) => reportFiltersSchema.parse(d))
  .handler(async ({ data }) => {
    const range = resolveRange(data);
    const compareRange =
      data.compare === "none" ? null : previousRange(range, data.compare);

    // Eventos cujo período de venda toca a janela: starts_at >= range.start
    // OU starts_at NULL — analisamos eventos relevantes ao período + tickets criados no período
    const { data: eventRows, error: evErr } = await db
      .from("events")
      .select("id,title,starts_at,is_published")
      .order("starts_at", { ascending: false })
      .limit(500);
    if (evErr) throw new Error(evErr.message);
    const events = (eventRows ?? []) as EventLite[];
    const eventIds = events.map((e) => e.id);

    const { data: tierRows } = eventIds.length
      ? await db
          .from("event_ticket_tiers")
          .select("id,event_id,name,price_cents,capacity,sold")
          .in("event_id", eventIds)
          .limit(2000)
      : { data: [] };
    const tiers = (tierRows ?? []) as TierLite[];
    const tiersByEvent = new Map<string, TierLite[]>();
    const tierById = new Map<string, TierLite>();
    for (const t of tiers) {
      tierById.set(t.id, t);
      const arr = tiersByEvent.get(t.event_id) ?? [];
      arr.push(t);
      tiersByEvent.set(t.event_id, arr);
    }

    const fetchTickets = async (r: Range): Promise<TicketLite[]> => {
      const { data: rows, error } = await db
        .from("event_tickets")
        .select("id,event_id,tier_id,status,checked_in_at,created_at")
        .gte("created_at", r.start + "T00:00:00")
        .lte("created_at", r.end + "T23:59:59")
        .limit(20000);
      if (error) throw new Error(error.message);
      return (rows ?? []) as TicketLite[];
    };

    const [curTickets, prevTickets] = await Promise.all([
      fetchTickets(range),
      compareRange ? fetchTickets(compareRange) : Promise.resolve([] as TicketLite[]),
    ]);

    const summarize = (tks: TicketLite[]) => {
      let valid = 0,
        canceled = 0,
        used = 0,
        revenueCents = 0;
      for (const t of tks) {
        if (t.status === "cancelled" || t.status === "canceled") {
          canceled++;
          continue;
        }
        valid++;
        if (t.checked_in_at) used++;
        const tier = tierById.get(t.tier_id);
        if (tier) revenueCents += tier.price_cents ?? 0;
      }
      const attendanceRate = valid > 0 ? (used / valid) * 100 : 0;
      return { total: tks.length, valid, canceled, used, revenueCents, attendanceRate };
    };
    const curr = summarize(curTickets);
    const prev = summarize(prevTickets);

    // Receita por evento + ingressos por evento (currentRange)
    const perEvent = new Map<string, { sold: number; revenue: number; checkedIn: number }>();
    for (const t of curTickets) {
      if (t.status === "cancelled" || t.status === "canceled") continue;
      const tier = tierById.get(t.tier_id);
      const e = perEvent.get(t.event_id) ?? { sold: 0, revenue: 0, checkedIn: 0 };
      e.sold += 1;
      e.revenue += tier?.price_cents ?? 0;
      if (t.checked_in_at) e.checkedIn += 1;
      perEvent.set(t.event_id, e);
    }
    const topEventsByRevenue = Array.from(perEvent, ([id, v]) => ({
      id,
      label: events.find((e) => e.id === id)?.title ?? "—",
      revenue: v.revenue,
      sold: v.sold,
      checkedIn: v.checkedIn,
    }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const topEventsBySold = [...topEventsByRevenue].sort((a, b) => b.sold - a.sold).slice(0, 10);

    // Receita por lote (top 15 — agregado entre eventos do período)
    const perTier = new Map<string, number>();
    for (const t of curTickets) {
      if (t.status === "cancelled" || t.status === "canceled") continue;
      const tier = tierById.get(t.tier_id);
      perTier.set(t.tier_id, (perTier.get(t.tier_id) ?? 0) + (tier?.price_cents ?? 0));
    }
    const tierRevenue = Array.from(perTier, ([id, revenue]) => {
      const tier = tierById.get(id);
      const event = events.find((e) => e.id === tier?.event_id);
      return {
        id,
        label: `${tier?.name ?? "—"} · ${event?.title ?? ""}`,
        revenue,
      };
    })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);

    // Capacidade vendida média (eventos no período)
    let capacityFilled = 0;
    let capacityCount = 0;
    const lowDemand: { id: string; title: string; pct: number; sold: number; capacity: number }[] = [];
    const today = todayISO();
    for (const ev of events) {
      const evTiers = tiersByEvent.get(ev.id) ?? [];
      const totalCap = evTiers.reduce((sum, t) => sum + (t.capacity ?? 0), 0);
      const totalSold = evTiers.reduce((sum, t) => sum + (t.sold ?? 0), 0);
      if (totalCap > 0) {
        const pct = (totalSold / totalCap) * 100;
        capacityFilled += pct;
        capacityCount++;
        // Baixa procura: evento futuro publicado com < 30% vendido
        if (
          ev.is_published &&
          ev.starts_at >= today &&
          pct < 30 &&
          totalCap >= 10
        ) {
          lowDemand.push({
            id: ev.id,
            title: ev.title,
            pct,
            sold: totalSold,
            capacity: totalCap,
          });
        }
      }
    }
    const avgCapacityPct = capacityCount > 0 ? capacityFilled / capacityCount : 0;

    const publishedCount = events.filter((e) => e.is_published).length;

    return {
      range,
      compareRange,
      cards: {
        publishedEvents: { current: publishedCount, previous: 0, deltaPct: null },
        ticketsSold: { current: curr.valid, previous: prev.valid, deltaPct: pctDelta(curr.valid, prev.valid) },
        revenue: { current: curr.revenueCents, previous: prev.revenueCents, deltaPct: pctDelta(curr.revenueCents, prev.revenueCents) },
        checkedIn: { current: curr.used, previous: prev.used, deltaPct: pctDelta(curr.used, prev.used) },
        attendanceRate: { current: curr.attendanceRate, previous: prev.attendanceRate, deltaPct: null },
        canceled: { current: curr.canceled, previous: prev.canceled, deltaPct: pctDelta(curr.canceled, prev.canceled) },
        avgCapacityPct: { current: avgCapacityPct, previous: 0, deltaPct: null },
      },
      topEventsByRevenue,
      topEventsBySold,
      tierRevenue,
      lowDemand: lowDemand.sort((a, b) => a.pct - b.pct).slice(0, 10),
      ticketStatus: [
        { label: "Válidos", count: curr.valid },
        { label: "Check-in", count: curr.used },
        { label: "Cancelados", count: curr.canceled },
      ],
    };
  });

// ---------- CLUBE DO IMIGRANTE ----------

type ClubSubLite = {
  id: string;
  user_id: string | null;
  status: string;
  access_status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  last_payment_at: string | null;
  next_billing_at: string | null;
  canceled_at: string | null;
  created_at: string;
};

type IntegrationEventLite = {
  id: string;
  provider: string;
  event_type: string;
  status: string;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
};

export const getReportsClube = createServerFn({ method: "POST" })
  .middleware([requireModule("relatorios")])
  .inputValidator((d) => reportFiltersSchema.parse(d))
  .handler(async ({ data }) => {
    const range = resolveRange(data);
    const compareRange =
      data.compare === "none" ? null : previousRange(range, data.compare);

    // Snapshot total (sem filtro de período) — para KPIs absolutos
    const { data: allSubs } = await db
      .from("club_subscriptions")
      .select(
        "id,user_id,status,access_status,current_period_start,current_period_end,last_payment_at,next_billing_at,canceled_at,created_at",
      )
      .limit(10000);
    const subs = (allSubs ?? []) as ClubSubLite[];

    const isActive = (s: ClubSubLite) =>
      s.access_status === "active" || s.status === "active";
    const isInactive = (s: ClubSubLite) =>
      s.access_status === "inactive" && s.status !== "canceled";

    const activeNow = subs.filter(isActive).length;
    const inactiveNow = subs.filter(isInactive).length;

    const inWindow = (iso: string | null) =>
      !!iso && iso.slice(0, 10) >= range.start && iso.slice(0, 10) <= range.end;
    const inPrev = (iso: string | null) =>
      !!compareRange &&
      !!iso &&
      iso.slice(0, 10) >= compareRange.start &&
      iso.slice(0, 10) <= compareRange.end;

    const newSubsCurr = subs.filter((s) => inWindow(s.created_at)).length;
    const newSubsPrev = subs.filter((s) => inPrev(s.created_at)).length;
    const canceledCurr = subs.filter((s) => inWindow(s.canceled_at)).length;
    const canceledPrev = subs.filter((s) => inPrev(s.canceled_at)).length;

    // Série diária de novas assinaturas vs cancelamentos no período atual
    const dailyMap: Record<string, { news: number; cancels: number }> = {};
    for (let d = range.start; d <= range.end; d = addDays(d, 1))
      dailyMap[d] = { news: 0, cancels: 0 };
    for (const s of subs) {
      if (s.created_at && inWindow(s.created_at)) {
        const k = s.created_at.slice(0, 10);
        if (dailyMap[k]) dailyMap[k].news += 1;
      }
      if (s.canceled_at && inWindow(s.canceled_at)) {
        const k = s.canceled_at.slice(0, 10);
        if (dailyMap[k]) dailyMap[k].cancels += 1;
      }
    }
    const dailySeries = Object.entries(dailyMap).map(([date, v]) => ({
      date,
      news: v.news,
      cancels: v.cancels,
    }));

    // Churn = cancelados no período / ativos no início (aproximação: ativos atuais + cancelados no período)
    const denomChurn = activeNow + canceledCurr;
    const churnPct = denomChurn > 0 ? (canceledCurr / denomChurn) * 100 : 0;

    // Receita do Clube — via finance_transactions source_module = clube/hubla
    const { data: finRows } = await db
      .from("finance_transactions")
      .select("amount_cents,status,paid_at,due_date,type,source_module,currency")
      .in("source_module", ["clube", "hubla"])
      .gte("due_date", range.start)
      .lte("due_date", range.end)
      .limit(10000);
    let revenueCents = 0;
    let approved = 0;
    for (const t of (finRows ?? []) as FinTx[]) {
      if (t.type === "income" && t.status === "received") {
        revenueCents += t.amount_cents;
        approved += 1;
      }
    }

    // MRR aproximado: receita média mensal recorrente = média ponderada das últimas 30d * (30/dias)
    const periodDays = diffDays(range.start, range.end) + 1;
    const mrrCents = periodDays > 0 ? Math.round((revenueCents / periodDays) * 30) : 0;

    // Integration events Hubla no período
    const { data: intRows } = await db
      .from("integration_events")
      .select("id,provider,event_type,status,processed_at,error_message,created_at")
      .eq("provider", "hubla")
      .gte("created_at", range.start + "T00:00:00")
      .lte("created_at", range.end + "T23:59:59")
      .order("created_at", { ascending: false })
      .limit(5000);
    const intEvents = (intRows ?? []) as IntegrationEventLite[];

    let hublaReceived = 0,
      hublaErrors = 0,
      hublaPending = 0;
    const byEventType = new Map<string, number>();
    for (const e of intEvents) {
      hublaReceived++;
      if (e.status === "error" || e.error_message) hublaErrors++;
      else if (e.status === "received" || e.status === "pending") hublaPending++;
      byEventType.set(e.event_type, (byEventType.get(e.event_type) ?? 0) + 1);
    }
    const eventTypes = Array.from(byEventType, ([label, count]) => ({ label, count })).sort(
      (a, b) => b.count - a.count,
    );

    return {
      range,
      compareRange,
      cards: {
        activeMembers: { current: activeNow, previous: 0, deltaPct: null },
        newSubs: { current: newSubsCurr, previous: newSubsPrev, deltaPct: pctDelta(newSubsCurr, newSubsPrev) },
        canceled: { current: canceledCurr, previous: canceledPrev, deltaPct: pctDelta(canceledCurr, canceledPrev) },
        inactive: { current: inactiveNow, previous: 0, deltaPct: null },
        revenue: { current: revenueCents, previous: 0, deltaPct: null },
        mrr: { current: mrrCents, previous: 0, deltaPct: null },
        churnPct: { current: churnPct, previous: 0, deltaPct: null },
        approved: { current: approved, previous: 0, deltaPct: null },
      },
      hubla: {
        received: hublaReceived,
        errors: hublaErrors,
        pending: hublaPending,
      },
      dailySeries,
      eventTypes,
      recentErrors: intEvents.filter((e) => e.status === "error" || e.error_message).slice(0, 10).map((e) => ({
        id: e.id,
        event_type: e.event_type,
        error_message: e.error_message,
        created_at: e.created_at,
      })),
    };
  });

// ---------- CRM & SLA ----------

type LeadLite = {
  id: string;
  pipeline_stage: string;
  status: string;
  assigned_to: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

type FollowupLite = {
  id: string;
  lead_id: string;
  assigned_to: string;
  due_at: string;
  status: string;
  completed_at: string | null;
  created_at: string;
};

type ConversationLite = {
  id: string;
  lead_id: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
};

type InboxLite = {
  id: string;
  status: string;
  matched_lead_id: string | null;
  created_at: string;
};

const STAGE_ORDER = ["novo", "qualificado", "analise", "fechado", "perdido"];
const STAGE_LABEL: Record<string, string> = {
  novo: "Novo",
  qualificado: "Qualificado",
  analise: "Em análise",
  fechado: "Fechado",
  perdido: "Perdido",
};

export const getReportsCrm = createServerFn({ method: "POST" })
  .middleware([requireModule("relatorios")])
  .inputValidator((d) => reportFiltersSchema.parse(d))
  .handler(async ({ data }) => {
    const range = resolveRange(data);
    const compareRange =
      data.compare === "none" ? null : previousRange(range, data.compare);

    const fetchLeads = async (r: Range): Promise<LeadLite[]> => {
      const { data: rows, error } = await db
        .from("leads")
        .select("id,pipeline_stage,status,assigned_to,source,created_at,updated_at")
        .gte("created_at", r.start + "T00:00:00")
        .lte("created_at", r.end + "T23:59:59")
        .limit(5000);
      if (error) throw new Error(error.message);
      return (rows ?? []) as LeadLite[];
    };
    const [curLeads, prevLeads] = await Promise.all([
      fetchLeads(range),
      compareRange ? fetchLeads(compareRange) : Promise.resolve([] as LeadLite[]),
    ]);

    // Snapshot total de leads ativos — para "leads parados" e "sem responsável"
    const { data: allLeadRows } = await db
      .from("leads")
      .select("id,pipeline_stage,status,assigned_to,source,created_at,updated_at")
      .limit(5000);
    const allLeads = (allLeadRows ?? []) as LeadLite[];

    const nowMs = Date.now();
    const sevenDaysMs = 7 * 86400000;
    const stalledLeads = allLeads.filter(
      (l) =>
        l.status !== "won" &&
        l.status !== "lost" &&
        l.pipeline_stage !== "fechado" &&
        l.pipeline_stage !== "perdido" &&
        nowMs - new Date(l.updated_at).getTime() > sevenDaysMs,
    );
    const leadsWithoutOwner = allLeads.filter(
      (l) => !l.assigned_to && l.status !== "won" && l.status !== "lost",
    ).length;

    // KPIs do período
    const wonCurr = curLeads.filter((l) => l.status === "won" || l.pipeline_stage === "fechado").length;
    const lostCurr = curLeads.filter((l) => l.status === "lost" || l.pipeline_stage === "perdido").length;
    const wonPrev = prevLeads.filter((l) => l.status === "won" || l.pipeline_stage === "fechado").length;
    const lostPrev = prevLeads.filter((l) => l.status === "lost" || l.pipeline_stage === "perdido").length;

    // Funil (todos os leads ativos por etapa)
    const stageAgg = new Map<string, number>();
    for (const l of allLeads) {
      if (l.status === "won" || l.status === "lost") continue;
      stageAgg.set(l.pipeline_stage, (stageAgg.get(l.pipeline_stage) ?? 0) + 1);
    }
    const funnel = STAGE_ORDER.map((k) => ({
      label: STAGE_LABEL[k] ?? k,
      key: k,
      count: stageAgg.get(k) ?? 0,
    }));
    const totalInFunnel = funnel.reduce((s, f) => s + f.count, 0);

    // Leads por origem (do período)
    const sourceAgg = new Map<string, number>();
    for (const l of curLeads) {
      const key = l.source ?? "—";
      sourceAgg.set(key, (sourceAgg.get(key) ?? 0) + 1);
    }
    const leadsBySource = Array.from(sourceAgg, ([label, count]) => ({ label, count })).sort(
      (a, b) => b.count - a.count,
    );

    // Leads por responsável + ranking
    const ownerIds = Array.from(
      new Set(curLeads.map((l) => l.assigned_to).filter((x): x is string => !!x)),
    );
    const ownerNameMap = new Map<string, string>();
    if (ownerIds.length) {
      const { data: profs } = await db
        .from("profiles")
        .select("id,full_name")
        .in("id", ownerIds);
      for (const p of profs ?? []) ownerNameMap.set(p.id, p.full_name ?? "—");
    }

    // Follow-ups do período
    const { data: fuRows } = await db
      .from("crm_followups")
      .select("id,lead_id,assigned_to,due_at,status,completed_at,created_at")
      .gte("created_at", range.start + "T00:00:00")
      .lte("created_at", range.end + "T23:59:59")
      .limit(5000);
    const fus = (fuRows ?? []) as FollowupLite[];

    // Follow-ups pendentes totais (independente do período de criação)
    const { data: pendingFuRows } = await db
      .from("crm_followups")
      .select("id,lead_id,assigned_to,due_at,status,completed_at,created_at")
      .eq("status", "pending")
      .limit(5000);
    const pendingFus = (pendingFuRows ?? []) as FollowupLite[];
    const nowIso = new Date().toISOString();
    const overdueFus = pendingFus.filter((f) => f.due_at < nowIso).length;
    const doneCurr = fus.filter((f) => f.status === "done").length;

    // SLA: comparar due_at vs completed_at
    let slaOk = 0,
      slaMissed = 0;
    for (const f of fus) {
      if (f.status !== "done" || !f.completed_at) continue;
      if (new Date(f.completed_at).getTime() <= new Date(f.due_at).getTime()) slaOk++;
      else slaMissed++;
    }
    const slaTotal = slaOk + slaMissed;
    const slaPct = slaTotal > 0 ? (slaOk / slaTotal) * 100 : 0;

    // Inbox / WhatsApp do período
    const { data: inboxRows } = await db
      .from("crm_inbox_messages")
      .select("id,status,matched_lead_id,created_at")
      .gte("created_at", range.start + "T00:00:00")
      .lte("created_at", range.end + "T23:59:59")
      .limit(5000);
    const inbox = (inboxRows ?? []) as InboxLite[];
    const inboundMessages = inbox.length;
    const unrepliedInbox = inbox.filter((m) => m.status === "received").length;
    const convertedToLead = inbox.filter((m) => m.status === "linked" && m.matched_lead_id).length;

    // Leads criados via WhatsApp (source=whatsapp)
    const leadsViaWhatsapp = curLeads.filter((l) => l.source === "whatsapp").length;

    // Tempo médio de primeira resposta — via conversations
    const { data: convRows } = await db
      .from("crm_conversations")
      .select("id,lead_id,last_inbound_at,last_outbound_at")
      .gte("last_inbound_at", range.start + "T00:00:00")
      .lte("last_inbound_at", range.end + "T23:59:59")
      .limit(2000);
    const convs = (convRows ?? []) as ConversationLite[];

    let respSumMs = 0;
    let respCount = 0;
    let within5 = 0,
      within30 = 0;
    for (const c of convs) {
      if (!c.last_inbound_at || !c.last_outbound_at) continue;
      const inMs = new Date(c.last_inbound_at).getTime();
      const outMs = new Date(c.last_outbound_at).getTime();
      if (outMs >= inMs) {
        const diff = outMs - inMs;
        respSumMs += diff;
        respCount += 1;
        if (diff <= 5 * 60_000) within5++;
        if (diff <= 30 * 60_000) within30++;
      }
    }
    const avgResponseMin = respCount > 0 ? respSumMs / respCount / 60_000 : 0;
    const pctWithin5 = respCount > 0 ? (within5 / respCount) * 100 : 0;
    const pctWithin30 = respCount > 0 ? (within30 / respCount) * 100 : 0;

    // Ranking por responsável
    const ownerStats = new Map<
      string,
      { received: number; closed: number; stalled: number; followupsDone: number }
    >();
    for (const l of curLeads) {
      if (!l.assigned_to) continue;
      const e = ownerStats.get(l.assigned_to) ?? {
        received: 0,
        closed: 0,
        stalled: 0,
        followupsDone: 0,
      };
      e.received += 1;
      if (l.status === "won" || l.pipeline_stage === "fechado") e.closed += 1;
      ownerStats.set(l.assigned_to, e);
    }
    for (const l of stalledLeads) {
      if (!l.assigned_to) continue;
      const e = ownerStats.get(l.assigned_to) ?? {
        received: 0,
        closed: 0,
        stalled: 0,
        followupsDone: 0,
      };
      e.stalled += 1;
      ownerStats.set(l.assigned_to, e);
    }
    for (const f of fus) {
      if (f.status !== "done") continue;
      const e = ownerStats.get(f.assigned_to) ?? {
        received: 0,
        closed: 0,
        stalled: 0,
        followupsDone: 0,
      };
      e.followupsDone += 1;
      ownerStats.set(f.assigned_to, e);
    }
    // Garantir nomes para todos os ids no ranking
    const rankingIds = Array.from(ownerStats.keys());
    const missingIds = rankingIds.filter((id) => !ownerNameMap.has(id));
    if (missingIds.length) {
      const { data: profs } = await db
        .from("profiles")
        .select("id,full_name")
        .in("id", missingIds);
      for (const p of profs ?? []) ownerNameMap.set(p.id, p.full_name ?? "—");
    }
    const ownerRanking = Array.from(ownerStats, ([id, v]) => ({
      id,
      label: ownerNameMap.get(id) ?? "—",
      received: v.received,
      closed: v.closed,
      stalled: v.stalled,
      followupsDone: v.followupsDone,
    })).sort((a, b) => b.received - a.received);

    return {
      range,
      compareRange,
      cards: {
        leadsCreated: { current: curLeads.length, previous: prevLeads.length, deltaPct: pctDelta(curLeads.length, prevLeads.length) },
        won: { current: wonCurr, previous: wonPrev, deltaPct: pctDelta(wonCurr, wonPrev) },
        lost: { current: lostCurr, previous: lostPrev, deltaPct: pctDelta(lostCurr, lostPrev) },
        stalled: { current: stalledLeads.length, previous: 0, deltaPct: null },
        withoutOwner: { current: leadsWithoutOwner, previous: 0, deltaPct: null },
        avgResponseMin: { current: avgResponseMin, previous: 0, deltaPct: null },
        pctWithin5: { current: pctWithin5, previous: 0, deltaPct: null },
        pctWithin30: { current: pctWithin30, previous: 0, deltaPct: null },
        unrepliedInbox: { current: unrepliedInbox, previous: 0, deltaPct: null },
        inboundMessages: { current: inboundMessages, previous: 0, deltaPct: null },
        convertedToLead: { current: convertedToLead, previous: 0, deltaPct: null },
        leadsViaWhatsapp: { current: leadsViaWhatsapp, previous: 0, deltaPct: null },
        followupsPending: { current: pendingFus.length, previous: 0, deltaPct: null },
        followupsOverdue: { current: overdueFus, previous: 0, deltaPct: null },
        followupsDone: { current: doneCurr, previous: 0, deltaPct: null },
        slaPct: { current: slaPct, previous: 0, deltaPct: null },
      },
      funnel,
      totalInFunnel,
      leadsBySource,
      ownerRanking,
    };
  });
