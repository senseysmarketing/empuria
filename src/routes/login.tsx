import {
  createFileRoute,
  Link,
  redirect as routerRedirect,
  useNavigate,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserRole } from "@/lib/auth.functions";
import { checkFirstAccessEligibility, completeFirstAccess } from "@/lib/first-access.functions";
import logoCompleta from "@/assets/logo-empuria-completa.png";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    let isStaff = false;
    try {
      const role = await getCurrentUserRole();
      isStaff = role.isStaff;
    } catch {
      // Fall through and send to portal as safe default.
    }
    throw routerRedirect({ to: isStaff ? "/admin" : "/portal" });
  },
  component: LoginPage,
});

const signupSchema = z.object({
  full_name: z.string().trim().min(2, "Nome muito curto").max(120),
  email: z.string().trim().email("E-mail invalido").max(255),
  password: z.string().min(8, "Minimo de 8 caracteres").max(72),
});

const loginSchema = z.object({
  email: z.string().trim().email("E-mail invalido"),
  password: z.string().min(1, "Informe sua senha"),
});

const firstAccessEmailSchema = z.object({
  email: z.string().trim().email("E-mail invalido").max(255),
});

const firstAccessPasswordSchema = z
  .object({
    password: z.string().min(8, "Minimo de 8 caracteres").max(72),
    confirm_password: z.string().min(1, "Confirme sua senha"),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "As senhas informadas nao conferem.",
    path: ["confirm_password"],
  });

function translateAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail antes de entrar.";
  if (/too many requests/i.test(message)) return "Muitas tentativas. Aguarde alguns minutos.";
  return message;
}

