import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/triagem")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/crm" });
  },
});
