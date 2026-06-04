import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildVideoFromUrl } from "@/lib/clube/video-provider";

const requireClube = requireModule("clube");

const BUCKET = "club-files";

async function ensureBucket() {
  // Idempotent: create if missing.
  try {
    const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
    if (data) return;
  } catch {
    /* fallthrough */
  }
  await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
}

async function audit(params: {
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  old_data?: unknown;
  new_data?: unknown;
}) {
  await supabaseAdmin.from("audit_logs").insert({
    actor_id: params.actor_id,
    action: params.action,
    module: "clube",
    entity_type: params.entity_type,
    entity_id: params.entity_id ?? null,
    old_data: (params.old_data ?? null) as never,
    new_data: (params.new_data ?? null) as never,
  });
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || `m-${Date.now().toString(36)}`;
}

// ============== READ ==============

export const getCurriculum = createServerFn({ method: "GET" })
  .middleware([requireClube])
  .handler(async ({ context }) => {
    const [modulesRes, lessonsRes, filesRes, settingsRes] = await Promise.all([
      context.supabase.from("club_modules").select("*").order("position").order("created_at"),
      context.supabase.from("club_lessons").select("*").order("position").order("created_at"),
      context.supabase.from("club_lesson_files").select("*").order("position").order("created_at"),
      context.supabase.from("club_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    return {
      modules: modulesRes.data ?? [],
      lessons: lessonsRes.data ?? [],
      files: filesRes.data ?? [],
      settings: settingsRes.data ?? null,
    };
  });

// ============== MODULES ==============

const moduleSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(80).optional(),
  description: z.string().max(2000).optional(),
  cover_url: z.string().url().optional().or(z.literal("")),
  position: z.number().int().min(0).default(0),
  is_published: z.boolean().default(false),
});

export const upsertModule = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => moduleSchema.parse(d))
  .handler(async ({ data, context }) => {
    const payload = {
      title: data.title,
      slug: (data.slug && data.slug.length ? data.slug : slugify(data.title)),
      description: data.description ?? null,
      cover_url: data.cover_url || null,
      position: data.position,
      is_published: data.is_published,
      created_by: context.userId,
    };
    if (data.id) {
      const { data: old } = await context.supabase.from("club_modules").select("*").eq("id", data.id).maybeSingle();
      const { error } = await context.supabase.from("club_modules").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      await audit({ actor_id: context.userId, action: "clube.module.updated", entity_type: "club_module", entity_id: data.id, old_data: old, new_data: payload });
    } else {
      const { data: row, error } = await context.supabase.from("club_modules").insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      await audit({ actor_id: context.userId, action: "clube.module.created", entity_type: "club_module", entity_id: row?.id, new_data: payload });
    }
    return { ok: true };
  });

export const toggleModulePublish = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ id: z.string().uuid(), is_published: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("club_modules").update({ is_published: data.is_published }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit({ actor_id: context.userId, action: data.is_published ? "clube.module.published" : "clube.module.unpublished", entity_type: "club_module", entity_id: data.id, new_data: { is_published: data.is_published } });
    return { ok: true };
  });

export const reorderModules = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ items: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(0) })).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    for (const it of data.items) {
      const { error } = await context.supabase.from("club_modules").update({ position: it.position }).eq("id", it.id);
      if (error) throw new Error(error.message);
    }
    await audit({ actor_id: context.userId, action: "clube.module.reordered", entity_type: "club_module", new_data: { count: data.items.length } });
    return { ok: true };
  });

export const deleteModule = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: old } = await context.supabase.from("club_modules").select("*").eq("id", data.id).maybeSingle();
    const { error } = await context.supabase.from("club_modules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit({ actor_id: context.userId, action: "clube.module.deleted", entity_type: "club_module", entity_id: data.id, old_data: old });
    return { ok: true };
  });

// ============== LESSONS ==============

const lessonSchema = z.object({
  id: z.string().uuid().optional(),
  module_id: z.string().uuid(),
  title: z.string().trim().min(2).max(160),
  description: z.string().max(4000).optional(),
  video_url: z.string().url().optional().or(z.literal("")),
  video_source_url: z.string().url().optional().or(z.literal("")),
  video_provider: z.string().max(40).optional(),
  thumbnail_url: z.string().url().optional().or(z.literal("")),
  duration_minutes: z.number().int().min(0).max(600).optional(),
  position: z.number().int().min(0).default(0),
  is_published: z.boolean().default(false),
  is_featured: z.boolean().default(false),
  is_coming_soon: z.boolean().default(false),
});

