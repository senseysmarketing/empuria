import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CATEGORIES = ["bebida", "comida", "cafeteria", "drink", "experiencia", "outro"] as const;

export const listPdvItems = createServerFn({ method: "GET" })
  .middleware([requireModule("pdv_itens")])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("*")
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const itemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9_-]+$/, "Use apenas letras minúsculas, números, - ou _"),
  price_cents: z.number().int().min(0).max(10_000_000),
  category: z.enum(CATEGORIES),
  emoji: z.string().trim().max(8).nullable().optional(),
  is_active: z.boolean().default(true),
  position: z.number().int().min(0).max(9999).default(0),
});

export const createPdvItem = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv_itens")])
  .inputValidator((d) => itemSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await supabaseAdmin.from("products").insert(data).select("id").single();
    if (error) throw new Error(error.message);
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
    const { error } = await supabaseAdmin.from("products").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
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
