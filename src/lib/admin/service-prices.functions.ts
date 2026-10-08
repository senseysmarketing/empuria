import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireModule } from "./auth";
import type { Json } from "@/integrations/supabase/types";

const requireConfig = requireModule("configuracoes");

const db = supabaseAdmin as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (name: string, args: Record<string, unknown>) => any;
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
        "id,slug,title,short_description,description,category,kind,price_cents,currency,online_price_cents,online_currency,display_price_note,is_active,requires_slot,requires_documents,duration_minutes,image_url,archived_at,archived_by",
      )
      .order("category", { ascending: true })
      .order("title", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const serviceInput = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(2).max(120),
  short_description: z.string().trim().max(280).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  image_url: z.string().trim().max(800).nullable().optional(),
  online_price_cents: z.number().int().min(0),
  online_currency: z.literal("EUR").default("EUR"),
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
});

function servicePatch(data: z.infer<typeof serviceInput>) {
  return {
    title: data.title,
    short_description: data.short_description ?? null,
    description: data.description ?? null,
    image_url: data.image_url ?? null,
    price_cents: data.online_price_cents,
    currency: "EUR",
    online_price_cents: data.online_price_cents,
    online_currency: "EUR",
    display_price_note: data.display_price_note ?? null,
    is_active: data.is_active,
    requires_slot: data.requires_slot,
    requires_documents: data.requires_documents,
    duration_minutes: data.requires_slot ? (data.duration_minutes ?? null) : null,
  };
}

async function auditService(actorId: string, action: string, id: string, data: object) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    actor_id: actorId,
    action,
    module: "configuracoes",
    entity_type: "service",
    entity_id: id,
    new_data: data as Json,
  });
  if (error) throw new Error(error.message);
}

function slugify(title: string) {
  return (
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 65) || "servico"
  );
}

export const createServicePrice = createServerFn({ method: "POST" })
  .middleware([requireConfig])
  .inputValidator((d) => serviceInput.omit({ id: true }).parse(d))
  .handler(async ({ data, context }) => {
    const base = slugify(data.title);
    const patch = servicePatch({ ...data, id: crypto.randomUUID() });
    for (let suffix = 1; suffix <= 20; suffix++) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      const { data: created, error } = await db
        .from("services")
        .insert({
          ...patch,
          slug,
          category: "esteira1",
          kind: null,
          requires_booking: data.requires_slot,
        })
        .select("id")
        .single();
      if (!error && created) {
        await auditService(context.userId, "services.create", created.id, { ...patch, slug });
        return { id: created.id as string };
      }
      if (error?.code !== "23505") throw new Error(error?.message ?? "Erro ao criar serviço");
    }
    throw new Error("Não foi possível gerar um slug único para o serviço");
  });

export const updateServicePrice = createServerFn({ method: "POST" })
  .middleware([requireConfig])
  .inputValidator((d) => serviceInput.parse(d))
  .handler(async ({ data, context }) => {
    const patch = servicePatch(data);
    const { data: updated, error } = await db
      .from("services")
      .update(patch)
      .eq("id", data.id)
      .is("archived_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Serviço não encontrado ou arquivado");
    await auditService(context.userId, "services.update", data.id, patch);
    return { ok: true };
  });

export const toggleServiceActive = createServerFn({ method: "POST" })
  .middleware([requireConfig])
  .inputValidator((d) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await db
      .from("services")
      .update({ is_active: data.is_active })
      .eq("id", data.id)
      .is("archived_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Serviço não encontrado ou arquivado");
    await auditService(
      context.userId,
      data.is_active ? "services.activated" : "services.deactivated",
      data.id,
      { is_active: data.is_active },
    );
    return { ok: true };
  });

export const manageServiceArchive = createServerFn({ method: "POST" })
  .middleware([requireConfig])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), action: z.enum(["archive", "restore", "delete"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await db.rpc("service_archive_restore_or_delete", {
      p_service_id: data.id,
      p_actor: context.userId,
      p_action: data.action,
    });
    if (error) throw new Error(error.message);
    return { result: result as "archived" | "restored" | "deleted" };
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
