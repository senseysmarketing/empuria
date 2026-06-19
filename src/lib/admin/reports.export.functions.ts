import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import ExcelJS from "exceljs";
import { requireModule } from "./auth";
import { Buffer } from "node:buffer";
import {
  reportFiltersSchema,
  getReportsOverview,
  getReportsVendas,
  getReportsPdv,
  getReportsServicos,
  getReportsEventos,
  getReportsClube,
  getReportsCrm,
  getReportsHistorico,
  historicoFiltersSchema,
} from "./reports.functions";

const TAB_LABEL: Record<string, string> = {
  visao: "Visão Geral",
  vendas: "Vendas & Financeiro",
  pdv: "PDV & Estoque",
  servicos: "Serviços & Agenda",
  eventos: "Eventos",
  clube: "Clube do Imigrante",
  crm: "CRM & SLA",
  historico: "Histórico de Pedidos",
};

const exportSchema = z.object({
  tab: z.enum(["visao", "vendas", "pdv", "servicos", "eventos", "clube", "crm", "historico"]),
  filters: reportFiltersSchema,
});


function money(cents: number) {
  return (cents ?? 0) / 100;
}

function addFiltersSheet(wb: ExcelJS.Workbook, tab: string, filters: z.infer<typeof reportFiltersSchema>, range: { start: string; end: string }) {
  const ws = wb.addWorksheet("Filtros");
  ws.columns = [
    { header: "Campo", key: "k", width: 28 },
    { header: "Valor", key: "v", width: 48 },
  ];
  ws.addRow({ k: "Relatório", v: TAB_LABEL[tab] ?? tab });
  ws.addRow({ k: "Período", v: filters.period });
  ws.addRow({ k: "Intervalo", v: `${range.start} a ${range.end}` });
  ws.addRow({ k: "Comparação", v: filters.compare });
  ws.addRow({ k: "Moeda", v: filters.currency });
  ws.addRow({ k: "Origem", v: filters.origin ?? "todas" });
  ws.addRow({ k: "Gerado em", v: new Date().toLocaleString("pt-BR") });
  ws.getRow(1).font = { bold: true };
}

function addKpisSheet(
  wb: ExcelJS.Workbook,
  cards: Record<string, { current: number; previous?: number; deltaPct?: number | null }>,
  labelMap: Record<string, string>,
  formatter: (key: string, value: number) => string | number,
) {
  const ws = wb.addWorksheet("KPIs");
  ws.columns = [
    { header: "Métrica", key: "label", width: 36 },
    { header: "Atual", key: "current", width: 18 },
    { header: "Anterior", key: "previous", width: 18 },
    { header: "Variação", key: "delta", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const [key, val] of Object.entries(cards)) {
    ws.addRow({
      label: labelMap[key] ?? key,
      current: formatter(key, val.current ?? 0),
      previous: val.previous != null ? formatter(key, val.previous) : "",
      delta:
        val.deltaPct != null
          ? `${val.deltaPct >= 0 ? "+" : ""}${val.deltaPct.toFixed(1)}%`
          : "",
    });
  }
}

function addRankingSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: Array<Record<string, unknown>>,
  columns: Array<{ header: string; key: string; width?: number }>,
) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
}

// -------- Per-tab builders --------

const MONEY_KEYS = new Set([
  "received",
  "receivable",
  "expenses",
  "balance",
  "ticketAvg",
  "ticket",
  "revenue",
  "mrr",
]);

