import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { createOrReuseManualCustomer } from "./manual-users";

// ---------- Catálogo ----------
export const listPdvCatalog = createServerFn({ method: "GET" })
  .middleware([requireModule("pdv")])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("*, product_categories(id, slug, name, emoji, position)")
      .eq("is_active", true)
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- Clientes ----------
export const searchCustomers = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((d) => z.object({ query: z.string().trim().max(120) }).parse(d))
  .handler(async ({ data }) => {
    const q = data.query;
    if (q.length < 2) return [];
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const { data: rows, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone, avatar_url, is_club_member, is_blocked")
      .or(`full_name.ilike.${like},phone.ilike.${like}`)
      .limit(10);
    if (error) throw new Error(error.message);
    const byId = new Map((rows ?? []).map((row) => [row.id, row]));

    if (q.includes("@") || q.length >= 3) {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const matching = (users?.users ?? []).filter((user) =>
        (user.email ?? "").toLowerCase().includes(q.toLowerCase()),
      );
      const missingIds = matching.map((user) => user.id).filter((id) => !byId.has(id));
      if (missingIds.length) {
        const { data: profileMatches } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, phone, avatar_url, is_club_member, is_blocked")
          .in("id", missingIds);
        for (const row of profileMatches ?? []) byId.set(row.id, row);
      }
    }

    return Array.from(byId.values()).slice(0, 10);
  });

export const createCustomerQuick = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((d) =>
    z
      .object({
        fullName: z.string().trim().min(2).max(160),
        phone: z.string().trim().min(5).max(40),
        email: z.string().trim().email().max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const customer = await createOrReuseManualCustomer({
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      origin: "pdv",
      actorId: context.userId,
    });
    return { id: customer.user_id, full_name: customer.full_name, phone: customer.phone };
  });

// ---------- Fechar venda (atômico) ----------
const closeSchema = z.object({
  customerId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50),
  discount: z.object({
    type: z.enum(["none", "amount", "percent"]),
    value: z.number().min(0).max(100000),
  }),
  paymentMethod: z.enum(["dinheiro", "cartao", "pix"]),
  notes: z.string().trim().max(500).optional(),
});

export const closePdvSale = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((d) => closeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: saleId, error } = await supabaseAdmin.rpc("pdv_close_sale", {
      p_customer_id: data.customerId,
      p_cashier_id: context.userId,
      p_items: data.items.map((i) => ({ product_id: i.productId, qty: i.qty })),
      p_discount_type: data.discount.type,
      p_discount_value: data.discount.value,
      p_payment_method: data.paymentMethod,
      p_notes: data.notes ?? null,
    } as never);
    if (error) throw new Error(error.message);
    return { saleId: saleId as unknown as string };
  });

export type PdvSaleRecord = {
  id: string;
  customer_id: string;
  cashier_id: string;
  sale_code: string;
  subtotal_eur_cents: number;
  subtotal_brl_cents: number;
  discount_type: string;
  discount_value: number;
  discount_eur_cents: number;
  discount_brl_cents: number;
  total_eur_cents: number;
  total_brl_cents: number;
  payment_method: string;
  status: string;
  notes: string | null;
  closed_at: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};
export type PdvSaleItemRecord = {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  product_emoji_snapshot: string | null;
  qty: number;
  unit_price_eur_cents: number;
  unit_price_brl_cents: number;
  total_eur_cents: number;
  total_brl_cents: number;
};

export type PdvProfileSummary = {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url?: string | null;
};

