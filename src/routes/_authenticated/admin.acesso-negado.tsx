import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/acesso-negado")({
  component: AccessDeniedPage,
});

function AccessDeniedPage() {
  return (
    <div className="max-w-lg mx-auto py-16 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-orange-brand/15 text-orange-brand mb-5">
        <ShieldAlert className="h-7 w-7" />
      </div>
      <h1 className="font-display text-3xl text-admin-ink mb-2">Acesso restrito</h1>
      <p className="text-admin-ink-muted text-sm mb-6">
        Sua conta não tem permissão para acessar esta área do painel. Fale com um admin para liberar este módulo.
      </p>
      <Link
        to="/admin"
        className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-admin-accent text-white font-display text-sm uppercase tracking-wider"
      >
        Voltar para o cockpit
      </Link>
    </div>
  );
}
