import { useCurrentUser } from "@/hooks/use-current-user";

export function useModuleAccess() {
  const { isLoading, isAdmin, isStaff } = useCurrentUser();
  return {
    isLoading,
    isAdmin,
    can: (module: string) => isStaff && (module !== "financeiro" || isAdmin),
  };
}