export type PdvStockMovementRecord = {
  id: string;
  product_id: string;
  type: string;
  quantity: number;
  previous_stock: number;
  new_stock: number;
  reason: string | null;
  sale_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type PdvAuditRecord = {
  id: string;
  actor_id: string | null;
  action: string;
  module: string;
  entity_type: string | null;
  entity_id: string | null;
  old_data: Json | null;
  new_data: Json | null;
  created_at: string;
};

const currencyCentsSchema = z.number().int().min(0).optional();

const historySchema = z.object({
  search: z.string().trim().max(120).optional().default(""),
  period: z.enum(["hoje", "ontem", "7d", "mes", "custom", "todos"]).optional().default("7d"),
  dateFrom: z.string().trim().optional().nullable(),
  dateTo: z.string().trim().optional().nullable(),
  paymentMethod: z.enum(["todos", "dinheiro", "cartao"]).optional().default("todos"),
  status: z.enum(["todos", "concluida", "cancelada"]).optional().default("todos"),
  cashierId: z.string().uuid().optional().nullable(),
  minTotalEurCents: currencyCentsSchema,
  maxTotalEurCents: currencyCentsSchema,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(50).default(25),
});

function dateRangeForPeriod(
  period: z.infer<typeof historySchema>["period"],
  dateFrom?: string | null,
  dateTo?: string | null,
) {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  const endOfDay = (d: Date) => {
    const copy = new Date(d);
    copy.setHours(23, 59, 59, 999);
    return copy;
  };

  if (period === "todos") return {};
  if (period === "custom") {
    return {
      from: dateFrom ? startOfDay(new Date(dateFrom)).toISOString() : undefined,
      to: dateTo ? endOfDay(new Date(dateTo)).toISOString() : undefined,
    };
  }
  if (period === "hoje")
    return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
  if (period === "ontem") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return { from: startOfDay(yesterday).toISOString(), to: endOfDay(yesterday).toISOString() };
  }
  if (period === "mes") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: start.toISOString(), to: endOfDay(now).toISOString() };
  }
  const sevenDays = new Date(now);
  sevenDays.setDate(sevenDays.getDate() - 7);
  return { from: startOfDay(sevenDays).toISOString(), to: endOfDay(now).toISOString() };
}

function sanitizeLike(value: string) {
  return value.replace(/[%_]/g, "").trim();
}

async function getProfilesByIds(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, PdvProfileSummary>();
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, phone, avatar_url")
    .in("id", unique);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((profile) => [profile.id, profile as PdvProfileSummary]));
}

async function findProfileIdsForSearch(search: string) {
  const q = sanitizeLike(search);
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .or(`full_name.ilike.${like},phone.ilike.${like}`)
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((profile) => profile.id);
}

