import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AccessDeniedCard } from "@/components/auth/AccessDeniedCard";
import { PortalDock } from "@/components/portal/PortalDock";
import { HeroTopBar } from "@/components/shared/HeroTopBar";
import { TopBarActionsProvider } from "@/components/shared/TopBarActionsContext";

export const Route = createFileRoute("/_authenticated/portal")({
  component: PortalLayout,
});

function PortalLayout() {
  const { isLoading, isStaff } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-admin-bg text-admin-ink flex items-center justify-center">
        <p className="text-sm text-admin-ink-muted font-display uppercase tracking-wider">
          Carregando portal...
        </p>
      </div>
    );
  }

  if (isStaff) {
    return <AccessDeniedCard variant="member-only" />;
  }

  return (
    <TopBarActionsProvider>
      <div className="min-h-screen bg-admin-bg text-admin-ink">
        <HeroTopBar variant="portal" />
        <main className="max-w-7xl mx-auto px-6 pt-6 pb-32">
          <Outlet />
        </main>
        <PortalDock />
      </div>
    </TopBarActionsProvider>
  );
}
