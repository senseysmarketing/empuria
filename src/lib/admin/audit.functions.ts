import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((d) =>
    z.object({
      module: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    let q = supabaseAdmin
      .from("audit_logs")
      .select("id, actor_id, action, module, entity_type, entity_id, new_data, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.module) q = q.eq("module", data.module);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const actorIds = Array.from(new Set((rows ?? []).map((r) => r.actor_id).filter((x): x is string => !!x)));
    const names = new Map<string, string>();
    if (actorIds.length) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", actorIds);
      for (const p of profs ?? []) names.set(p.id, p.full_name ?? "—");
    }
    return (rows ?? []).map((r) => ({ ...r, actor_name: r.actor_id ? names.get(r.actor_id) ?? null : null }));
  });

export const listImpersonationLogs = createServerFn({ method: "GET" })
  .middleware([requireAdmin()])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("impersonation_logs")
      .select("id, admin_id, target_user_id, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set([...(data ?? []).map((r) => r.admin_id), ...(data ?? []).map((r) => r.target_user_id)]));
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids);
      for (const p of profs ?? []) names.set(p.id, p.full_name ?? "—");
    }
    return (data ?? []).map((r) => ({
      ...r,
      admin_name: names.get(r.admin_id) ?? null,
      target_name: names.get(r.target_user_id) ?? null,
    }));
  });
