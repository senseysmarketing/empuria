import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: unknown, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data: isStaff } = await sb.rpc("is_staff", { _user_id: userId });
  const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isStaff && !isAdmin) throw new Error("Acesso restrito.");
}

export const listAllComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    await assertAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;

    const { data: comments } = await sb
      .from("club_lesson_comments")
      .select("id, user_id, lesson_id, body, is_hidden, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    const rows = (comments ?? []) as Array<{
      id: string;
      user_id: string;
      lesson_id: string;
      body: string;
      is_hidden: boolean;
      created_at: string;
    }>;

    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const lessonIds = Array.from(new Set(rows.map((r) => r.lesson_id)));

    const [profRes, lessonRes, favRes, certRes] = await Promise.all([
      userIds.length
        ? sb.from("profiles").select("id, full_name").in("id", userIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      lessonIds.length
        ? sb.from("club_lessons").select("id, title").in("id", lessonIds)
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      sb.from("club_lesson_favorites").select("id", { count: "exact", head: true }),
      sb.from("club_certificates").select("id", { count: "exact", head: true }),
    ]);

    const nameMap = new Map(
      ((profRes.data ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name])
    );
    const lessonMap = new Map(
      ((lessonRes.data ?? []) as Array<{ id: string; title: string }>).map((l) => [l.id, l.title])
    );

    return {
      comments: rows.map((r) => ({
        ...r,
        author_name: nameMap.get(r.user_id) ?? "Membro",
        lesson_title: lessonMap.get(r.lesson_id) ?? "Aula",
      })),
      stats: {
        totalComments: rows.length,
        hiddenComments: rows.filter((r) => r.is_hidden).length,
        totalFavorites: ((favRes as { count: number | null }).count ?? 0) as number,
        totalCertificates: ((certRes as { count: number | null }).count ?? 0) as number,
      },
    };
  });

export const setCommentHidden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ commentId: z.string().uuid(), hidden: z.boolean() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    await assertAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { error } = await sb
      .from("club_lesson_comments")
      .update({ is_hidden: data.hidden })
      .eq("id", data.commentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCommentAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ commentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    await assertAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { error } = await sb.from("club_lesson_comments").delete().eq("id", data.commentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
