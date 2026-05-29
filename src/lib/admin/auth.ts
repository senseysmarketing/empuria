// Shared staff/module guards for admin server functions.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const requireStaff = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { supabase, userId } = context;
    const [{ data: isAdmin }, { data: isStaffRole }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "staff" }),
    ]);
    if (!isAdmin && !isStaffRole) throw new Error("Acesso negado");
    return next({ context: { isAdmin: !!isAdmin } });
  });

/**
 * Require that the current user has access to a specific admin module.
 * Admins always pass. Staff need an explicit allowed row in staff_module_permissions.
 */
export function requireModule(moduleKey: string) {
  return createMiddleware({ type: "function" })
    .middleware([requireStaff])
    .server(async ({ next, context }) => {
      if (context.isAdmin) return next({ context: { module: moduleKey } });
      const { data, error } = await context.supabase.rpc("has_module_access", {
        _user_id: context.userId,
        _module: moduleKey,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("MODULE_FORBIDDEN");
      return next({ context: { module: moduleKey } });
    });
}

export function requireAdmin() {
  return createMiddleware({ type: "function" })
    .middleware([requireStaff])
    .server(async ({ next, context }) => {
      if (!context.isAdmin) throw new Error("Apenas admins podem executar esta ação");
      return next();
    });
}
