import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/slots")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/agenda", search: { tab: "slots" } });
  },
});
