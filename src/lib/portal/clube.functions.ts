import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getClubContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    const [profileRes, contentRes] = await Promise.all([
      supabase.from("profiles").select("is_club_member").eq("id", userId).maybeSingle(),
      supabase
        .from("club_content")
        .select("id, title, description, module, thumbnail_url, video_url, position, is_published")
        .eq("is_published", true)
        .order("module", { ascending: true })
        .order("position", { ascending: true }),
    ]);

    const isMember = !!profileRes.data?.is_club_member;
    const items = contentRes.data ?? [];
    const modules = Array.from(new Set(items.map((i) => i.module))).map((mod) => ({
      module: mod,
      items: items.filter((i) => i.module === mod),
    }));
    return { isMember, modules };
  });