async function buildVisaoXlsx(wb: ExcelJS.Workbook, filters: z.infer<typeof reportFiltersSchema>) {
  const d = await (getReportsOverview as unknown as (a: { data: typeof filters }) => Promise<Awaited<ReturnType<typeof getReportsOverview>>>)({ data: filters });
  addFiltersSheet(wb, "visao", filters, d.range);
  addKpisSheet(
    wb,
    d.cards as never,
    {
      received: "Receita recebida",
      receivable: "Receita prevista",
      expenses: "Despesas",
      balance: "Saldo",
      ordersPaid: "Pedidos pagos",
      pdvSales: "Vendas PDV",
      newLeads: "Novos leads",
      newClubMembers: "Novos membros do Clube",
      eventTickets: "Ingressos vendidos",
    },
    (k, v) => (MONEY_KEYS.has(k) ? money(v) : v),
  );
  addRankingSheet(
    wb,
    "Receita por origem",
    d.byOrigin.map((r) => ({ origem: r.label, valor_eur: money(r.amount_cents) })),
    [
      { header: "Origem", key: "origem", width: 24 },
      { header: "Valor", key: "valor_eur", width: 18 },
    ],
  );
  addRankingSheet(
    wb,
    "Receita por dia",
    d.series.map((s) => ({ data: s.date, valor: s.value })),
    [
      { header: "Data", key: "data", width: 14 },
      { header: "Receita", key: "valor", width: 18 },
    ],
  );
  if (d.alerts.length) {
    addRankingSheet(
      wb,
      "Alertas",
      d.alerts.map((a) => ({ tipo: a.type, severidade: a.severity, mensagem: a.message })),
      [
        { header: "Tipo", key: "tipo", width: 24 },
        { header: "Severidade", key: "severidade", width: 14 },
        { header: "Mensagem", key: "mensagem", width: 80 },
      ],
    );
  }
  return d.range;
}

async function buildVendasXlsx(wb: ExcelJS.Workbook, filters: z.infer<typeof reportFiltersSchema>) {
  const d = await (getReportsVendas as unknown as (a: { data: typeof filters }) => Promise<Awaited<ReturnType<typeof getReportsVendas>>>)({ data: filters });
  addFiltersSheet(wb, "vendas", filters, d.range);
  addKpisSheet(
    wb,
    d.cards as never,
    {
      received: "Receita recebida",
      receivable: "A receber",
      expenses: "Despesas pagas",
      balance: "Saldo",
      ordersPaid: "Pedidos pagos",
      ordersPending: "Pedidos pendentes",
      ticketAvg: "Ticket médio",
      paymentConversionPct: "Conversão de pagamento (%)",
    },
    (k, v) => (MONEY_KEYS.has(k) ? money(v) : v),
  );
  addRankingSheet(wb, "Receita por origem", d.byOrigin.map((r) => ({ origem: r.label, valor: money(r.amount_cents) })), [
    { header: "Origem", key: "origem", width: 24 },
    { header: "Valor", key: "valor", width: 18 },
  ]);
  addRankingSheet(wb, "Ticket médio por origem", d.ticketAvgByOrigin.map((r) => ({ origem: r.label, ticket: money(r.amount_cents) })), [
    { header: "Origem", key: "origem", width: 24 },
    { header: "Ticket médio", key: "ticket", width: 18 },
  ]);
  addRankingSheet(wb, "Pendentes por status", d.pendingByStatus.map((r) => ({ status: r.label, valor: money(r.amount_cents) })), [
    { header: "Status", key: "status", width: 18 },
    { header: "Valor", key: "valor", width: 18 },
  ]);
  addRankingSheet(wb, "Despesas por categoria", d.expenseByCategory.map((r) => ({ categoria: r.label, valor: money(r.amount_cents) })), [
    { header: "Categoria", key: "categoria", width: 28 },
    { header: "Valor", key: "valor", width: 18 },
  ]);
  addRankingSheet(wb, "Receita por dia", d.series.map((s) => ({ data: s.date, valor: s.value })), [
    { header: "Data", key: "data", width: 14 },
    { header: "Receita", key: "valor", width: 18 },
  ]);
  return d.range;
}

