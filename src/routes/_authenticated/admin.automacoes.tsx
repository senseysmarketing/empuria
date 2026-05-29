import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/automacoes")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/configuracoes", search: { tab: "automacoes" } });
  },
});
