import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentUserRole } from "@/lib/auth.functions";

export function useCurrentUser() {
  const fetchRole = useServerFn(getCurrentUserRole);
  const query = useQuery({
    queryKey: ["current-user"],
    queryFn: () => fetchRole(),
    staleTime: 60_000,
  });

  return {
    isLoading: query.isLoading,
    isError: query.isError,
    data: query.data,
    isAdmin: query.data?.isAdmin ?? false,
    isStaff: query.data?.isStaff ?? false,
    isImpersonating: !!query.data?.impersonation,
    isMember: query.data ? !query.data.isStaff || !!query.data.impersonation : false,
    primaryRole: query.data?.primaryRole,
    impersonation: query.data?.impersonation ?? null,
  };
}