async function buildPdvXlsx(wb: ExcelJS.Workbook, filters: z.infer<typeof reportFiltersSchema>) {
  const d = await (getReportsPdv as unknown as (a: { data: typeof filters }) => Promise<Awaited<ReturnType<typeof getReportsPdv>>>)({ data: filters });
  addFiltersSheet(wb, "pdv", filters, d.range);
  addKpisSheet(
    wb,
    d.cards as never,
    {
      revenue: "Faturamento PDV",
      salesCount: "Vendas concluídas",
      ticket: "Ticket médio",
      itemsSold: "Itens vendidos",
      voided: "Vendas anuladas",
    },
    (k, v) => (MONEY_KEYS.has(k) ? money(v) : v),
  );
  addRankingSheet(wb, "Top produtos", d.topProducts.map((p) => ({ produto: p.name, qtd: p.qty, receita: money(p.revenue) })), [
    { header: "Produto", key: "produto", width: 36 },
    { header: "Qtd", key: "qtd", width: 10 },
    { header: "Receita (EUR)", key: "receita", width: 18 },
  ]);
  addRankingSheet(wb, "Operadores", d.topCashiers.map((c) => ({ operador: c.label, vendas: c.count, receita: money(c.revenue) })), [
    { header: "Operador", key: "operador", width: 32 },
    { header: "Vendas", key: "vendas", width: 10 },
    { header: "Receita (EUR)", key: "receita", width: 18 },
  ]);
  addRankingSheet(wb, "Formas de pagamento", d.paymentMethods.map((p) => ({ metodo: p.label, vendas: p.count, receita: money(p.revenue) })), [
    { header: "Forma", key: "metodo", width: 20 },
    { header: "Vendas", key: "vendas", width: 10 },
    { header: "Receita (EUR)", key: "receita", width: 18 },
  ]);
  addRankingSheet(wb, "Estoque baixo", d.lowStock.map((p: { id: string; name: string; stock_quantity: number }) => ({ produto: p.name, estoque: p.stock_quantity })), [
    { header: "Produto", key: "produto", width: 36 },
    { header: "Estoque", key: "estoque", width: 12 },
  ]);
  return d.range;
}

async function buildServicosXlsx(wb: ExcelJS.Workbook, filters: z.infer<typeof reportFiltersSchema>) {
  const d = await (getReportsServicos as unknown as (a: { data: typeof filters }) => Promise<Awaited<ReturnType<typeof getReportsServicos>>>)({ data: filters });
  addFiltersSheet(wb, "servicos", filters, d.range);
  addKpisSheet(
    wb,
    d.cards as never,
    {
      total: "Agendamentos",
      confirmed: "Confirmados",
      completed: "Concluídos",
      canceled: "Cancelados",
      noShow: "Não compareceu",
      noShowRate: "Taxa de no-show (%)",
      cancelRate: "Taxa de cancelamento (%)",
    },
    (_k, v) => v,
  );
  addRankingSheet(wb, "Top serviços", d.topServices.map((s) => ({ servico: s.label, qtd: s.count })), [
    { header: "Serviço", key: "servico", width: 36 },
    { header: "Qtd", key: "qtd", width: 10 },
  ]);
  addRankingSheet(wb, "Por categoria", d.byCategory.map((s) => ({ categoria: s.label, qtd: s.count })), [
    { header: "Categoria", key: "categoria", width: 28 },
    { header: "Qtd", key: "qtd", width: 10 },
  ]);
  addRankingSheet(wb, "Por dia da semana", d.byWeekday.map((s) => ({ dia: s.label, qtd: s.count })), [
    { header: "Dia", key: "dia", width: 12 },
    { header: "Qtd", key: "qtd", width: 10 },
  ]);
  addRankingSheet(wb, "Por status", d.byStatus.map((s) => ({ status: s.label, qtd: s.count })), [
    { header: "Status", key: "status", width: 18 },
    { header: "Qtd", key: "qtd", width: 10 },
  ]);
  return d.range;
}

