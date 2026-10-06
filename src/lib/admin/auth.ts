// Shared staff/module guards for admin server functions.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserStaffAccess } from "./permission-checks";

export const requireStaff = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const access = await getUserStaffAccess(context.userId);
    if (!access.canAccessAdmin) throw new Error("Acesso negado");
    return next({ context: { isAdmin: access.isAdmin } });
  });

/**
 * Todos os integrantes da equipe acessam os módulos operacionais.
 * Financeiro/Caixa é a única exceção e permanece exclusivo de admin.
 */
export function requireModule(moduleKey: string) {
  return createMiddleware({ type: "function" })
    .middleware([requireStaff])
    .server(async ({ next, context }) => {
      if (moduleKey === "financeiro" && !context.isAdmin) {
        throw new Error("MODULE_FORBIDDEN");
      }
      return next({ context: { module: moduleKey } });
    });
}

/**
 * Require access to ANY of the listed modules.
 * Use when a single server fn is reusable across surfaces (e.g. PDV report
 * shown both in /admin/relatorios and /admin/pdv).
 */
export function requireAnyModule(...moduleKeys: string[]) {
  return createMiddleware({ type: "function" })
    .middleware([requireStaff])
    .server(async ({ next, context }) => {
      const module = moduleKeys.find((key) => key !== "financeiro");
      if (module) {
        return next({ context: { module } });
      }
      if (!context.isAdmin) throw new Error("MODULE_FORBIDDEN");
      return next({ context: { module: moduleKeys[0] } });
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
