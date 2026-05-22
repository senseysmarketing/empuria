// Shared staff guard for admin server functions.
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
