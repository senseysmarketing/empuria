import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export const getClubContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;

    const [profileRes, modulesRes, lessonsRes, filesRes, settingsRes, postsRes] = await Promise.all([
      supabase.from("profiles").select("is_club_member, full_name").eq("id", userId).maybeSingle(),
      supabase
        .from("club_modules")
        .select("id, title, slug, description, cover_url, position")
        .eq("is_published", true)
        .order("position", { ascending: true }),
      supabase
        .from("club_lessons")
        .select("id, module_id, title, description, video_url, video_provider, video_file_id, video_embed_url, video_source_url, thumbnail_url, duration_minutes, position, is_featured, published_at")
        .eq("is_published", true)
        .order("position", { ascending: true }),
      supabase
        .from("club_lesson_files")
        .select("id, lesson_id, label, file_url, file_type, size_bytes, position")
        .order("position", { ascending: true }),
      supabase.from("club_settings").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("community_posts")
        .select("id, author_name, body, is_pinned, created_at")
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const isMember = !!profileRes.data?.is_club_member;
    const memberName = (profileRes.data as { full_name?: string | null } | null)?.full_name ?? null;

    const [{ data: subscription }, { data: setting }] = await Promise.all([
      db
        .from("club_subscriptions")
        .select("status, access_status, current_period_end, last_payment_at, next_billing_at, canceled_at")
        .eq("user_id", userId)
        .eq("provider", "hubla")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("integration_settings")
        .select("is_enabled, checkout_url, whatsapp_group_url")
        .eq("provider", "hubla")
        .maybeSingle(),
    ]);

    type LessonRow = {
      id: string;
      module_id: string;
      title: string;
      description: string | null;
      video_url: string | null;
      video_provider: string | null;
      video_file_id: string | null;
      video_embed_url: string | null;
      video_source_url: string | null;
      thumbnail_url: string | null;
      duration_minutes: number | null;
      position: number;
      is_featured: boolean;
      published_at: string | null;
    };
    const allLessons = (lessonsRes.data ?? []) as LessonRow[];
    const allFiles = (filesRes.data ?? []) as Array<{ id: string; lesson_id: string; label: string; file_url: string; file_type: string; size_bytes: number | null; position: number }>;

    const modules = (modulesRes.data ?? []).map((m: { id: string; title: string; slug: string; description: string | null; cover_url: string | null; position: number }) => {
      const lessons = allLessons
        .filter((l) => l.module_id === m.id)
        .map((l) => ({
          id: l.id,
          module_id: l.module_id,
          title: l.title,
          description: l.description,
          thumbnail_url: l.thumbnail_url,
          duration_minutes: l.duration_minutes,
          position: l.position,
          is_featured: l.is_featured,
          published_at: l.published_at,
          // Para não-membros, removemos os campos que permitiriam reproduzir o vídeo
          video_url: isMember ? l.video_url : null,
          video_provider: l.video_provider, // o tipo pode ser exposto, ajuda UI a mostrar badges
          video_file_id: isMember ? l.video_file_id : null,
          video_embed_url: isMember ? l.video_embed_url : null,
          video_source_url: isMember ? l.video_source_url : null,
          files: isMember ? allFiles.filter((f) => f.lesson_id === l.id) : [],
        }));
      return { ...m, lessons };
    });

    return {
      isMember,
      memberName,
      settings: settingsRes.data ?? null,
      modules,
      posts: postsRes.data ?? [],
      subscription: subscription ?? null,
      hubla: {
        isEnabled: !!setting?.is_enabled,
        checkoutUrl: setting?.checkout_url ?? null,
        whatsappGroupUrl: setting?.whatsapp_group_url ?? null,
      },
    };
  });