function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup" | "first_access">("login");
  const [firstAccessStep, setFirstAccessStep] = useState<"email" | "password">("email");
  const [firstAccessEmail, setFirstAccessEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirect } = Route.useSearch();
  const checkFirstAccess = useServerFn(checkFirstAccessEligibility);
  const finishFirstAccess = useServerFn(completeFirstAccess);

  const setLoginMode = (nextMode: "login" | "signup" | "first_access") => {
    setMode(nextMode);
    setFirstAccessStep("email");
    setFirstAccessEmail("");
    setError(null);
    setInfo(null);
  };

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
        const { data, error } = await supabase.auth.signUp({
          email: parsed.email,
          password: parsed.password,
          options: {
            emailRedirectTo: window.location.origin + "/portal",
            data: { full_name: parsed.full_name },
          },
        });
        if (error) throw error;
        if (data.session) {
          await queryClient.invalidateQueries();
          navigate({ to: "/portal" });
        } else {
          setInfo("Cadastro realizado. Verifique seu e-mail para confirmar a conta.");
        }
      } else if (mode === "first_access") {
        if (firstAccessStep === "email") {
          const parsed = firstAccessEmailSchema.parse({ email: fd.get("email") });
          const status = await checkFirstAccess({ data: parsed });
          if (!status.eligible) {
            setError(
              "Nao encontramos uma conta disponivel para primeiro acesso com este e-mail. Verifique os dados ou fale com a equipe do Instituto Empuria.",
            );
            return;
          }
          setFirstAccessEmail(parsed.email);
          setFirstAccessStep("password");
          setInfo("Crie sua senha para acessar o portal do Instituto Empuria.");
          return;
        }

        const parsed = firstAccessPasswordSchema.parse({
          password: fd.get("password"),
          confirm_password: fd.get("confirm_password"),
        });
        await finishFirstAccess({
          data: { email: firstAccessEmail, password: parsed.password },
        });
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: firstAccessEmail,
          password: parsed.password,
        });
        if (signInError) throw signInError;
        await queryClient.invalidateQueries();
        navigate({ to: "/portal" });
      } else {
        const parsed = loginSchema.parse({
          email: fd.get("email"),
          password: fd.get("password"),
        });
        const { error: signInError } = await supabase.auth.signInWithPassword(parsed);
        if (signInError) {
          const firstAccessStatus = await checkFirstAccess({ data: { email: parsed.email } });
          if (firstAccessStatus.eligible) {
            throw new Error(
              "Sua conta foi criada pela equipe do Instituto Empuria. Clique em Primeiro acesso? para cadastrar sua senha.",
            );
          }
          throw signInError;
        }

        await queryClient.invalidateQueries();

        const role = await getCurrentUserRole();
        const defaultTarget = role.isStaff ? "/admin" : "/portal";

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
      if (err instanceof z.ZodError) setError(err.issues[0]?.message ?? "Dados invalidos");
      else
        setError(err instanceof Error ? translateAuthError(err.message) : "Falha na autenticacao");
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === "login"
      ? "Bem-vindo de volta"
      : mode === "signup"
        ? "Junte-se ao Instituto"
        : "Primeiro acesso";
  const subtitle =
    mode === "login"
      ? "Acesse seu portal de imigrante."
      : mode === "signup"
        ? "Crie sua conta para acessar a comunidade."
        : firstAccessStep === "email"
          ? "Informe o e-mail cadastrado pela equipe do Instituto Empuria."
          : "Crie sua senha para acessar o portal.";

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
          <div className="flex gap-2 mb-6 p-1 bg-brown/60 rounded-md">
            <button
              type="button"
              onClick={() => setLoginMode("login")}
              className={`flex-1 py-2 rounded text-xs font-display uppercase tracking-wider transition ${
                mode === "login" ? "bg-orange-brand text-offwhite" : "text-offwhite/60"
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setLoginMode("signup")}
              className={`flex-1 py-2 rounded text-xs font-display uppercase tracking-wider transition ${
                mode === "signup" ? "bg-orange-brand text-offwhite" : "text-offwhite/60"
              }`}
            >
              Criar conta
            </button>
          </div>

          <h1 className="font-display text-2xl text-offwhite mb-1">{title}</h1>
          <p className="text-offwhite/60 text-sm mb-6 font-body">{subtitle}</p>

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

            {(mode === "login" || mode === "signup" || firstAccessStep === "email") && (
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
            )}

            {mode === "first_access" && firstAccessStep === "password" && (
              <div className="text-sm text-yellow-brand bg-yellow-brand/10 border border-yellow-brand/30 rounded p-3">
                {firstAccessEmail}
              </div>
            )}

            {(mode === "login" || mode === "signup" || firstAccessStep === "password") && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-offwhite/70 mb-1.5 font-display">
                  {mode === "first_access" ? "Nova senha" : "Senha"}
                </label>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={mode === "signup" || mode === "first_access" ? 8 : 1}
                  maxLength={72}
                  className="w-full bg-brown/60 border border-yellow-brand/20 text-offwhite rounded-md px-3 py-2.5 focus:outline-none focus:border-yellow-brand"
                />
              </div>
            )}

            {mode === "first_access" && firstAccessStep === "password" && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-offwhite/70 mb-1.5 font-display">
                  Confirmar senha
                </label>
                <input
                  name="confirm_password"
                  type="password"
                  required
                  minLength={8}
                  maxLength={72}
                  className="w-full bg-brown/60 border border-yellow-brand/20 text-offwhite rounded-md px-3 py-2.5 focus:outline-none focus:border-yellow-brand"
                />
              </div>
            )}

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
              {loading
                ? "Aguarde..."
                : mode === "login"
                  ? "Entrar"
                  : mode === "signup"
                    ? "Criar conta"
                    : firstAccessStep === "email"
                      ? "Continuar"
                      : "Criar senha e acessar portal"}
            </button>

            {mode === "login" && (
              <button
                type="button"
                onClick={() => setLoginMode("first_access")}
                className="block w-full text-center text-xs text-offwhite/60 hover:text-yellow-brand"
              >
                Primeiro acesso?
              </button>
            )}
            {mode === "first_access" && (
              <button
                type="button"
                onClick={() => setLoginMode("login")}
                className="block w-full text-center text-xs text-offwhite/60 hover:text-yellow-brand"
              >
                Voltar para entrar
              </button>
            )}
          </form>
        </div>

        <Link
          to="/"
          className="block text-center mt-6 text-offwhite/50 text-xs hover:text-yellow-brand font-body"
        >
          Voltar para a pagina inicial
        </Link>
      </div>
    </div>
  );
}
