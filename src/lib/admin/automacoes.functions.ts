import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";

export const listAutomations = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("automation_triggers")
      .select("*")
      .order("created_at", { ascending: true });
    return data ?? [];
  });

export const updateAutomation = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      is_enabled: z.boolean().optional(),
      template: z.string().max(4000).optional(),
      channel: z.enum(["whatsapp", "email", "painel"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.is_enabled !== undefined) patch.is_enabled = data.is_enabled;
    if (data.template !== undefined) patch.template = data.template;
    if (data.channel) patch.channel = data.channel;
    const { error } = await context.supabase.from("automation_triggers").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
