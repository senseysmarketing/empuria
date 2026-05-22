import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";

export const getClubData = createServerFn({ method: "GET" })
  .middleware([requireStaff])
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
  .middleware([requireStaff])
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
  .middleware([requireStaff])
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
    const { error } = data.id
      ? await context.supabase.from("club_content").update(payload).eq("id", data.id)
      : await context.supabase.from("club_content").insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteContent = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("club_content").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      body: z.string().trim().min(2).max(4000),
      is_pinned: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("full_name").eq("id", context.userId).maybeSingle();
    const { error } = await context.supabase.from("community_posts").insert({
      author_id: context.userId,
      author_name: prof?.full_name ?? "Equipe Empuria",
      body: data.body,
      is_pinned: data.is_pinned,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const togglePinPost = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid(), pin: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("community_posts").update({ is_pinned: data.pin }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("community_posts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
