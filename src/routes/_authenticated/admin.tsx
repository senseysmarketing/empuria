import { useEffect, useState } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AccessDeniedCard } from "@/components/auth/AccessDeniedCard";
import { TopBarActionsProvider } from "@/components/shared/TopBarActionsContext";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { isLoading, isError, isStaff, isAdmin } = useCurrentUser();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem("empuria.admin.sidebar.collapsed") === "true");
  }, []);

  const changeSidebarCollapsed = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    localStorage.setItem("empuria.admin.sidebar.collapsed", String(collapsed));
  };

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
    return <AccessDeniedCard variant="session-expired" context="admin" />;
  }

  if (!isStaff) {
    return <AccessDeniedCard variant="admin-required" />;
  }

  return (
    <TopBarActionsProvider>
      <div className="min-h-screen bg-admin-bg text-admin-ink">
        <AdminSidebar
          collapsed={sidebarCollapsed}
          isAdmin={isAdmin}
          mobileOpen={mobileMenuOpen}
          onCollapsedChange={changeSidebarCollapsed}
          onMobileOpenChange={setMobileMenuOpen}
        />
        <div
          className={cn(
            "min-w-0 transition-[padding] duration-200",
            sidebarCollapsed ? "md:pl-[72px]" : "md:pl-64",
          )}
        >
          <AdminHeader onOpenMenu={() => setMobileMenuOpen(true)} />
          <main className="mx-auto w-full max-w-7xl min-w-0 px-4 py-5 md:px-6 md:py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </TopBarActionsProvider>
  );
}
