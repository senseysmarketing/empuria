import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentUserRole } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";

export function useCurrentUser() {
  const fetchRole = useServerFn(getCurrentUserRole);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setHasSession(!!data.session?.access_token);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session?.access_token);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const query = useQuery({
    queryKey: ["current-user"],
    enabled: hasSession === true,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        return await fetchRole();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/unauthorized/i.test(msg) || /no authorization header/i.test(msg)) {
          // Sessão stale — limpa silenciosamente sem quebrar a tela.
          await supabase.auth.signOut().catch(() => {});
          return null;
        }
        throw e;
      }
    },
  });

  return {
    isLoading: hasSession === null || (hasSession && query.isLoading),
    isError: query.isError,
    data: query.data ?? undefined,
    isAdmin: query.data?.isAdmin ?? false,
    isStaff: query.data?.isStaff ?? false,
    isImpersonating: !!query.data?.impersonation,
    isMember: query.data ? !query.data.isStaff || !!query.data.impersonation : false,
    primaryRole: query.data?.primaryRole,
    impersonation: query.data?.impersonation ?? null,
  };
}
