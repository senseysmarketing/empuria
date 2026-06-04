import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import logoCompleta from "@/assets/logo-empuria-completa.png";

export const Route = createFileRoute("/redefinir-senha")({
  ssr: false,
  component: RedefinirSenhaPage,
});

const schema = z
  .object({
    password: z.string().min(8, "Mínimo de 8 caracteres").max(72),
    confirm: z.string().min(1, "Confirme sua senha"),
  })
  .refine((d) => d.password === d.confirm, {
    message: "As senhas não conferem.",
    path: ["confirm"],
  });

function RedefinirSenhaPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    // Supabase detecta o token de recovery do hash e cria a sessão automaticamente.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasSession(true);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasSession(true);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);
    try {
      const parsed = schema.parse({
        password: fd.get("password"),
        confirm: fd.get("confirm"),
      });
      setLoading(true);
      const { error: updErr } = await supabase.auth.updateUser({
        password: parsed.password,
      });
      if (updErr) throw updErr;
      setInfo("Senha atualizada! Você será redirecionado para o login.");
      await supabase.auth.signOut();
      setTimeout(() => navigate({ to: "/login" }), 1500);
    } catch (err) {
      if (err instanceof z.ZodError) setError(err.issues[0]?.message ?? "Dados inválidos");
      else setError(err instanceof Error ? err.message : "Falha ao redefinir senha");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brown bg-topo flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="flex items-center justify-center mb-8"
          aria-label="Instituto Empuria"
        >
          <img src={logoCompleta} alt="Instituto Empuria" className="h-14 w-auto object-contain" />
        </Link>

        <div className="bg-brown-dark/80 border border-yellow-brand/20 rounded-xl p-8 backdrop-blur-sm">
          <h1 className="font-display text-2xl text-offwhite mb-1">Redefinir senha</h1>
          <p className="text-offwhite/60 text-sm mb-6 font-body">
            Crie uma nova senha para acessar sua conta.
          </p>

          {!ready ? (
            <p className="text-offwhite/60 text-sm">Validando link…</p>
          ) : !hasSession ? (
            <div className="space-y-4">
              <p className="text-sm text-red-300">
                O link de redefinição é inválido ou expirou. Solicite um novo link à equipe.
              </p>
              <Link
                to="/login"
                className="inline-block text-xs uppercase tracking-wider font-display text-yellow-brand"
              >
                Voltar ao login
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-offwhite/70 mb-1.5 font-display">
                  Nova senha
                </label>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  maxLength={72}
                  className="w-full bg-brown/60 border border-yellow-brand/20 text-offwhite rounded-md px-3 py-2.5 focus:outline-none focus:border-yellow-brand"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-offwhite/70 mb-1.5 font-display">
                  Confirmar senha
                </label>
                <input
                  name="confirm"
                  type="password"
                  required
                  minLength={8}
                  maxLength={72}
                  className="w-full bg-brown/60 border border-yellow-brand/20 text-offwhite rounded-md px-3 py-2.5 focus:outline-none focus:border-yellow-brand"
                />
              </div>

              {error && <p className="text-sm text-red-300">{error}</p>}
              {info && <p className="text-sm text-emerald-300">{info}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-orange-brand text-offwhite py-2.5 rounded-md font-display uppercase tracking-wider text-sm disabled:opacity-60"
              >
                {loading ? "Salvando…" : "Salvar nova senha"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
