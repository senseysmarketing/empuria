import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  scope: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(8000).optional().nullable(),
  url: z.string().max(2000).optional().nullable(),
  user_agent: z.string().max(1000).optional().nullable(),
  app_version: z.string().max(120).optional().nullable(),
  extra: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const reportClientError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => schema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let userLabel: string | null = null;
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", context.userId)
        .maybeSingle();
      userLabel = prof?.full_name ?? null;
    } catch {
      /* ignore */
    }
    console.error("[client-error]", {
      userId: context.userId,
      userLabel,
      scope: data.scope,
      message: data.message,
      url: data.url,
    });
    const { error } = await supabaseAdmin.from("client_error_logs").insert({
      user_id: context.userId,
      user_label: userLabel,
      scope: data.scope,
      message: data.message,
      stack: data.stack ?? null,
      url: data.url ?? null,
      user_agent: data.user_agent ?? null,
      app_version: data.app_version ?? null,
      extra: (data.extra ?? null) as never,
    });
    if (error) {
      console.error("[client-error] insert failed", error);
    }
    return { ok: true };
  });
