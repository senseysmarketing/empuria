import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LEGACY_ENUM = ["bebida", "comida", "barbearia", "outro"] as const;
type LegacyEnum = (typeof LEGACY_ENUM)[number];

async function resolveLegacyEnum(categoryId: string): Promise<LegacyEnum> {
  const { data } = await supabaseAdmin
    .from("product_categories")
    .select("slug")
    .eq("id", categoryId)
    .maybeSingle();
  const slug = data?.slug as string | undefined;
  if (slug && (LEGACY_ENUM as readonly string[]).includes(slug)) return slug as LegacyEnum;
  return "outro";
}

export const listPdvItems = createServerFn({ method: "GET" })
  .middleware([requireModule("pdv_itens")])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("*, product_categories(id, slug, name, emoji)")
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const itemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9_-]+$/, "Use apenas letras minúsculas, números, - ou _"),
  price_cents: z.number().int().min(0).max(10_000_000),
  price_eur_cents: z.number().int().min(0).max(10_000_000).default(0),
  price_brl_cents: z.number().int().min(0).max(10_000_000).default(0),
  category_id: z.string().uuid(),
  emoji: z.string().trim().max(32).nullable().optional(),
  is_active: z.boolean().default(true),
  position: z.number().int().min(0).max(9999).default(0),
  item_type: z.enum(["produto", "servico"]).default("produto"),
  track_stock: z.boolean().default(false),
  stock_min_quantity: z.number().int().min(0).max(1_000_000).default(0),
});

function friendlyItemError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("Já existe um item com este nome.");
  return new Error(error.message);
}

export const createPdvItem = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv_itens")])
  .inputValidator((d) => itemSchema.parse(d))
  .handler(async ({ data, context }) => {
    const legacy = await resolveLegacyEnum(data.category_id);
    const { data: row, error } = await supabaseAdmin
      .from("products")
      .insert({ ...data, category: legacy })
      .select("id")
      .single();
    if (error) throw friendlyItemError(error);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "pdv_item.created",
      module: "pdv_itens",
      entity_type: "product",
      entity_id: row.id,
      new_data: data,
    });
    return { id: row.id };
  });

export const updatePdvItem = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv_itens")])
  .inputValidator((d) => itemSchema.partial().extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: old } = await supabaseAdmin.from("products").select("*").eq("id", id).maybeSingle();
    const finalPatch = { ...patch } as typeof patch & { category?: LegacyEnum };
    if (patch.category_id) {
      finalPatch.category = await resolveLegacyEnum(patch.category_id);
    }
    const { error } = await supabaseAdmin.from("products").update(finalPatch).eq("id", id);
    if (error) throw friendlyItemError(error);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "pdv_item.updated",
      module: "pdv_itens",
      entity_type: "product",
      entity_id: id,
      old_data: old as never,
      new_data: patch as never,
    });
    return { ok: true };
  });

export const deletePdvItem = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv_itens")])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin.from("products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "pdv_item.deleted",
      module: "pdv_itens",
      entity_type: "product",
      entity_id: data.id,
    });
    return { ok: true };
  });