export const upsertLesson = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => lessonSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sourceUrl = (data.video_source_url || data.video_url || "").trim();
    const built = buildVideoFromUrl(sourceUrl);
    const payload = {
      module_id: data.module_id,
      title: data.title,
      description: data.description ?? null,
      video_url: built.source_url, // compat
      video_source_url: built.source_url,
      video_provider: built.provider ?? data.video_provider ?? null,
      video_file_id: built.file_id,
      video_embed_url: built.embed_url,
      thumbnail_url: data.thumbnail_url || null,
      duration_minutes: data.duration_minutes ?? null,
      position: data.position,
      is_published: data.is_published,
      is_featured: data.is_featured,
      is_coming_soon: data.is_coming_soon,
      published_at: data.is_published ? new Date().toISOString() : null,
      created_by: context.userId,
    };
    if (data.id) {
      const { data: old } = await context.supabase.from("club_lessons").select("*").eq("id", data.id).maybeSingle();
      const { error } = await context.supabase.from("club_lessons").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      await audit({ actor_id: context.userId, action: "clube.lesson.updated", entity_type: "club_lesson", entity_id: data.id, old_data: old, new_data: payload });
    } else {
      const { data: row, error } = await context.supabase.from("club_lessons").insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      await audit({ actor_id: context.userId, action: "clube.lesson.created", entity_type: "club_lesson", entity_id: row?.id, new_data: payload });
    }
    return { ok: true };
  });

export const toggleLessonPublish = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ id: z.string().uuid(), is_published: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("club_lessons").update({ is_published: data.is_published, published_at: data.is_published ? new Date().toISOString() : null }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit({ actor_id: context.userId, action: data.is_published ? "clube.lesson.published" : "clube.lesson.unpublished", entity_type: "club_lesson", entity_id: data.id, new_data: { is_published: data.is_published } });
    return { ok: true };
  });

export const reorderLessons = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ module_id: z.string().uuid(), items: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(0) })).min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    for (const it of data.items) {
      const { error } = await context.supabase.from("club_lessons").update({ position: it.position }).eq("id", it.id).eq("module_id", data.module_id);
      if (error) throw new Error(error.message);
    }
    await audit({ actor_id: context.userId, action: "clube.lesson.reordered", entity_type: "club_lesson", entity_id: data.module_id, new_data: { count: data.items.length } });
    return { ok: true };
  });

export const deleteLesson = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: old } = await context.supabase.from("club_lessons").select("*").eq("id", data.id).maybeSingle();
    const { error } = await context.supabase.from("club_lessons").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit({ actor_id: context.userId, action: "clube.lesson.deleted", entity_type: "club_lesson", entity_id: data.id, old_data: old });
    return { ok: true };
  });

// ============== LESSON FILES ==============

const fileSchema = z.object({
  lesson_id: z.string().uuid(),
  label: z.string().trim().min(1).max(160),
  file_url: z.string().url(),
  file_type: z.enum(["pdf", "image", "link", "doc", "video", "other"]).default("other"),
  size_bytes: z.number().int().min(0).optional(),
  position: z.number().int().min(0).default(0),
});

export const addLessonFile = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => fileSchema.parse(d))
  .handler(async ({ data, context }) => {
    const payload = { ...data, size_bytes: data.size_bytes ?? null, created_by: context.userId };
    const { data: row, error } = await context.supabase.from("club_lesson_files").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await audit({ actor_id: context.userId, action: "clube.file.created", entity_type: "club_lesson_file", entity_id: row?.id, new_data: payload });
    return { ok: true };
  });

export const removeLessonFile = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: old } = await context.supabase.from("club_lesson_files").select("*").eq("id", data.id).maybeSingle();
    const { error } = await context.supabase.from("club_lesson_files").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit({ actor_id: context.userId, action: "clube.file.deleted", entity_type: "club_lesson_file", entity_id: data.id, old_data: old });
    return { ok: true };
  });

// ============== UPLOAD ==============

export const createUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) =>
    z.object({
      filename: z.string().min(1).max(180),
      kind: z.enum(["module-cover", "lesson-thumb", "lesson-file", "club-cover"]),
      content_type: z.string().max(120).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    await ensureBucket();
    const ext = data.filename.split(".").pop()?.toLowerCase() ?? "bin";
    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const path = `${data.kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    // Bucket is private; publicUrl is just the canonical path. We return a signed read URL via signed-read endpoint later.
    return {
      bucket: BUCKET,
      path,
      token: signed?.token,
      uploadUrl: signed?.signedUrl,
      canonical: pub.publicUrl,
      ext,
    };
  });

export const getSignedReadUrl = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ path: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(data.path, 60 * 60);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

// ============== SETTINGS ==============

const settingsSchema = z.object({
  public_title: z.string().trim().min(2).max(120),
  public_description: z.string().trim().min(2).max(800),
  cover_url: z.string().url().optional().or(z.literal("")),
  locked_screen_text: z.string().trim().min(2).max(800),
  cta_text: z.string().trim().min(2).max(60),
  benefits: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
});

export const updateClubSettings = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => settingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const payload = {
      public_title: data.public_title,
      public_description: data.public_description,
      cover_url: data.cover_url || null,
      locked_screen_text: data.locked_screen_text,
      cta_text: data.cta_text,
      benefits: data.benefits as unknown as never,
    };
    const { data: old } = await context.supabase.from("club_settings").select("*").eq("id", 1).maybeSingle();
    const { error } = await context.supabase.from("club_settings").update(payload).eq("id", 1);
    if (error) throw new Error(error.message);
    await audit({ actor_id: context.userId, action: "clube.settings.updated", entity_type: "club_settings", entity_id: "1", old_data: old, new_data: payload });
    return { ok: true };
  });
