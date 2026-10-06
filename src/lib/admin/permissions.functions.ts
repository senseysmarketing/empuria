import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin, requireStaff } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createOrReuseManualCustomer } from "./manual-users";

/** Lista a equipe sem consultar a matriz granular legada. */
export const listStaffWithPermissions = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async () => {
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "staff"]);
    if (rolesError) throw new Error(rolesError.message);

    const userIds = Array.from(new Set((roles ?? []).map((role) => role.user_id)));
    if (userIds.length === 0) return [];

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, avatar_url, phone, is_blocked")
      .in("id", userIds);
    if (profilesError) throw new Error(profilesError.message);

    const emails = new Map<string, string | null>();
    let page = 1;
    const perPage = 200;
    for (let index = 0; index < 5; index++) {
      const { data: authPage, error: authError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (authError) break;
      authPage.users.forEach((user) => emails.set(user.id, user.email ?? null));
      if (authPage.users.length < perPage) break;
      page++;
    }

    const roleByUser = new Map<string, "admin" | "staff">();
    for (const role of roles ?? []) {
      const previous = roleByUser.get(role.user_id);
      if (role.role === "admin" || !previous) {
        roleByUser.set(role.user_id, role.role as "admin" | "staff");
      }
    }

    return (profiles ?? []).map((profile) => ({
      id: profile.id,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      phone: profile.phone ?? null,
      email: emails.get(profile.id) ?? null,
      is_blocked: Boolean(profile.is_blocked),
      role: roleByUser.get(profile.id) ?? "staff",
    }));
  });

const teamMemberSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

async function createTeamMember(
  data: z.infer<typeof teamMemberSchema>,
  role: "staff" | "admin",
  actorId: string,
) {
  const customer = await createOrReuseManualCustomer({
    fullName: data.full_name,
    email: data.email,
    phone: data.phone || null,
    origin: "admin_created",
    actorId,
  });

  const { error: roleError } = await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: customer.user_id, role }, { onConflict: "user_id,role" });
  if (roleError) throw new Error(roleError.message);

  await supabaseAdmin.from("audit_logs").insert({
    actor_id: actorId,
    action: customer.created ? "staff.created" : "staff.role_granted",
    module: "configuracoes",
    entity_type: "user_role",
    entity_id: customer.user_id,
    new_data: {
      email: customer.email,
      full_name: customer.full_name,
      role,
      password_setup_required: customer.password_setup_required,
    },
  });

  return {
    user_id: customer.user_id,
    created: customer.created,
    role,
    password_setup_required: customer.password_setup_required,
  };
}

export const createStaffMember = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((data) => teamMemberSchema.parse(data))
  .handler(({ data, context }) => createTeamMember(data, "staff", context.userId));

/** Conceder admin usa um endpoint separado e protegido antes de acessar service role. */
export const createAdminMember = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((data) => teamMemberSchema.parse(data))
  .handler(({ data, context }) => createTeamMember(data, "admin", context.userId));
