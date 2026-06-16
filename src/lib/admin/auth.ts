// Shared staff/module guards for admin server functions.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserStaffAccess, userHasModuleAccess, userHasAction } from "./permission-checks";

export const requireStaff = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const access = await getUserStaffAccess(context.userId);
    if (!access.canAccessAdmin) throw new Error("Acesso negado");
    return next({ context: { isAdmin: access.isAdmin } });
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
      const allowed = await userHasModuleAccess(context.userId, moduleKey);
      if (!allowed) throw new Error("MODULE_FORBIDDEN");
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

/**
 * Allow admins always, or staff that have an explicit action permission row.
 */
export function requireStaffOrAction(actionKey: string) {
  return createMiddleware({ type: "function" })
    .middleware([requireStaff])
    .server(async ({ next, context }) => {
      if (context.isAdmin) return next();
      const allowed = await userHasAction(context.userId, actionKey);
      if (!allowed) throw new Error("Sem permissão para esta ação");
      return next();
    });
}