export const listPdvSalesHistory = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((d) => historySchema.parse(d))
  .handler(async ({ data, context }) => {
    const range = dateRangeForPeriod(data.period, data.dateFrom, data.dateTo);
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;

    let q = supabaseAdmin
      .from("pdv_sales")
      .select("*", { count: "exact" })
      .order("closed_at", { ascending: false });

    if (range.from) q = q.gte("closed_at", range.from);
    if (range.to) q = q.lte("closed_at", range.to);
    if (data.paymentMethod !== "todos") q = q.eq("payment_method", data.paymentMethod);
    if (data.status !== "todos") q = q.eq("status", data.status);
    if (data.cashierId) q = q.eq("cashier_id", data.cashierId);
    if (data.minTotalEurCents !== undefined) q = q.gte("total_eur_cents", data.minTotalEurCents);
    if (data.maxTotalEurCents !== undefined) q = q.lte("total_eur_cents", data.maxTotalEurCents);

    const search = sanitizeLike(data.search);
    if (search.length >= 2) {
      const profileIds = await findProfileIdsForSearch(search);
      const parts = [`sale_code.ilike.%${search}%`, `payment_method.ilike.%${search}%`];
      if (profileIds.length) {
        const inList = profileIds.join(",");
        parts.push(`customer_id.in.(${inList})`, `cashier_id.in.(${inList})`);
      }
      q = q.or(parts.join(","));
    }

    const { data: rows, error, count } = await q.range(from, to);
    if (error) throw new Error(error.message);

    const sales = (rows ?? []) as PdvSaleRecord[];
    const saleIds = sales.map((sale) => sale.id);
    const profileIds = sales.flatMap((sale) => [
      sale.customer_id,
      sale.cashier_id,
      sale.voided_by ?? "",
    ]);

    const [profiles, itemCounts] = await Promise.all([
      getProfilesByIds(profileIds),
      saleIds.length
        ? supabaseAdmin.from("pdv_sale_items").select("sale_id, qty").in("sale_id", saleIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (itemCounts.error) throw new Error(itemCounts.error.message);

    const counts = new Map<string, { lines: number; qty: number }>();
    for (const item of itemCounts.data ?? []) {
      const current = counts.get(item.sale_id) ?? { lines: 0, qty: 0 };
      current.lines += 1;
      current.qty += item.qty;
      counts.set(item.sale_id, current);
    }

    return {
      items: sales.map((sale) => ({
        ...sale,
        customer: profiles.get(sale.customer_id) ?? null,
        cashier: profiles.get(sale.cashier_id) ?? null,
        voided_by_profile: sale.voided_by ? (profiles.get(sale.voided_by) ?? null) : null,
        item_count: counts.get(sale.id)?.qty ?? 0,
        item_lines: counts.get(sale.id)?.lines ?? 0,
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      isAdmin: Boolean(context.isAdmin),
    };
  });

export const listPdvCashiers = createServerFn({ method: "GET" })
  .middleware([requireModule("pdv")])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("pdv_sales")
      .select("cashier_id")
      .order("closed_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const profiles = await getProfilesByIds((data ?? []).map((row) => row.cashier_id));
    return [...profiles.values()].sort((a, b) =>
      (a.full_name ?? "").localeCompare(b.full_name ?? "", "pt-BR"),
    );
  });

export const getPdvSale = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((d) => z.object({ saleId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    type SingleRes<T> = Promise<{ data: T | null; error: { message: string } | null }>;
    type ListRes<T> = Promise<{ data: T[] | null; error: { message: string } | null }>;
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (
            c: string,
            v: string,
          ) => {
            single: () => SingleRes<PdvSaleRecord>;
            order: (c: string) => ListRes<PdvSaleItemRecord>;
          };
        };
      };
    };
    const [saleRes, itemsRes] = await Promise.all([
      admin.from("pdv_sales").select("*").eq("id", data.saleId).single(),
      admin.from("pdv_sale_items").select("*").eq("sale_id", data.saleId).order("created_at"),
    ]);
    if (saleRes.error) throw new Error(saleRes.error.message);
    const sale = saleRes.data;
    const [profiles, stockRes, auditRes] = await Promise.all([
      sale
        ? getProfilesByIds([sale.customer_id, sale.cashier_id, sale.voided_by ?? ""])
        : new Map(),
      supabaseAdmin
        .from("product_stock_movements")
        .select("*")
        .eq("sale_id", data.saleId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("audit_logs")
        .select("*")
        .eq("entity_type", "pdv_sale")
        .eq("entity_id", data.saleId)
        .order("created_at", { ascending: false }),
    ]);
    if (stockRes.error) throw new Error(stockRes.error.message);
    if (auditRes.error) throw new Error(auditRes.error.message);

    return {
      sale,
      items: itemsRes.data ?? [],
      customer: sale ? (profiles.get(sale.customer_id) ?? null) : null,
      cashier: sale ? (profiles.get(sale.cashier_id) ?? null) : null,
      voided_by_profile: sale?.voided_by ? (profiles.get(sale.voided_by) ?? null) : null,
      stock_movements: (stockRes.data ?? []) as PdvStockMovementRecord[],
      audit_events: (auditRes.data ?? []) as PdvAuditRecord[],
    };
  });

export const voidPdvSale = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((d) =>
    z
      .object({
        saleId: z.string().uuid(),
        reason: z.string().trim().min(5).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!context.isAdmin) throw new Error("Apenas administradores podem anular vendas.");
    const { error } = await supabaseAdmin.rpc("pdv_void_sale", {
      p_sale_id: data.saleId,
      p_admin_id: context.userId,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
