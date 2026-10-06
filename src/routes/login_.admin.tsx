import { createFileRoute, redirect as routerRedirect } from "@tanstack/react-router";
import { AuthLoginPage } from "@/components/auth/AuthLoginPage";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserRole } from "@/lib/auth.functions";

export const Route = createFileRoute("/login_/admin")({
  head: () => ({ meta: [
    { title: "Acesso da equipe — Instituto Empuria" },
    { name: "description", content: "Acesso da equipe ao painel administrativo do Instituto Empuria." },
    { property: "og:title", content: "Acesso da equipe — Instituto Empuria" },
    { property: "og:description", content: "Acesso da equipe ao painel administrativo do Instituto Empuria." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;

    const role = await getCurrentUserRole().catch(() => null);
    if (role?.isStaff) throw routerRedirect({ to: "/admin" });
    if (role?.isMember) throw routerRedirect({ to: "/portal" });
  },
  component: AdminLoginRoute,
});

function AdminLoginRoute() {
  const { redirect } = Route.useSearch();
  return <AuthLoginPage context="admin" redirect={redirect} />;
}
