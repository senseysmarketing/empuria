import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import ExcelJS from "exceljs";
import { Buffer } from "node:buffer";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const filtersSchema = z.object({
  search: z.string().trim().max(120).optional().default(""),
  period: z.enum(["hoje", "ontem", "7d", "mes", "mes_anterior", "custom", "todos"]).optional().default("7d"),
  dateFrom: z.string().trim().optional().nullable(),
  dateTo: z.string().trim().optional().nullable(),
  paymentMethod: z.enum(["todos", "dinheiro", "cartao", "pix", "wise", "transferencia"]).optional().default("todos"),
  status: z.enum(["todos", "concluida", "cancelada"]).optional().default("todos"),
  cashierId: z.string().uuid().optional().nullable(),
  categoryIds: z.array(z.string().uuid()).optional().default([]),
  productIds: z.array(z.string().uuid()).optional().default([]),
  minTotalEurCents: z.number().int().min(0).optional(),
  maxTotalEurCents: z.number().int().min(0).optional(),
});

const PERIOD_LABEL: Record<string, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "Últimos 7 dias",
  mes: "Este mês",
  mes_anterior: "Mês anterior",
  custom: "Personalizado",
  todos: "Todos",
};

const PAYMENT_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  cartao: "Cartão",
  pix: "Pix",
  wise: "Wise",
  transferencia: "Transferência",
  mbway: "MB WAY",
  multibanco: "Multibanco",
};

function dateRangeForPeriod(period: string, dateFrom?: string | null, dateTo?: string | null) {
  const now = new Date();
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  if (period === "todos") return {};
  if (period === "custom") {
    return {
      from: dateFrom ? startOfDay(new Date(dateFrom)).toISOString() : undefined,
      to: dateTo ? endOfDay(new Date(dateTo)).toISOString() : undefined,
    };
  }
  if (period === "hoje") return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
  if (period === "ontem") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() };
  }
  if (period === "mes") {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: s.toISOString(), to: endOfDay(now).toISOString() };
  }
  if (period === "mes_anterior") {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: s.toISOString(), to: endOfDay(e).toISOString() };
  }
  const s = new Date(now); s.setDate(s.getDate() - 7);
  return { from: startOfDay(s).toISOString(), to: endOfDay(now).toISOString() };
}

