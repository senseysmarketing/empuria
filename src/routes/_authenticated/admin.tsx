import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminDock } from "@/components/admin/AdminDock";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AccessDeniedCard } from "@/components/auth/AccessDeniedCard";
import { HeroTopBar } from "@/components/shared/HeroTopBar";
import { TopBarActionsProvider } from "@/components/shared/TopBarActionsContext";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { isLoading, isError, isStaff } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-admin-bg text-admin-ink flex items-center justify-center">
        <p className="text-sm text-admin-ink/60 font-display uppercase tracking-wider">
          Verificando acesso...
        </p>
      </div>
    );
  }

  if (isError) {
    return <AccessDeniedCard variant="session-expired" />;
  }

  if (!isStaff) {
    return <AccessDeniedCard variant="admin-required" />;
  }

  return (
    <TopBarActionsProvider>
      <div className="min-h-screen bg-admin-bg text-admin-ink">
        <HeroTopBar variant="admin" />
        <main className="max-w-7xl mx-auto px-6 pt-6 pb-32">
          <Outlet />
        </main>
        <AdminDock />
      </div>
    </TopBarActionsProvider>
  );
}
