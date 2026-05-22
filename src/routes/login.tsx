import { createFileRoute, useNavigate, Link, redirect as routerRedirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserRole } from "@/lib/auth.functions";
import logoCompleta from "@/assets/logo-empuria-completa.png";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    // Already logged in — send to the right place by role
    try {
      const role = await getCurrentUserRole();
      throw routerRedirect({ to: role.isStaff ? "/admin" : "/portal" });
    } catch (e) {
      // If it's a router redirect, rethrow; otherwise fall through to login page
      if (e && typeof e === "object" && "isRedirect" in e) throw e;
    }
  },
  component: LoginPage,
});

const signupSchema = z.object({
  full_name: z.string().trim().min(2, "Nome muito curto").max(120),
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(8, "Mínimo de 8 caracteres").max(72),
});

const loginSchema = z.object({
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(1, "Informe sua senha"),
});

function translateAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail antes de entrar.";
  if (/too many requests/i.test(message)) return "Muitas tentativas. Aguarde alguns minutos.";
  return message;
}

function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirect } = Route.useSearch();

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);

    try {
      setLoading(true);
      if (mode === "signup") {
        const parsed = signupSchema.parse({
          full_name: fd.get("full_name"),
          email: fd.get("email"),
          password: fd.get("password"),
        });
        const { error } = await supabase.auth.signUp({
          email: parsed.email,
          password: parsed.password,
          options: {
            emailRedirectTo: window.location.origin + "/portal",
            data: { full_name: parsed.full_name },
          },
        });
        if (error) throw error;
        setInfo("Cadastro realizado. Verifique seu e-mail para confirmar a conta.");
      } else {
        const parsed = loginSchema.parse({
          email: fd.get("email"),
          password: fd.get("password"),
        });
        const { error: signInError } = await supabase.auth.signInWithPassword(parsed);
        if (signInError) throw signInError;

        // Clear any stale cache from previous user
        await queryClient.invalidateQueries();

        // Determine role and route accordingly
        const role = await getCurrentUserRole();
        const defaultTarget = role.isStaff ? "/admin" : "/portal";

        // Respect ?redirect= only if user has permission
        let target = defaultTarget;
        if (redirect) {
          const goingToAdmin = redirect.startsWith("/admin");
          const goingToPortal = redirect.startsWith("/portal");
          if (goingToAdmin && role.isStaff) target = redirect;
          else if (goingToPortal && !role.isStaff) target = redirect;
        }

        navigate({ to: target });
      }
    } catch (err) {
      if (err instanceof z.ZodError) setError(err.issues[0]?.message ?? "Dados inválidos");
      else setError(err instanceof Error ? translateAuthError(err.message) : "Falha na autenticação");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brown bg-topo flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center mb-8" aria-label="Instituto Empuria">
          <img
            src={logoCompleta}
            alt="Instituto Empuria"
            className="h-14 w-auto object-contain"
          />
        </Link>

        <div className="bg-brown-dark/80 border border-yellow-brand/20 rounded-xl p-8 backdrop-blur-sm">
          <div className="flex gap-2 mb-6 p-1 bg-brown/60 rounded-md">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 py-2 rounded text-xs font-display uppercase tracking-wider transition ${
                mode === "login" ? "bg-orange-brand text-offwhite" : "text-offwhite/60"
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded text-xs font-display uppercase tracking-wider transition ${
                mode === "signup" ? "bg-orange-brand text-offwhite" : "text-offwhite/60"
              }`}
            >
              Criar conta
            </button>
          </div>

          <h1 className="font-display text-2xl text-offwhite mb-1">
            {mode === "login" ? "Bem-vindo de volta" : "Junte-se ao Instituto"}
          </h1>
          <p className="text-offwhite/60 text-sm mb-6 font-body">
            {mode === "login"
              ? "Acesse seu portal de imigrante."
              : "Crie sua conta para acessar a comunidade."}
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-offwhite/70 mb-1.5 font-display">
                  Nome completo
                </label>
                <input
                  name="full_name"
                  required
                  maxLength={120}
                  className="w-full bg-brown/60 border border-yellow-brand/20 text-offwhite rounded-md px-3 py-2.5 focus:outline-none focus:border-yellow-brand"
                />
              </div>
            )}
            <div>
              <label className="block text-xs uppercase tracking-wider text-offwhite/70 mb-1.5 font-display">
                E-mail
              </label>
              <input
                name="email"
                type="email"
                required
                maxLength={255}
                className="w-full bg-brown/60 border border-yellow-brand/20 text-offwhite rounded-md px-3 py-2.5 focus:outline-none focus:border-yellow-brand"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-offwhite/70 mb-1.5 font-display">
                Senha
              </label>
              <input
                name="password"
                type="password"
                required
                minLength={mode === "signup" ? 8 : 1}
                maxLength={72}
                className="w-full bg-brown/60 border border-yellow-brand/20 text-offwhite rounded-md px-3 py-2.5 focus:outline-none focus:border-yellow-brand"
              />
            </div>

            {error && (
              <div className="text-red-300 text-sm bg-red-brand/10 border border-red-brand/30 rounded p-3">
                {error}
              </div>
            )}
            {info && (
              <div className="text-yellow-brand text-sm bg-yellow-brand/10 border border-yellow-brand/30 rounded p-3">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-brand hover:bg-red-brand text-offwhite py-3 rounded-md font-display font-semibold text-sm uppercase tracking-wider transition disabled:opacity-50"
            >
              {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
            </button>
          </form>
        </div>

        <Link
          to="/"
          className="block text-center mt-6 text-offwhite/50 text-xs hover:text-yellow-brand font-body"
        >
          ← Voltar à página inicial
        </Link>
      </div>
    </div>
  );
}