async function buildEventosXlsx(wb: ExcelJS.Workbook, filters: z.infer<typeof reportFiltersSchema>) {
  const d = await (getReportsEventos as unknown as (a: { data: typeof filters }) => Promise<Awaited<ReturnType<typeof getReportsEventos>>>)({ data: filters });
  addFiltersSheet(wb, "eventos", filters, d.range);
  addKpisSheet(
    wb,
    d.cards as never,
    {
      publishedEvents: "Eventos publicados",
      ticketsSold: "Ingressos vendidos",
      revenue: "Receita (EUR)",
      checkedIn: "Check-ins",
      attendanceRate: "Taxa de comparecimento (%)",
      canceled: "Cancelados",
      avgCapacityPct: "Capacidade média vendida (%)",
    },
    (k, v) => (k === "revenue" ? money(v) : v),
  );
  addRankingSheet(wb, "Top por receita", d.topEventsByRevenue.map((e) => ({ evento: e.label, ingressos: e.sold, check_ins: e.checkedIn, receita: money(e.revenue) })), [
    { header: "Evento", key: "evento", width: 36 },
    { header: "Ingressos", key: "ingressos", width: 12 },
    { header: "Check-ins", key: "check_ins", width: 12 },
    { header: "Receita (EUR)", key: "receita", width: 18 },
  ]);
  addRankingSheet(wb, "Receita por lote", d.tierRevenue.map((t) => ({ lote: t.label, receita: money(t.revenue) })), [
    { header: "Lote", key: "lote", width: 48 },
    { header: "Receita (EUR)", key: "receita", width: 18 },
  ]);
  addRankingSheet(wb, "Baixa procura", d.lowDemand.map((e: { title: string; sold: number; capacity: number; pct: number }) => ({ evento: e.title, vendidos: e.sold, capacidade: e.capacity, percentual: e.pct })), [
    { header: "Evento", key: "evento", width: 36 },
    { header: "Vendidos", key: "vendidos", width: 12 },
    { header: "Capacidade", key: "capacidade", width: 12 },
    { header: "% vendido", key: "percentual", width: 12 },
  ]);
  addRankingSheet(wb, "Status ingressos", d.ticketStatus.map((s) => ({ status: s.label, qtd: s.count })), [
    { header: "Status", key: "status", width: 14 },
    { header: "Qtd", key: "qtd", width: 10 },
  ]);
  return d.range;
}

async function buildClubeXlsx(wb: ExcelJS.Workbook, filters: z.infer<typeof reportFiltersSchema>) {
  const d = await (getReportsClube as unknown as (a: { data: typeof filters }) => Promise<Awaited<ReturnType<typeof getReportsClube>>>)({ data: filters });
  addFiltersSheet(wb, "clube", filters, d.range);
  addKpisSheet(
    wb,
    d.cards as never,
    {
      activeMembers: "Membros ativos",
      newSubs: "Novas assinaturas",
      canceled: "Cancelamentos",
      inactive: "Inadimplentes/Inativos",
      revenue: "Receita",
      mrr: "MRR estimado",
      churnPct: "Churn (%)",
      approved: "Pagamentos aprovados",
    },
    (k, v) => (k === "revenue" || k === "mrr" ? money(v) : v),
  );
  addRankingSheet(wb, "Hubla resumo", [
    { metrica: "Recebidos", qtd: d.hubla.received },
    { metrica: "Pendentes", qtd: d.hubla.pending },
    { metrica: "Com erro", qtd: d.hubla.errors },
  ], [
    { header: "Métrica", key: "metrica", width: 18 },
    { header: "Qtd", key: "qtd", width: 12 },
  ]);
  addRankingSheet(wb, "Tipos de evento Hubla", d.eventTypes.map((e) => ({ evento: e.label, qtd: e.count })), [
    { header: "Tipo de evento", key: "evento", width: 36 },
    { header: "Qtd", key: "qtd", width: 12 },
  ]);
  addRankingSheet(wb, "Erros recentes Hubla", d.recentErrors.map((e: { event_type: string; error_message: string | null; created_at: string }) => ({ evento: e.event_type, erro: e.error_message ?? "", data: e.created_at })), [
    { header: "Evento", key: "evento", width: 28 },
    { header: "Erro", key: "erro", width: 60 },
    { header: "Data", key: "data", width: 20 },
  ]);
  addRankingSheet(wb, "Diário", d.dailySeries.map((s) => ({ data: s.date, novas: s.news, cancelamentos: s.cancels })), [
    { header: "Data", key: "data", width: 14 },
    { header: "Novas", key: "novas", width: 10 },
    { header: "Cancelamentos", key: "cancelamentos", width: 14 },
  ]);
  return d.range;
}

