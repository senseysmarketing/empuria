import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
    return rows ?? [];
  });

export const createCustomerQuick = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((d) =>
    z.object({
      fullName: z.string().trim().min(2).max(160),
      phone: z.string().trim().min(5).max(40),
      email: z.string().trim().email().max(200),
      password: z.string().min(6).max(120),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Erro ao criar cliente");
    const uid = created.user.id;
    // Trigger handle_new_user already creates profile + member role; update phone.
    await supabaseAdmin.from("profiles").update({ full_name: data.fullName, phone: data.phone }).eq("id", uid);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "cliente_criado_pdv",
      module: "pdv",
      entity_type: "profile",
      entity_id: uid,
      new_data: { full_name: data.fullName, email: data.email },
    });
    return { id: uid, full_name: data.fullName, phone: data.phone };
  });

// ---------- Fechar venda (atômico) ----------
const closeSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    qty: z.number().int().min(1).max(99),
  })).min(1).max(50),
  discount: z.object({
    type: z.enum(["none", "amount", "percent"]),
    value: z.number().min(0).max(100000),
  }),
  paymentMethod: z.enum(["dinheiro", "cartao"]),
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

export const getPdvSale = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((d) => z.object({ saleId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    type SingleRes<T> = Promise<{ data: T | null; error: { message: string } | null }>;
    type ListRes<T> = Promise<{ data: T[] | null; error: { message: string } | null }>;
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (c: string, v: string) => {
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
    return { sale: saleRes.data, items: itemsRes.data ?? [] };
  });
