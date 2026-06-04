import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const lessonIdSchema = z.object({ lessonId: z.string().uuid() });

export const markLessonOpened = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => lessonIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = context.userId;

    // Gate: precisa ser membro ativo
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_club_member")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.is_club_member) {
      throw new Error("Acesso restrito a membros do Clube.");
    }

    // Gate: aula precisa existir, estar publicada e não ser "em breve"
    const { data: lesson } = await supabase
      .from("club_lessons")
      .select("id, is_published, is_coming_soon")
      .eq("id", data.lessonId)
      .maybeSingle();
    const l = lesson as { id: string; is_published: boolean; is_coming_soon?: boolean } | null;
    if (!l || !l.is_published || l.is_coming_soon) {
      throw new Error("Aula indisponível.");
    }

    const row = {
      user_id: userId,
      lesson_id: data.lessonId,
      opened_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("club_lesson_progress")
      .upsert(row, { onConflict: "user_id,lesson_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleLessonCompleted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => lessonIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = context.userId;

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_club_member")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.is_club_member) {
      throw new Error("Acesso restrito a membros do Clube.");
    }

    const { data: existing } = await supabase
      .from("club_lesson_progress")
      .select("completed_at")
      .eq("user_id", userId)
      .eq("lesson_id", data.lessonId)
      .maybeSingle();

    const current = (existing as { completed_at: string | null } | null)?.completed_at ?? null;
    const next = current ? null : new Date().toISOString();

    const row = {
      user_id: userId,
      lesson_id: data.lessonId,
      opened_at: new Date().toISOString(),
      completed_at: next,
    };
    const { error } = await supabase
      .from("club_lesson_progress")
      .upsert(row, { onConflict: "user_id,lesson_id" });
    if (error) throw new Error(error.message);
    return { ok: true, completed: !!next };
  });
