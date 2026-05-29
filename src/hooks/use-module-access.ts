import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyModuleAccess } from "@/lib/admin/permissions.functions";

export function useModuleAccess() {
  const fetchAccess = useServerFn(getMyModuleAccess);
  const query = useQuery({
    queryKey: ["my-module-access"],
    queryFn: () => fetchAccess(),
    staleTime: 60_000,
  });

  const allowed = new Set(query.data?.modules ?? []);
  return {
    isLoading: query.isLoading,
    isAdmin: query.data?.isAdmin ?? false,
    allowed,
    can: (module: string) => (query.data?.isAdmin ?? false) || allowed.has(module),
  };
}
