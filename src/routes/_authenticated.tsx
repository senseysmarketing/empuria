import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const redirectTo = `${location.pathname}${location.searchStr ?? ""}`;
      throw redirect({
        to: "/login",
        search: { redirect: redirectTo },
      });
    }
  },
  component: () => <Outlet />,
});
