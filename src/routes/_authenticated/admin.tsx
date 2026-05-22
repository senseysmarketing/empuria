import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminDock } from "@/components/admin/AdminDock";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="min-h-screen bg-admin-bg text-admin-ink">
      <main className="max-w-7xl mx-auto px-6 pt-8 pb-32">
        <Outlet />
      </main>
      <AdminDock />
    </div>
  );
}
