import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyActionAccess } from "@/lib/admin/permissions.functions";

export function useActionAccess() {
  const fetchActions = useServerFn(getMyActionAccess);
  const q = useQuery({
    queryKey: ["my-action-access"],
    queryFn: () => fetchActions(),
    staleTime: 30_000,
  });
  const isAdmin = Boolean(q.data?.isAdmin);
  const actions = new Set(q.data?.actions ?? []);
  return {
    isLoading: q.isLoading,
    isAdmin,
    actions,
    can: (key: string) => isAdmin || actions.has(key),
  };
}
