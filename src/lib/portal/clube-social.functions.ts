import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const lessonIdSchema = z.object({ lessonId: z.string().uuid() });

async function assertMember(supabase: unknown, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data: profile } = await sb
    .from("profiles")
    .select("is_club_member")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.is_club_member) throw new Error("Acesso restrito a membros do Clube.");
}

// ====== Favoritos ======
export const toggleLessonFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => lessonIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    await assertMember(supabase, userId);

    const { data: existing } = await supabase
      .from("club_lesson_favorites")
      .select("id")
      .eq("user_id", userId)
      .eq("lesson_id", data.lessonId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("club_lesson_favorites")
        .delete()
        .eq("user_id", userId)
        .eq("lesson_id", data.lessonId);
      if (error) throw new Error(error.message);
      return { ok: true, favorited: false };
    }
    const { error } = await supabase
      .from("club_lesson_favorites")
      .insert({ user_id: userId, lesson_id: data.lessonId });
    if (error) throw new Error(error.message);
    return { ok: true, favorited: true };
  });

// ====== Comentários ======
export const listLessonComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => lessonIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    await assertMember(supabase, userId);

    const { data: rows, error } = await supabase
      .from("club_lesson_comments")
      .select("id, user_id, lesson_id, parent_id, body, is_hidden, created_at, updated_at")
      .eq("lesson_id", data.lessonId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const userIds = Array.from(
      new Set(((rows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))
    );
    let nameMap = new Map<string, { full_name: string | null; avatar_url: string | null }>();
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);
      nameMap = new Map(
        (profs ?? []).map((p: { id: string; full_name: string | null; avatar_url: string | null }) => [
          p.id,
          { full_name: p.full_name, avatar_url: p.avatar_url },
        ])
      );
    }

    return {
      comments: (rows ?? []).map(
        (r: {
          id: string;
          user_id: string;
          lesson_id: string;
          parent_id: string | null;
          body: string;
          is_hidden: boolean;
          created_at: string;
          updated_at: string;
        }) => ({
          id: r.id,
          user_id: r.user_id,
          parent_id: r.parent_id,
          body: r.body,
          is_hidden: r.is_hidden,
          created_at: r.created_at,
          author_name: nameMap.get(r.user_id)?.full_name ?? "Membro",
          author_avatar: nameMap.get(r.user_id)?.avatar_url ?? null,
          is_mine: r.user_id === userId,
        })
      ),
      currentUserId: userId,
    };
  });

export const addLessonComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        lessonId: z.string().uuid(),
        body: z.string().trim().min(1).max(2000),
        parentId: z.string().uuid().nullable().optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    await assertMember(supabase, userId);

    const { error } = await supabase.from("club_lesson_comments").insert({
      user_id: userId,
      lesson_id: data.lessonId,
      parent_id: data.parentId ?? null,
      body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLessonComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ commentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("club_lesson_comments")
      .delete()
      .eq("id", data.commentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
