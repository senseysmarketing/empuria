import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import logoCompleta from "@/assets/logo-empuria-completa.png";

type Variant = "admin-required" | "member-only" | "session-expired";

interface Props {
  variant: Variant;
}

export function AccessDeniedCard({ variant }: Props) {
  const navigate = useNavigate();

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login", search: { redirect: undefined } });
  };

  const isAdminRequired = variant === "admin-required";
  const isSessionExpired = variant === "session-expired";
  const title = isAdminRequired
    ? "Esta area e exclusiva da equipe"
    : isSessionExpired
      ? "Sessao expirada"
      : "Esta area e exclusiva de membros";
  const description = isAdminRequired
    ? "Sua conta nao tem permissao para acessar o painel administrativo. Acesse o seu portal de membro para continuar."
    : isSessionExpired
      ? "Entre novamente para continuar com seguranca."
      : "Sua conta de equipe nao usa o portal de membros. Acesse o painel administrativo para continuar.";
  const primaryTo = isAdminRequired ? "/portal" : isSessionExpired ? "/login" : "/admin";
  const primaryLabel = isAdminRequired
    ? "Ir para meu painel"
    : isSessionExpired
      ? "Entrar novamente"
      : "Ir para o painel admin";

  return (
    <div className="min-h-screen bg-brown bg-topo flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="flex items-center justify-center mb-8"
          aria-label="Instituto Empuria"
        >
          <img src={logoCompleta} alt="Instituto Empuria" className="h-12 w-auto object-contain" />
        </Link>

        <div className="bg-brown-dark/80 border border-yellow-brand/20 rounded-xl p-8 backdrop-blur-sm text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-orange-brand/20 text-orange-brand mb-4 text-2xl">
            !
          </div>
          <h1 className="font-display text-2xl text-offwhite mb-2">{title}</h1>
          <p className="text-offwhite/70 font-body text-sm mb-6">{description}</p>

          <div className="flex flex-col gap-2">
            <Link
              to={primaryTo}
              className="w-full bg-orange-brand hover:bg-red-brand text-offwhite py-3 rounded-md font-display font-semibold text-sm uppercase tracking-wider transition"
            >
              {primaryLabel}
            </Link>
            <button
              onClick={logout}
              className="w-full text-offwhite/60 hover:text-yellow-brand py-2 text-xs uppercase font-display tracking-wider transition"
            >
              Sair
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
