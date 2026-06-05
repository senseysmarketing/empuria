import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireModule } from "./auth";
import type { Json } from "@/integrations/supabase/types";

const requireConfig = requireModule("configuracoes");

const db = supabaseAdmin as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

const BUCKET = "service-images";

async function ensureBucket() {
  try {
    const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
    if (data) return;
  } catch {
    /* fallthrough */
  }
  await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 4 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
}

export const listServicePrices = createServerFn({ method: "GET" })
  .middleware([requireConfig])
  .handler(async () => {
    const { data, error } = await db
      .from("services")
      .select(
        "id,slug,title,short_description,description,category,kind,price_cents,currency,online_price_cents,online_currency,display_price_note,is_active,requires_slot,requires_documents,duration_minutes,image_url",
      )
      .order("category", { ascending: true })
      .order("title", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateServicePrice = createServerFn({ method: "POST" })
  .middleware([requireConfig])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().trim().min(2).max(120),
        short_description: z.string().trim().max(280).nullable().optional(),
        description: z.string().trim().max(4000).nullable().optional(),
        image_url: z.string().trim().max(800).nullable().optional(),
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
      title: data.title,
      short_description: data.short_description ?? null,
      description: data.description ?? null,
      image_url: data.image_url ?? null,
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
      action: "services.update",
      module: "configuracoes",
      entity_type: "service",
      entity_id: data.id,
      new_data: patch as Json,
    });
    return { ok: true };
  });

export const toggleServiceActive = createServerFn({ method: "POST" })
  .middleware([requireConfig])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db
      .from("services")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: data.is_active ? "services.activated" : "services.deactivated",
      module: "configuracoes",
      entity_type: "service",
      entity_id: data.id,
      new_data: { is_active: data.is_active } as Json,
    });
    return { ok: true };
  });

export const createServiceImageUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireConfig])
  .inputValidator((d) =>
    z
      .object({
        service_id: z.string().uuid(),
        filename: z.string().min(1).max(180),
        content_type: z.string().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await ensureBucket();
    const ext = data.filename.split(".").pop()?.toLowerCase() ?? "jpg";
    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const path = `services/${data.service_id}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}-${safeName}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    return {
      bucket: BUCKET,
      path,
      token: signed?.token,
      uploadUrl: signed?.signedUrl,
      publicUrl: pub.publicUrl,
      ext,
    };
  });
