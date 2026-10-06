import { supabaseAdmin } from "@/integrations/supabase/client.server";

type AppRole = "admin" | "staff" | "member";

function normalizePermissionError(error: { message?: string } | null, fallback: string) {
  return error?.message ?? fallback;
}

export async function userHasRole(userId: string, role: AppRole) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", role)
    .maybeSingle();
  if (error) throw new Error(normalizePermissionError(error, "Erro ao validar permissao"));
  return Boolean(data);
}

export async function getUserStaffAccess(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "staff"]);
  if (error) throw new Error(normalizePermissionError(error, "Erro ao validar permissao"));

  const roles = new Set((data ?? []).map((row) => row.role as AppRole));
  return {
    isAdmin: roles.has("admin"),
    isStaff: roles.has("staff"),
    canAccessAdmin: roles.has("admin") || roles.has("staff"),
  };
}
