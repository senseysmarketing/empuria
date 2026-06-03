import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const requireClube = requireModule("clube");

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

export const getClubData = createServerFn({ method: "GET" })
  .middleware([requireClube])
  .handler(async ({ context }) => {
    const [members, content, posts] = await Promise.all([
      context.supabase.from("profiles").select("id,full_name,is_club_member,created_at,phone").order("created_at", { ascending: false }).limit(300),
      context.supabase.from("club_content").select("*").order("module").order("position"),
      context.supabase.from("community_posts").select("*").order("is_pinned", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    ]);
    return {
      members: members.data ?? [],
      content: content.data ?? [],
      posts: posts.data ?? [],
    };
  });

export const toggleMembership = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ id: z.string().uuid(), is_member: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ is_club_member: data.is_member })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertContent = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid().optional(),
      title: z.string().trim().min(2).max(160),
      description: z.string().max(2000).optional(),
      module: z.string().trim().min(1).max(80),
      video_url: z.string().url().optional().or(z.literal("")),
      thumbnail_url: z.string().url().optional().or(z.literal("")),
      position: z.number().int().min(0).default(0),
      is_published: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      title: data.title,
      description: data.description ?? null,
      module: data.module,
      video_url: data.video_url || null,
      thumbnail_url: data.thumbnail_url || null,
      position: data.position,
      is_published: data.is_published,
      created_by: context.userId,
    };
    if (data.id) {
      const { data: old } = await context.supabase.from("club_content").select("*").eq("id", data.id).maybeSingle();
      const { error } = await context.supabase.from("club_content").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      await audit({
        actor_id: context.userId,
        action: old?.is_published !== payload.is_published
          ? (payload.is_published ? "clube.content.published" : "clube.content.unpublished")
          : "clube.content.updated",
        entity_type: "club_content",
        entity_id: data.id,
        old_data: old,
        new_data: payload,
      });
    } else {
      const { data: row, error } = await context.supabase.from("club_content").insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      await audit({
        actor_id: context.userId,
        action: "clube.content.created",
        entity_type: "club_content",
        entity_id: row?.id,
        new_data: payload,
      });
    }
    return { ok: true };
  });

export const togglePublishContent = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ id: z.string().uuid(), is_published: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("club_content")
      .update({ is_published: data.is_published })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit({
      actor_id: context.userId,
      action: data.is_published ? "clube.content.published" : "clube.content.unpublished",
      entity_type: "club_content",
      entity_id: data.id,
      new_data: { is_published: data.is_published },
    });
    return { ok: true };
  });

export const reorderContent = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) =>
    z.object({
      items: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(0) })).min(1).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    for (const it of data.items) {
      const { error } = await context.supabase
        .from("club_content")
        .update({ position: it.position })
        .eq("id", it.id);
      if (error) throw new Error(error.message);
    }
    await audit({
      actor_id: context.userId,
      action: "clube.content.reordered",
      entity_type: "club_content",
      new_data: { count: data.items.length },
    });
    return { ok: true };
  });

export const deleteContent = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: old } = await context.supabase.from("club_content").select("*").eq("id", data.id).maybeSingle();
    const { error } = await context.supabase.from("club_content").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit({
      actor_id: context.userId,
      action: "clube.content.deleted",
      entity_type: "club_content",
      entity_id: data.id,
      old_data: old,
    });
    return { ok: true };
  });

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) =>
    z.object({
      body: z.string().trim().min(2).max(4000),
      is_pinned: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("full_name").eq("id", context.userId).maybeSingle();
    const { data: row, error } = await context.supabase.from("community_posts").insert({
      author_id: context.userId,
      author_name: prof?.full_name ?? "Equipe Empuria",
      body: data.body,
      is_pinned: data.is_pinned,
    }).select("id").single();
    if (error) throw new Error(error.message);
    await audit({
      actor_id: context.userId,
      action: "clube.post.created",
      entity_type: "community_post",
      entity_id: row?.id,
      new_data: { is_pinned: data.is_pinned, body_length: data.body.length },
    });
    return { ok: true };
  });

export const togglePinPost = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ id: z.string().uuid(), pin: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("community_posts").update({ is_pinned: data.pin }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit({
      actor_id: context.userId,
      action: data.pin ? "clube.post.pinned" : "clube.post.unpinned",
      entity_type: "community_post",
      entity_id: data.id,
    });
    return { ok: true };
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireClube])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: old } = await context.supabase.from("community_posts").select("*").eq("id", data.id).maybeSingle();
    const { error } = await context.supabase.from("community_posts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit({
      actor_id: context.userId,
      action: "clube.post.deleted",
      entity_type: "community_post",
      entity_id: data.id,
      old_data: old,
    });
    return { ok: true };
  });
