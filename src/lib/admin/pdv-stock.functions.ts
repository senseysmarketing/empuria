import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type StockMovementRecord = {
  id: string;
  product_id: string;
  type:
    | "entrada"
    | "saida"
    | "ajuste"
    | "venda"
    | "cancelamento"
    | "reserva_comanda"
    | "liberacao_reserva_comanda"
    | "venda_comanda";
  quantity: number;
  previous_stock: number;
  new_stock: number;
  reason: string | null;
  sale_id: string | null;
  created_by: string | null;
  created_at: string;
};

type ProductStockRow = {
  id: string;
  name: string;
  stock_quantity: number;
  reserved_stock_quantity?: number;
  available_stock_quantity?: number;
  track_stock: boolean;
};

async function fetchProduct(productId: string): Promise<ProductStockRow> {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id, name, stock_quantity, reserved_stock_quantity, available_stock_quantity, track_stock")
    .eq("id", productId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Produto não encontrado");
  return data as unknown as ProductStockRow;
}

async function applyMovement(args: {
  productId: string;
  type: "entrada" | "saida" | "ajuste";
  delta: number;            // positive entrada, negative saida, exact diff ajuste
  newStock: number;
  reason: string;
  actorId: string;
}) {
  const product = await fetchProduct(args.productId);
  await supabaseAdmin.from("products").update({ stock_quantity: args.newStock }).eq("id", args.productId);
  type Insertable = { from: (t: string) => { insert: (v: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } };
  const admin = supabaseAdmin as unknown as Insertable;
  const { error } = await admin.from("product_stock_movements").insert({
    product_id: args.productId,
    type: args.type,
    quantity: Math.abs(args.delta),
    previous_stock: product.stock_quantity,
    new_stock: args.newStock,
    reason: args.reason,
    created_by: args.actorId,
  });
  if (error) throw new Error(error.message);
  await supabaseAdmin.from("audit_logs").insert({
    actor_id: args.actorId,
    action: `estoque_${args.type}`,
    module: "pdv_itens",
    entity_type: "product",
    entity_id: args.productId,
    new_data: { previous: product.stock_quantity, next: args.newStock, reason: args.reason } as never,
  });
}

export const registerStockEntry = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv_itens")])
  .inputValidator((d) =>
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().min(1).max(10_000),
      reason: z.string().trim().min(2).max(200),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const p = await fetchProduct(data.productId);
    await applyMovement({
      productId: data.productId,
      type: "entrada",
      delta: data.quantity,
      newStock: p.stock_quantity + data.quantity,
      reason: data.reason,
      actorId: context.userId,
    });
    return { ok: true };
  });

export const registerStockExit = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv_itens")])
  .inputValidator((d) =>
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().min(1).max(10_000),
      reason: z.string().trim().min(2).max(200),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const p = await fetchProduct(data.productId);
    const available =
      p.available_stock_quantity ?? Math.max(0, p.stock_quantity - (p.reserved_stock_quantity ?? 0));
    if (available < data.quantity) throw new Error("Estoque disponivel insuficiente");
    await applyMovement({
      productId: data.productId,
      type: "saida",
      delta: data.quantity,
      newStock: p.stock_quantity - data.quantity,
      reason: data.reason,
      actorId: context.userId,
    });
    return { ok: true };
  });

export const adjustStock = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv_itens")])
  .inputValidator((d) =>
    z.object({
      productId: z.string().uuid(),
      newQuantity: z.number().int().min(0).max(1_000_000),
      reason: z.string().trim().min(2).max(200),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const p = await fetchProduct(data.productId);
    const reserved = p.reserved_stock_quantity ?? 0;
    if (data.newQuantity < reserved) {
      throw new Error(`Ajuste invalido: ${reserved} unidade(s) estao reservadas em comandas abertas.`);
    }
    await applyMovement({
      productId: data.productId,
      type: "ajuste",
      delta: data.newQuantity - p.stock_quantity,
      newStock: data.newQuantity,
      reason: data.reason,
      actorId: context.userId,
    });
    return { ok: true };
  });

export const getProductStockHistory = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv_itens")])
  .inputValidator((d) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    type ListRes = Promise<{ data: StockMovementRecord[] | null; error: { message: string } | null }>;
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (c: string, v: string) => {
            order: (c: string, opts: { ascending: boolean }) => { limit: (n: number) => ListRes };
          };
        };
      };
    };
    const { data: rows, error } = await admin
      .from("product_stock_movements")
      .select("*")
      .eq("product_id", data.productId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
