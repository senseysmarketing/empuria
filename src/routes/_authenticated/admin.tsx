import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAdminOverview } from "@/lib/portal.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

function AdminPage() {
  const fetchData = useServerFn(getAdminOverview);
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => fetchData(),
    retry: false,
  });

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  if (error) {
    return (
      <div className="min-h-screen bg-brown bg-topo flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="font-display text-3xl text-offwhite mb-2">Acesso restrito</h1>
          <p className="text-offwhite/60 font-body mb-6">
            Você precisa de permissão de staff ou admin para acessar este painel.
          </p>
          <Link
            to="/portal"
            className="inline-block bg-orange-brand text-offwhite px-5 py-2.5 rounded font-display text-xs uppercase tracking-wider"
          >
            Voltar ao portal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brown bg-topo">
      <header className="border-b border-yellow-brand/20 bg-brown-dark/60 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/" className="font-display font-extrabold text-offwhite uppercase tracking-widest text-sm">
            Empuria · Admin
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/portal" className="text-xs uppercase font-display tracking-wider text-offwhite/70 hover:text-yellow-brand">
              Meu portal
            </Link>
            <button onClick={logout} className="text-xs uppercase font-display tracking-wider text-offwhite/70 hover:text-yellow-brand">
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12 space-y-10">
        <div>
          <h1 className="font-display text-4xl text-offwhite mb-1">Painel administrativo</h1>
          <p className="text-offwhite/60 font-body">
            Leads qualificados, agendamentos e membros da comunidade.
          </p>
        </div>

        {isLoading ? (
          <p className="text-offwhite/60">Carregando...</p>
        ) : (
          <>
            <Section title={`Leads de Consultoria (${data?.leads.length ?? 0})`}>
              <table className="w-full text-sm text-offwhite/80">
                <thead className="text-xs uppercase tracking-wider text-yellow-brand/80">
                  <tr className="text-left border-b border-yellow-brand/20">
                    <th className="py-2">Nome</th>
                    <th>Contato</th>
                    <th>Visto</th>
                    <th>Orçamento</th>
                    <th>Status</th>
                    <th>Recebido</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.leads.map((l) => (
                    <tr key={l.id} className="border-b border-yellow-brand/10">
                      <td className="py-3">{l.full_name}</td>
                      <td className="text-xs">
                        {l.email}<br />
                        <span className="text-offwhite/50">{l.phone}</span>
                      </td>
                      <td>{l.target_visa ?? "—"}</td>
                      <td>{l.budget_range ?? "—"}</td>
                      <td><span className="uppercase text-xs">{l.status}</span></td>
                      <td className="text-xs">{new Date(l.created_at).toLocaleDateString("pt-BR")}</td>
                    </tr>
                  ))}
                  {data?.leads.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-offwhite/50">Nenhum lead ainda.</td></tr>
                  )}
                </tbody>
              </table>
            </Section>

            <Section title={`Agenda (${data?.appointments.length ?? 0})`}>
              <ul className="space-y-2">
                {data?.appointments.map((a) => (
                  <li key={a.id} className="flex justify-between border-b border-yellow-brand/10 py-2 text-sm">
                    <span className="text-offwhite">
                      {/* @ts-expect-error joined */}
                      {a.services?.title ?? "Serviço"} ·{" "}
                      {/* @ts-expect-error joined */}
                      <span className="text-offwhite/60">{a.profiles?.full_name ?? "—"}</span>
                    </span>
                    <span className="text-offwhite/60 text-xs">
                      {new Date(a.starts_at).toLocaleString("pt-BR")} · {a.status}
                    </span>
                  </li>
                ))}
                {data?.appointments.length === 0 && (
                  <li className="text-offwhite/50 text-sm">Nenhum agendamento.</li>
                )}
              </ul>
            </Section>

            <Section title={`Membros (${data?.members.length ?? 0})`}>
              <ul className="grid sm:grid-cols-2 gap-2">
                {data?.members.map((m) => (
                  <li key={m.id} className="flex justify-between border border-yellow-brand/10 rounded p-3 text-sm">
                    <span className="text-offwhite">{m.full_name ?? "Sem nome"}</span>
                    <span className={`text-xs uppercase ${m.is_club_member ? "text-yellow-brand" : "text-offwhite/40"}`}>
                      {m.is_club_member ? "Clube" : "Free"}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-brown-dark/60 border border-yellow-brand/20 rounded-xl p-6">
      <h2 className="font-display text-xl text-yellow-brand uppercase tracking-wider mb-4">{title}</h2>
      {children}
    </section>
  );
}
