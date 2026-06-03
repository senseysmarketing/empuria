import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireModule } from "./auth";
import type { Json } from "@/integrations/supabase/types";

const db = supabaseAdmin as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export const listServicePrices = createServerFn({ method: "GET" })
  .middleware([requireModule("configuracoes")])
  .handler(async () => {
    const { data, error } = await db
      .from("services")
      .select(
        "id,slug,title,category,kind,price_cents,currency,online_price_cents,online_currency,display_price_note,is_active,requires_slot,requires_documents,duration_minutes",
      )
      .order("category", { ascending: true })
      .order("title", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateServicePrice = createServerFn({ method: "POST" })
  .middleware([requireModule("configuracoes")])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        online_price_cents: z.number().int().min(0),
        online_currency: z.enum(["BRL", "EUR", "USD"]).default("BRL"),
        display_price_note: z.string().trim().max(180).nullable().optional(),
        is_active: z.boolean(),
        requires_slot: z.boolean(),
        requires_documents: z.boolean(),
        duration_minutes: z
          .number()
          .int()
          .min(0)
          .max(24 * 60)
          .nullable()
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch = {
      online_price_cents: data.online_price_cents,
      online_currency: data.online_currency,
      display_price_note: data.display_price_note ?? null,
      is_active: data.is_active,
      requires_slot: data.requires_slot,
      requires_documents: data.requires_documents,
      duration_minutes: data.duration_minutes ?? null,
    };
    const { error } = await db.from("services").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "services.price.update",
      module: "configuracoes",
      entity_type: "service",
      entity_id: data.id,
      new_data: patch as Json,
    });
    return { ok: true };
  });
