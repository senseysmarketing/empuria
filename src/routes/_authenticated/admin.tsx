import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminDock } from "@/components/admin/AdminDock";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AccessDeniedCard } from "@/components/auth/AccessDeniedCard";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { isLoading, isStaff } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-admin-bg text-admin-ink flex items-center justify-center">
        <p className="text-sm text-admin-ink/60 font-display uppercase tracking-wider">
          Verificando acesso...
        </p>
      </div>
    );
  }

  if (!isStaff) {
    return <AccessDeniedCard variant="admin-required" />;
  }

  return (
    <div className="min-h-screen bg-admin-bg text-admin-ink">
      <main className="max-w-7xl mx-auto px-6 pt-8 pb-32">
        <Outlet />
      </main>
      <AdminDock />
    </div>
  );
}