async function buildCrmXlsx(wb: ExcelJS.Workbook, filters: z.infer<typeof reportFiltersSchema>) {
  const d = await (getReportsCrm as unknown as (a: { data: typeof filters }) => Promise<Awaited<ReturnType<typeof getReportsCrm>>>)({ data: filters });
  addFiltersSheet(wb, "crm", filters, d.range);
  addKpisSheet(
    wb,
    d.cards as never,
    {
      leadsCreated: "Leads criados",
      won: "Leads ganhos",
      lost: "Leads perdidos",
      stalled: "Leads parados",
      withoutOwner: "Sem responsável",
      avgResponseMin: "Tempo médio 1ª resposta (min)",
      pctWithin5: "% respondido ≤ 5min",
      pctWithin30: "% respondido ≤ 30min",
      unrepliedInbox: "Sem resposta",
      inboundMessages: "Mensagens inbound",
      convertedToLead: "Convertidas em lead",
      leadsViaWhatsapp: "Leads via WhatsApp",
      followupsPending: "Follow-ups pendentes",
      followupsOverdue: "Follow-ups atrasados",
      followupsDone: "Follow-ups concluídos",
      slaPct: "SLA cumprido (%)",
    },
    (_k, v) => v,
  );
  addRankingSheet(wb, "Funil de leads", d.funnel.map((s) => ({ etapa: s.label, qtd: s.count })), [
    { header: "Etapa", key: "etapa", width: 18 },
    { header: "Qtd", key: "qtd", width: 10 },
  ]);
  addRankingSheet(wb, "Leads por origem", d.leadsBySource.map((s) => ({ origem: s.label, qtd: s.count })), [
    { header: "Origem", key: "origem", width: 18 },
    { header: "Qtd", key: "qtd", width: 10 },
  ]);
  addRankingSheet(
    wb,
    "Ranking responsáveis",
    d.ownerRanking.map((r: { label: string; received: number; closed: number; followupsDone: number; stalled: number }) => ({
      responsavel: r.label,
      recebidos: r.received,
      fechados: r.closed,
      followups_feitos: r.followupsDone,
      parados: r.stalled,
      conversao_pct: r.received > 0 ? Number(((r.closed / r.received) * 100).toFixed(1)) : 0,
    })),
    [
      { header: "Responsável", key: "responsavel", width: 28 },
      { header: "Leads recebidos", key: "recebidos", width: 14 },
      { header: "Fechados", key: "fechados", width: 12 },
      { header: "Follow-ups feitos", key: "followups_feitos", width: 16 },
      { header: "Leads parados", key: "parados", width: 14 },
      { header: "Conversão (%)", key: "conversao_pct", width: 14 },
    ],
  );
  return d.range;
}

export const exportReportXlsx = createServerFn({ method: "POST" })
  .middleware([requireModule("relatorios")])
  .inputValidator((d) => exportSchema.parse(d))
  .handler(async ({ data }) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Instituto Empuria";
    wb.created = new Date();

    switch (data.tab) {
      case "visao":
        await buildVisaoXlsx(wb, data.filters);
        break;
      case "vendas":
        await buildVendasXlsx(wb, data.filters);
        break;
      case "pdv":
        await buildPdvXlsx(wb, data.filters);
        break;
      case "servicos":
        await buildServicosXlsx(wb, data.filters);
        break;
      case "eventos":
        await buildEventosXlsx(wb, data.filters);
        break;
      case "clube":
        await buildClubeXlsx(wb, data.filters);
        break;
      case "crm":
        await buildCrmXlsx(wb, data.filters);
        break;
    }

    const buf = await wb.xlsx.writeBuffer();
    const base64 = Buffer.from(buf as ArrayBuffer).toString("base64");
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      filename: `relatorio-${data.tab}-${stamp}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      base64,
    };
  });
