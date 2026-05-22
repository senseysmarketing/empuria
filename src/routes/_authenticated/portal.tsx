import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMyDashboard } from "@/lib/portal.functions";
import { supabase } from "@/integrations/supabase/client";
import { MyServicesPanel } from "@/components/portal/MyServicesPanel";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AccessDeniedCard } from "@/components/auth/AccessDeniedCard";
import logoCompleta from "@/assets/logo-empuria-completa.png";

export const Route = createFileRoute("/_authenticated/portal")({
  component: PortalPage,
});

function PortalPage() {
  const fetchDash = useServerFn(getMyDashboard);
  const navigate = useNavigate();
  const { isLoading: roleLoading, isStaff } = useCurrentUser();
  const { data, isLoading } = useQuery({
    queryKey: ["my-dashboard"],
    queryFn: () => fetchDash(),
    enabled: !roleLoading && !isStaff,
  });

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  if (roleLoading) {
    return (
      <div className="min-h-screen bg-brown bg-topo flex items-center justify-center">
        <p className="text-sm text-offwhite/60 font-display uppercase tracking-wider">
          Carregando...
        </p>
      </div>
    );
  }

  if (isStaff) {
    return <AccessDeniedCard variant="member-only" />;
  }


  return (
    <div className="min-h-screen bg-brown bg-topo">
      <header className="border-b border-yellow-brand/20 bg-brown-dark/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3" aria-label="Instituto Empuria · Portal">
            <img src={logoCompleta} alt="Instituto Empuria" className="h-8 w-auto object-contain" />
            <span className="hidden sm:inline font-display text-xs uppercase tracking-widest text-yellow-brand/80">
              Portal
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <button
              onClick={logout}
              className="text-xs uppercase font-display tracking-wider text-offwhite/70 hover:text-yellow-brand"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <h1 className="font-display text-4xl text-offwhite mb-2">
          Olá, {data?.profile?.full_name ?? "imigrante"}
        </h1>
        <p className="text-offwhite/60 font-body mb-10">
          Bem-vindo ao seu portal. Aqui você acompanha agendamentos, serviços e benefícios do Clube.
        </p>

        {isLoading ? (
          <p className="text-offwhite/60">Carregando...</p>
        ) : (
          <div className="space-y-10">
            <section>
              <h2 className="font-display text-xl text-yellow-brand uppercase tracking-wider mb-4">
                Meus Serviços
              </h2>
              <MyServicesPanel />
            </section>

            <div className="grid md:grid-cols-2 gap-6">
              <section className="bg-brown-dark/60 border border-yellow-brand/20 rounded-xl p-6">
                <h2 className="font-display text-xl text-yellow-brand uppercase tracking-wider mb-4">
                  Meus Agendamentos
                </h2>
                {data?.appointments.length === 0 ? (
                  <p className="text-offwhite/60 text-sm">Nenhum agendamento ainda.</p>
                ) : (
                  <ul className="space-y-3">
                    {data?.appointments.map((a) => (
                      <li key={a.id} className="border-b border-yellow-brand/10 pb-3">
                        <div className="text-offwhite font-display">
                          {(a as { services?: { title?: string } }).services?.title ?? "Serviço"}
                        </div>
                        <div className="text-xs text-offwhite/60 font-body">
                          {new Date(a.starts_at).toLocaleString("pt-BR")} ·{" "}
                          <span className="uppercase">{a.status}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="bg-brown-dark/60 border border-yellow-brand/20 rounded-xl p-6">
                <h2 className="font-display text-xl text-yellow-brand uppercase tracking-wider mb-4">
                  Clube do Imigrante
                </h2>
                <p className="text-offwhite/70 text-sm font-body mb-3">
                  Status:{" "}
                  <span className={data?.profile?.is_club_member ? "text-yellow-brand" : "text-offwhite/50"}>
                    {data?.profile?.is_club_member ? "Membro ativo" : "Não associado"}
                  </span>
                </p>
                {!data?.profile?.is_club_member && (
                  <Link
                    to="/"
                    hash="clube"
                    className="inline-block bg-orange-brand hover:bg-red-brand text-offwhite px-4 py-2 rounded text-xs uppercase font-display tracking-wider"
                  >
                    Associar-se
                  </Link>
                )}
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
