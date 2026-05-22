import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/clube")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/usuarios", search: { tab: "clube-conteudo" } });
  },
});
