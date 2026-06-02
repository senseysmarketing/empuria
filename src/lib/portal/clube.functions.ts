import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as unknown as {
  // Hubla tables are introduced by a migration before generated Supabase types are refreshed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

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
    const [{ data: subscription }, { data: setting }] = await Promise.all([
      db
        .from("club_subscriptions")
        .select(
          "status, access_status, current_period_end, last_payment_at, next_billing_at, canceled_at",
        )
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
    const items = contentRes.data ?? [];
    const modules = Array.from(new Set(items.map((i) => i.module))).map((mod) => ({
      module: mod,
      items: items.filter((i) => i.module === mod),
    }));
    return {
      isMember,
      modules,
      subscription: subscription ?? null,
      hubla: {
        isEnabled: !!setting?.is_enabled,
        checkoutUrl: setting?.checkout_url ?? null,
        whatsappGroupUrl: setting?.whatsapp_group_url ?? null,
      },
    };
  });
