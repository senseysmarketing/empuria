import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "admin" | "staff" | "member";

export const getCurrentUserRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    if (error) throw new Error(error.message);

    const roles = (data ?? []).map((r) => r.role as AppRole);
    const isAdmin = roles.includes("admin");
    const isStaff = isAdmin || roles.includes("staff");
    const primaryRole: AppRole = isAdmin
      ? "admin"
      : roles.includes("staff")
        ? "staff"
        : "member";

    return { userId, roles, isAdmin, isStaff, primaryRole };
  });
