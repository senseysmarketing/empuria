import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireModule("pdv_itens")])
  .handler(async () => {
    const { data: cats, error } = await supabaseAdmin
      .from("product_categories")
      .select("*")
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (cats ?? []).map((c) => c.id);
    let counts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: prods } = await supabaseAdmin
        .from("products")
        .select("category_id");
      counts = (prods ?? []).reduce<Record<string, number>>((acc, p) => {
        if (p.category_id) acc[p.category_id] = (acc[p.category_id] ?? 0) + 1;
        return acc;
      }, {});
    }

    return (cats ?? []).map((c) => ({ ...c, item_count: counts[c.id] ?? 0 }));
  });

const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/, "Use apenas letras minúsculas, números, - ou _"),
  emoji: z.string().trim().max(8).nullable().optional(),
  position: z.number().int().min(0).max(9999).default(0),
  is_active: z.boolean().default(true),
});

export const createCategory = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv_itens")])
  .inputValidator((d) => categorySchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await supabaseAdmin
      .from("product_categories")
      .insert(data)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "pdv_category.created",
      module: "pdv_itens",
      entity_type: "product_category",
      entity_id: row.id,
      new_data: data,
    });
    return { id: row.id };
  });

export const updateCategory = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv_itens")])
  .inputValidator((d) => categorySchema.partial().extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: old } = await supabaseAdmin.from("product_categories").select("*").eq("id", id).maybeSingle();
    const { error } = await supabaseAdmin.from("product_categories").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "pdv_category.updated",
      module: "pdv_itens",
      entity_type: "product_category",
      entity_id: id,
      old_data: old as never,
      new_data: patch as never,
    });
    return { ok: true };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv_itens")])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { count, error: countErr } = await supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", data.id);
    if (countErr) throw new Error(countErr.message);
    if ((count ?? 0) > 0) {
      throw new Error(
        `Existem ${count} item(ns) nesta categoria. Mova ou exclua os itens antes de remover a categoria.`,
      );
    }
    const { error } = await supabaseAdmin.from("product_categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "pdv_category.deleted",
      module: "pdv_itens",
      entity_type: "product_category",
      entity_id: data.id,
    });
    return { ok: true };
  });
