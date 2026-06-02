import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff, requireAdmin } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createOrReuseManualCustomer } from "./manual-users";


export const ALL_MODULES = [
  "cockpit",
  "pdv",
  "eventos",
  "esteira",
  "crm",
  "triagem",
  "agenda",
  "usuarios",
  "clube",
  "slots",
  "configuracoes",
  "pdv_itens",
  "automacoes",
  "logs",
] as const;
export type ModuleKey = (typeof ALL_MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  cockpit: "Cockpit",
  pdv: "PDV",
  eventos: "Eventos",
  esteira: "Esteira",
  crm: "CRM",
  triagem: "Triagem",
  agenda: "Agenda",
  usuarios: "Usuários",
  clube: "Clube",
  slots: "Slots",
  configuracoes: "Configurações",
  pdv_itens: "PDV Itens",
  automacoes: "Automações",
  logs: "Logs & Auditoria",
};

/** Returns the modules the current user can access. Admins get all. */
export const getMyModuleAccess = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    if (context.isAdmin) {
      return { isAdmin: true, modules: [...ALL_MODULES] as string[] };
    }
    const { data, error } = await supabaseAdmin
      .from("staff_module_permissions")
      .select("module_key")
      .eq("user_id", context.userId)
      .eq("is_allowed", true);
    if (error) throw new Error(error.message);
    return { isAdmin: false, modules: (data ?? []).map((r) => r.module_key) };
  });

/** Admin-only: list staff users + their per-module permission matrix. */
export const listStaffWithPermissions = createServerFn({ method: "GET" })
  .middleware([requireAdmin()])
  .handler(async () => {
    const { data: roles, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "staff"]);
    if (rolesErr) throw new Error(rolesErr.message);

    const userIds = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
    const [{ data: profiles }, { data: perms }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, avatar_url").in("id", userIds),
      supabaseAdmin
        .from("staff_module_permissions")
        .select("user_id, module_key, is_allowed")
        .in("user_id", userIds),
    ]);

    const roleByUser = new Map<string, "admin" | "staff">();
    for (const r of roles ?? []) {
      const prev = roleByUser.get(r.user_id);
      if (r.role === "admin" || !prev) roleByUser.set(r.user_id, r.role as "admin" | "staff");
    }

    const permByUser = new Map<string, Set<string>>();
    for (const p of perms ?? []) {
      if (!p.is_allowed) continue;
      if (!permByUser.has(p.user_id)) permByUser.set(p.user_id, new Set());
      permByUser.get(p.user_id)!.add(p.module_key);
    }

    return (profiles ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
      role: roleByUser.get(p.id) ?? "staff",
      allowed_modules: Array.from(permByUser.get(p.id) ?? []),
    }));
  });

export const setStaffPermission = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((d) =>
    z
      .object({
        user_id: z.string().uuid(),
        module_key: z.enum(ALL_MODULES),
        is_allowed: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("staff_module_permissions")
      .upsert(
        { user_id: data.user_id, module_key: data.module_key, is_allowed: data.is_allowed },
        { onConflict: "user_id,module_key" },
      );
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: data.is_allowed ? "permission.grant" : "permission.revoke",
      module: "configuracoes",
      entity_type: "staff_module_permission",
      entity_id: null,
      new_data: { user_id: data.user_id, module_key: data.module_key, is_allowed: data.is_allowed },
    });
    return { ok: true };
  });

export const createStaffMember = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((d) =>
    z
      .object({
        full_name: z.string().trim().min(2).max(160),
        email: z.string().trim().email().max(255),
        phone: z.string().trim().max(40).optional().or(z.literal("")),
        role: z.enum(["staff", "admin"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const customer = await createOrReuseManualCustomer({
      fullName: data.full_name,
      email: data.email,
      phone: data.phone ? data.phone : null,
      origin: "admin_created",
      actorId: context.userId,
    });

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: customer.user_id, role: data.role },
        { onConflict: "user_id,role" },
      );
    if (roleError) throw new Error(roleError.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: customer.created ? "staff.created" : "staff.role_granted",
      module: "configuracoes",
      entity_type: "user_role",
      entity_id: customer.user_id,
      new_data: {
        email: customer.email,
        full_name: customer.full_name,
        role: data.role,
        password_setup_required: customer.password_setup_required,
      },
    });

    return {
      user_id: customer.user_id,
      created: customer.created,
      role: data.role,
      password_setup_required: customer.password_setup_required,
    };
  });