function sanitizeLike(v: string) { return v.replace(/[%_]/g, "").trim(); }

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export const exportPdvHistoryXlsx = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((d) => filtersSchema.parse(d))
  .handler(async ({ data }) => {
    const range = dateRangeForPeriod(data.period, data.dateFrom, data.dateTo);

    // Same category/product prefilter as listPdvSalesHistory
    let restrictSaleIds: string[] | null = null;
    if ((data.categoryIds && data.categoryIds.length) || (data.productIds && data.productIds.length)) {
      let productIds = data.productIds ?? [];
      if (data.categoryIds?.length) {
        const { data: prods } = await supabaseAdmin
          .from("products")
          .select("id")
          .in("category_id", data.categoryIds);
        const catProductIds = (prods ?? []).map((p) => p.id);
        productIds = productIds.length ? productIds.filter((id) => catProductIds.includes(id)) : catProductIds;
      }
      if (!productIds.length) restrictSaleIds = [];
      else {
        const { data: rows } = await supabaseAdmin
          .from("pdv_sale_items")
          .select("sale_id")
          .in("product_id", productIds);
        restrictSaleIds = [...new Set((rows ?? []).map((r) => r.sale_id))];
      }
    }

    let q = supabaseAdmin
      .from("pdv_sales")
      .select("*")
      .order("closed_at", { ascending: false })
      .limit(5000);
    if (range.from) q = q.gte("closed_at", range.from);
    if (range.to) q = q.lte("closed_at", range.to);
    if (data.paymentMethod !== "todos") q = q.eq("payment_method", data.paymentMethod);
    if (data.status !== "todos") q = q.eq("status", data.status);
    if (data.cashierId) q = q.eq("cashier_id", data.cashierId);
    if (data.minTotalEurCents !== undefined) q = q.gte("total_eur_cents", data.minTotalEurCents);
    if (data.maxTotalEurCents !== undefined) q = q.lte("total_eur_cents", data.maxTotalEurCents);
    if (restrictSaleIds !== null) {
      if (!restrictSaleIds.length) {
        // empty export
        return await emptyXlsx(data);
      }
      q = q.in("id", restrictSaleIds);
    }

    const search = sanitizeLike(data.search);
    if (search.length >= 2) {
      const like = `%${search}%`;
      const { data: profs } = await supabaseAdmin
        .from("profiles").select("id").or(`full_name.ilike.${like},phone.ilike.${like}`).limit(100);
      const profileIds = (profs ?? []).map((p) => p.id);
      const parts = [`sale_code.ilike.${like}`, `payment_method.ilike.${like}`];
      if (profileIds.length) {
        const inList = profileIds.join(",");
        parts.push(`customer_id.in.(${inList})`, `cashier_id.in.(${inList})`);
      }
      q = q.or(parts.join(","));
    }

    const { data: sales, error } = await q;
    if (error) throw new Error(error.message);
    const rows = sales ?? [];

    const profileIds = [...new Set(rows.flatMap((s) => [s.customer_id, s.cashier_id]).filter(Boolean))];
    const { data: profs } = profileIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", profileIds)
      : { data: [] };
    const profMap = new Map((profs ?? []).map((p) => [p.id, p]));

    const saleIds = rows.map((s) => s.id);
    const { data: items } = saleIds.length
      ? await supabaseAdmin
          .from("pdv_sale_items")
          .select("sale_id, qty, product_name_snapshot, total_eur_cents")
          .in("sale_id", saleIds)
      : { data: [] };
    const itemMap = new Map<string, { qty: number; lines: number; description: string }>();
    for (const it of items ?? []) {
      const e = itemMap.get(it.sale_id) ?? { qty: 0, lines: 0, description: "" };
      e.qty += it.qty;
      e.lines += 1;
      e.description = e.description ? `${e.description}, ${it.qty}x ${it.product_name_snapshot}` : `${it.qty}x ${it.product_name_snapshot}`;
      itemMap.set(it.sale_id, e);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Empuria";
    wb.created = new Date();

    // Filters sheet
    const fs = wb.addWorksheet("Filtros");
    fs.columns = [{ header: "Campo", key: "k", width: 28 }, { header: "Valor", key: "v", width: 60 }];
    fs.addRow({ k: "Relatório", v: "Histórico de vendas PDV" });
    fs.addRow({ k: "Período", v: PERIOD_LABEL[data.period] ?? data.period });
    if (data.period === "custom") {
      fs.addRow({ k: "De", v: data.dateFrom ?? "—" });
      fs.addRow({ k: "Até", v: data.dateTo ?? "—" });
    }
    fs.addRow({ k: "Forma de pagamento", v: data.paymentMethod === "todos" ? "Todas" : PAYMENT_LABEL[data.paymentMethod] ?? data.paymentMethod });
    fs.addRow({ k: "Status", v: data.status === "todos" ? "Todos" : data.status });
    fs.addRow({ k: "Operador", v: data.cashierId ?? "Todos" });
    fs.addRow({ k: "Categorias", v: data.categoryIds?.length ? `${data.categoryIds.length} selecionadas` : "Todas" });
    fs.addRow({ k: "Produtos", v: data.productIds?.length ? `${data.productIds.length} selecionados` : "Todos" });
    fs.addRow({ k: "Valor mínimo €", v: data.minTotalEurCents !== undefined ? (data.minTotalEurCents / 100).toFixed(2) : "—" });
    fs.addRow({ k: "Valor máximo €", v: data.maxTotalEurCents !== undefined ? (data.maxTotalEurCents / 100).toFixed(2) : "—" });
    fs.addRow({ k: "Busca", v: data.search || "—" });
    fs.addRow({ k: "Total de registros", v: rows.length });
    fs.addRow({ k: "Gerado em", v: new Date().toLocaleString("pt-PT") });
    fs.getRow(1).font = { bold: true };

    // Data sheet
    const ws = wb.addWorksheet("Vendas");
    ws.columns = [
      { header: "Código", key: "code", width: 18 },
      { header: "Data", key: "date", width: 18 },
      { header: "Cliente", key: "customer", width: 28 },
      { header: "Telefone", key: "phone", width: 18 },
      { header: "Operador", key: "cashier", width: 24 },
      { header: "Itens (qtd)", key: "qty", width: 12 },
      { header: "Itens (linhas)", key: "lines", width: 14 },
      { header: "Descrição", key: "desc", width: 60 },
      { header: "Pagamento", key: "pay", width: 16 },
      { header: "Status", key: "status", width: 14 },
      { header: "Subtotal €", key: "subtotal", width: 14 },
      { header: "Desconto €", key: "discount", width: 14 },
      { header: "Total €", key: "total", width: 14 },
      { header: "Motivo anulação", key: "void", width: 40 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEE5DA" } } as never;

    let totalSum = 0;
    let completedCount = 0;
    for (const s of rows) {
      const cust = profMap.get(s.customer_id);
      const cash = profMap.get(s.cashier_id);
      const items = itemMap.get(s.id);
      const total = (s.total_eur_cents ?? 0) / 100;
      if (s.status !== "cancelada") {
        totalSum += s.total_eur_cents ?? 0;
        completedCount += 1;
      }
      ws.addRow({
        code: s.sale_code,
        date: fmtDate(s.closed_at),
        customer: s.customer_name_snapshot ?? cust?.full_name ?? "—",
        phone: s.customer_phone_snapshot ?? cust?.phone ?? "—",
        cashier: cash?.full_name ?? "—",
        qty: items?.qty ?? 0,
        lines: items?.lines ?? 0,
        desc: items?.description ?? "",
        pay: PAYMENT_LABEL[s.payment_method] ?? s.payment_method,
        status: s.status === "cancelada" ? "Anulada" : "Concluída",
        subtotal: (s.subtotal_eur_cents ?? 0) / 100,
        discount: (s.discount_eur_cents ?? 0) / 100,
        total,
        void: s.void_reason ?? "",
      });
    }
    for (const col of ["subtotal", "discount", "total"] as const) {
      ws.getColumn(col).numFmt = '#,##0.00 "€"';
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };

    // Totals row
    const totalsRow = ws.addRow({
      code: "TOTAL CONCLUÍDAS",
      qty: rows.reduce((a, r) => a + (itemMap.get(r.id)?.qty ?? 0), 0),
      total: totalSum / 100,
    });
    totalsRow.font = { bold: true };
    totalsRow.getCell("total").numFmt = '#,##0.00 "€"';

    fs.addRow({ k: "Total concluídas €", v: (totalSum / 100).toFixed(2) });
    fs.addRow({ k: "Vendas concluídas", v: completedCount });

    const buf = await wb.xlsx.writeBuffer();
    const base64 = Buffer.from(buf as ArrayBuffer).toString("base64");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return {
      base64,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `pdv-historico-${stamp}.xlsx`,
    };
  });

async function emptyXlsx(_filters: z.infer<typeof filtersSchema>) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Vendas");
  ws.addRow(["Nenhuma venda encontrada com os filtros aplicados."]);
  const buf = await wb.xlsx.writeBuffer();
  const base64 = Buffer.from(buf as ArrayBuffer).toString("base64");
  return {
    base64,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename: `pdv-historico-vazio.xlsx`,
  };
}
