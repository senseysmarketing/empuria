import { createFileRoute, redirect as routerRedirect } from "@tanstack/react-router";
import { AuthLoginPage } from "@/components/auth/AuthLoginPage";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserRole } from "@/lib/auth.functions";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [
    { title: "Login de membros — Instituto Empuria" },
    { name: "description", content: "Acesse seu portal de membro do Instituto Empuria." },
    { property: "og:title", content: "Login de membros — Instituto Empuria" },
    { property: "og:description", content: "Acesse seu portal de membro do Instituto Empuria." },
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
    if (role?.isMember) throw routerRedirect({ to: "/portal" });
    if (role?.isStaff) throw routerRedirect({ to: "/admin" });
  },
  component: MemberLoginRoute,
});

function MemberLoginRoute() {
  const { redirect } = Route.useSearch();
  return <AuthLoginPage context="member" redirect={redirect} />;
}
