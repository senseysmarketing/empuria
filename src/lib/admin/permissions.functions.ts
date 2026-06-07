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
  "financeiro",
  "agenda",
  "usuarios",
  "clube",
  "slots",
  "configuracoes",
  "pdv_itens",
  "automacoes",
  "logs",
  "relatorios",
] as const;
export type ModuleKey = (typeof ALL_MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  cockpit: "Cockpit",
  pdv: "PDV",
  eventos: "Eventos",
  esteira: "Esteira",
  crm: "CRM",
  financeiro: "Financeiro",
  agenda: "Agenda",
  usuarios: "Usuários",
  clube: "Clube",
  slots: "Slots",
  configuracoes: "Configurações",
  pdv_itens: "PDV Itens",
  automacoes: "Automações",
  logs: "Logs & Auditoria",
  relatorios: "Relatórios",
};

export const ALL_ACTIONS = [
  "pdv.void_sale",
  "crm.view_all_leads",
  "crm.automations.view",
  "crm.automations.manage",
  "crm.automations.pause",
  "crm.automations.logs",
  "crm.automations.cancel_pending_action",
] as const;
export type ActionKey = (typeof ALL_ACTIONS)[number];

export const ACTION_LABELS: Record<ActionKey, string> = {
  "pdv.void_sale": "Anular venda",
  "crm.view_all_leads": "Ver todos os leads",
  "crm.automations.view": "Ver automacoes do CRM",
  "crm.automations.manage": "Criar e editar automacoes do CRM",
  "crm.automations.pause": "Pausar automacoes do CRM",
  "crm.automations.logs": "Ver logs de automacoes do CRM",
  "crm.automations.cancel_pending_action": "Cancelar envios pendentes do CRM",
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

/** Returns the action subpermissions for the current user. Admins implicitly have all. */
export const getMyActionAccess = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    if (context.isAdmin) {
      return { isAdmin: true, actions: [...ALL_ACTIONS] as string[] };
    }
    const { data, error } = await supabaseAdmin
      .from("staff_action_permissions")
      .select("action_key")
      .eq("user_id", context.userId)
      .eq("is_allowed", true);
    if (error) throw new Error(error.message);
    return { isAdmin: false, actions: (data ?? []).map((r) => r.action_key) };
  });

/** Admin-only: list staff users + their per-module + per-action permission matrix. */
export const listStaffWithPermissions = createServerFn({ method: "GET" })
  .middleware([requireAdmin()])
  .handler(async () => {
    const { data: roles, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "staff"]);
    if (rolesErr) throw new Error(rolesErr.message);

    const userIds = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
    const [{ data: profiles }, { data: perms }, { data: actions }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, avatar_url, phone, is_blocked")
        .in("id", userIds),
      supabaseAdmin
        .from("staff_module_permissions")
        .select("user_id, module_key, is_allowed")
        .in("user_id", userIds),
      supabaseAdmin
        .from("staff_action_permissions")
        .select("user_id, action_key, is_allowed")
        .in("user_id", userIds),
    ]);

    // Pull emails from auth.admin (paginated, up to ~1000 users)
    const emails = new Map<string, string | null>();
    let page = 1;
    const perPage = 200;
    for (let i = 0; i < 5; i++) {
      const { data: authPage, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (authErr) break;
      authPage.users.forEach((u) => emails.set(u.id, u.email ?? null));
      if (authPage.users.length < perPage) break;
      page++;
    }

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

    const actionByUser = new Map<string, Set<string>>();
    for (const a of actions ?? []) {
      if (!a.is_allowed) continue;
      if (!actionByUser.has(a.user_id)) actionByUser.set(a.user_id, new Set());
      actionByUser.get(a.user_id)!.add(a.action_key);
    }

    return (profiles ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
      phone: p.phone ?? null,
      email: emails.get(p.id) ?? null,
      is_blocked: Boolean(p.is_blocked),
      role: roleByUser.get(p.id) ?? "staff",
      allowed_modules: Array.from(permByUser.get(p.id) ?? []),
      allowed_actions: Array.from(actionByUser.get(p.id) ?? []),
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

export const setStaffActionPermission = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((d) =>
    z
      .object({
        user_id: z.string().uuid(),
        action_key: z.enum(ALL_ACTIONS),
        is_allowed: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("staff_action_permissions")
      .upsert(
        { user_id: data.user_id, action_key: data.action_key, is_allowed: data.is_allowed },
        { onConflict: "user_id,action_key" },
      );
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: data.is_allowed ? "action_permission.grant" : "action_permission.revoke",
      module: "configuracoes",
      entity_type: "staff_action_permission",
      entity_id: null,
      new_data: { user_id: data.user_id, action_key: data.action_key, is_allowed: data.is_allowed },
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

    // Auto-grant the base "cockpit" module so every new staff lands on /admin
    // with the staff cockpit visible by default. Admins ignore this row.
    if (data.role === "staff") {
      await supabaseAdmin
        .from("staff_module_permissions")
        .upsert(
          { user_id: customer.user_id, module_key: "cockpit", is_allowed: true },
          { onConflict: "user_id,module_key" },
        );
    }

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
