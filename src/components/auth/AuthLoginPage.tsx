import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserRole } from "@/lib/auth.functions";
import { checkFirstAccessEligibility, completeFirstAccess } from "@/lib/first-access.functions";
import heroWelcome from "@/assets/hero-welcome-brazil-madrid.jpg.asset.json";
import logoCompleta from "@/assets/logo-empuria-completa.png";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

type LoginContext = "member" | "admin";
type LoginMode = "login" | "signup" | "first_access";

const signupSchema = z.object({
  full_name: z.string().trim().min(2, "Nome muito curto").max(120),
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(8, "Mínimo de 8 caracteres").max(72),
});

const loginSchema = z.object({
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(1, "Informe sua senha"),
});

const firstAccessEmailSchema = z.object({
  email: z.string().trim().email("E-mail inválido").max(255),
});

const firstAccessPasswordSchema = z
  .object({
    password: z.string().min(8, "Mínimo de 8 caracteres").max(72),
    confirm_password: z.string().min(1, "Confirme sua senha"),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "As senhas informadas não conferem.",
    path: ["confirm_password"],
  });

function translateAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail antes de entrar.";
  if (/too many requests/i.test(message)) return "Muitas tentativas. Aguarde alguns minutos.";
  return message;
}

function targetForRedirect(
  context: LoginContext,
  redirect: string | undefined,
  role: { isMember: boolean; isStaff: boolean },
) {
  const defaultTarget = context === "admin" ? "/admin" : "/portal";
  if (!redirect) return defaultTarget;
  if (context === "admin" && role.isStaff && redirect.startsWith("/admin")) return redirect;
  if (context === "member" && role.isMember && redirect.startsWith("/portal")) return redirect;
  return defaultTarget;
}

export function AuthLoginPage({ context, redirect }: { context: LoginContext; redirect?: string }) {
  const isAdminLogin = context === "admin";
  const [mode, setMode] = useState<LoginMode>("login");
  const [firstAccessStep, setFirstAccessStep] = useState<"email" | "password">("email");
  const [firstAccessEmail, setFirstAccessEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const checkFirstAccess = useServerFn(checkFirstAccessEligibility);
  const finishFirstAccess = useServerFn(completeFirstAccess);

  const setLoginMode = (nextMode: LoginMode) => {
    setMode(nextMode);
    setFirstAccessStep("email");
    setFirstAccessEmail("");
    setError(null);
    setInfo(null);
  };

  const finishSignIn = async () => {
    await queryClient.invalidateQueries();
    const role = await getCurrentUserRole();
    const hasRequiredRole = isAdminLogin ? role.isStaff : role.isMember;
    if (!hasRequiredRole) {
      await supabase.auth.signOut();
      await queryClient.invalidateQueries();
      throw new Error(
        isAdminLogin
          ? "Esta conta não possui acesso administrativo. Use o login de membros."
          : "Esta conta é de equipe. Use o login administrativo para acessar o painel.",
      );
    }
    navigate({ to: targetForRedirect(context, redirect, role) });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    const form = new FormData(event.currentTarget);
    try {
      setLoading(true);
      if (mode === "signup") {
        const parsed = signupSchema.parse({
          full_name: form.get("full_name"),
          email: form.get("email"),
          password: form.get("password"),
        });
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: parsed.email,
          password: parsed.password,
          options: {
            emailRedirectTo: window.location.origin + "/portal",
            data: { full_name: parsed.full_name },
          },
        });
        if (signUpError) throw signUpError;
        if (data.session) await finishSignIn();
        else setInfo("Cadastro realizado. Verifique seu e-mail para confirmar a conta.");
        return;
      }

      if (mode === "first_access") {
        if (firstAccessStep === "email") {
          const parsed = firstAccessEmailSchema.parse({ email: form.get("email") });
          const status = await checkFirstAccess({ data: parsed });
          if (!status.eligible) {
            setError(
              "Não encontramos uma conta disponível para primeiro acesso com este e-mail. Verifique os dados ou fale com a equipe do Instituto Empuria.",
            );
            return;
          }
          setFirstAccessEmail(parsed.email);
          setFirstAccessStep("password");
          setInfo(
            isAdminLogin
              ? "Crie sua senha para acessar o painel administrativo."
              : "Crie sua senha para acessar o portal do Instituto Empuria.",
          );
          return;
        }

        const parsed = firstAccessPasswordSchema.parse({
          password: form.get("password"),
          confirm_password: form.get("confirm_password"),
        });
        await finishFirstAccess({ data: { email: firstAccessEmail, password: parsed.password } });
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: firstAccessEmail,
          password: parsed.password,
        });
        if (signInError) throw signInError;
        await finishSignIn();
        return;
      }

      const parsed = loginSchema.parse({
        email: form.get("email"),
        password: form.get("password"),
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
      await finishSignIn();
    } catch (caught) {
      if (caught instanceof z.ZodError) setError(caught.issues[0]?.message ?? "Dados inválidos");
      else
        setError(
          caught instanceof Error ? translateAuthError(caught.message) : "Falha na autenticação",
        );
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === "login"
      ? isAdminLogin
        ? "Acesso da equipe"
        : "Bem-vindo de volta"
      : mode === "signup"
        ? "Junte-se ao Instituto"
        : "Primeiro acesso";
  const subtitle =
    mode === "login"
      ? isAdminLogin
        ? "Entre com sua conta de staff ou administrador."
        : "Acesse seu portal de membro."
      : mode === "signup"
        ? "Crie sua conta para acessar a comunidade."
        : firstAccessStep === "email"
          ? "Informe o e-mail cadastrado pela equipe do Instituto Empuria."
          : isAdminLogin
            ? "Crie sua senha para acessar o painel administrativo."
            : "Crie sua senha para acessar o portal.";

  return (
    <main className="min-h-screen bg-brown text-offwhite lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(360px,3fr)]">
      <section
        className="relative hidden min-h-screen overflow-hidden lg:block"
        aria-label="Instituto Empuria em Madrid"
      >
        <img
          src={heroWelcome.url}
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-brown/10 via-brown/15 to-brown/80" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brown/85 to-transparent px-12 pb-12 pt-32">
          <p className="max-w-xl font-display text-3xl font-semibold leading-tight">
            Sua casa brasileira em Madrid, do primeiro passo às novas conquistas.
          </p>
        </div>
      </section>

      <section className="relative z-10 flex min-h-screen items-center justify-center bg-brown px-6 py-10 sm:px-10 lg:px-12 lg:shadow-login-divider">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-10 inline-flex" aria-label="Instituto Empuria">
            <img
              src={logoCompleta}
              alt="Instituto Empuria"
              className="h-14 w-auto object-contain"
            />
          </Link>
          <div className="mb-8">
            <p className="mb-3 font-display text-xs font-semibold uppercase tracking-[0.24em] text-yellow-brand">
              {isAdminLogin ? "Painel administrativo" : "Portal de membros"}
            </p>
            <h1 className="font-display text-3xl font-semibold text-offwhite">{title}</h1>
            <p className="mt-2 text-sm text-offwhite/65">{subtitle}</p>
          </div>

          {!isAdminLogin && (
            <div className="mb-6 flex gap-2 rounded-lg border border-yellow-brand/15 bg-brown-deep/45 p-1">
              <button
                type="button"
                onClick={() => setLoginMode("login")}
                className={`flex-1 rounded-md py-2.5 text-xs font-display uppercase tracking-wider transition ${mode === "login" ? "bg-orange-brand text-offwhite" : "text-offwhite/60"}`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => setLoginMode("signup")}
                className={`flex-1 rounded-md py-2.5 text-xs font-display uppercase tracking-wider transition ${mode === "signup" ? "bg-orange-brand text-offwhite" : "text-offwhite/60"}`}
              >
                Criar conta
              </button>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "signup" && <Field label="Nome completo" name="full_name" maxLength={120} />}
            {(mode === "login" || mode === "signup" || firstAccessStep === "email") && (
              <Field label="E-mail" name="email" type="email" maxLength={255} />
            )}
            {mode === "first_access" && firstAccessStep === "password" && (
              <div className="rounded-md border border-yellow-brand/30 bg-yellow-brand/10 p-3 text-sm text-yellow-brand">
                {firstAccessEmail}
              </div>
            )}
            {(mode === "login" || mode === "signup" || firstAccessStep === "password") && (
              <Field
                label={mode === "first_access" ? "Nova senha" : "Senha"}
                name="password"
                type="password"
                minLength={mode === "signup" || mode === "first_access" ? 8 : 1}
                maxLength={72}
              />
            )}
            {mode === "first_access" && firstAccessStep === "password" && (
              <Field
                label="Confirmar senha"
                name="confirm_password"
                type="password"
                minLength={8}
                maxLength={72}
              />
            )}

            {error && (
              <div
                role="alert"
                className="rounded-md border border-red-brand/40 bg-red-brand/15 p-3 text-sm text-red-200"
              >
                {error}
                {mode === "login" && (
                  <Link
                    to={isAdminLogin ? "/login" : "/login/admin"}
                    className="mt-2 block font-semibold text-yellow-brand hover:underline"
                  >
                    {isAdminLogin ? "Ir para o login de membros" : "Ir para o login administrativo"}
                  </Link>
                )}
              </div>
            )}
            {info && (
              <div className="rounded-md border border-yellow-brand/30 bg-yellow-brand/10 p-3 text-sm text-yellow-brand">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-orange-brand py-3 font-display text-sm font-semibold uppercase tracking-wider text-offwhite transition hover:bg-red-brand disabled:opacity-50"
            >
              {loading
                ? "Aguarde..."
                : mode === "login"
                  ? "Entrar"
                  : mode === "signup"
                    ? "Criar conta"
                    : firstAccessStep === "email"
                      ? "Continuar"
                      : isAdminLogin
                        ? "Criar senha e acessar painel"
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

          <div className="mt-8 space-y-3 border-t border-yellow-brand/15 pt-6 text-center text-xs">
            {isAdminLogin ? (
              <Button asChild variant="outline" className="h-10 border-yellow-brand/35 bg-transparent px-6 font-display text-offwhite/90 shadow-none hover:border-yellow-brand/60 hover:bg-yellow-brand/10 hover:text-offwhite">
                <Link to="/login">
                  <Users aria-hidden="true" />
                  Voltar ao login de membros
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline" className="h-10 border-yellow-brand/35 bg-transparent px-6 font-display text-offwhite/90 shadow-none hover:border-yellow-brand/60 hover:bg-yellow-brand/10 hover:text-offwhite">
                <Link to="/login/admin">
                  <Users aria-hidden="true" />
                  Acesso da equipe
                </Link>
              </Button>
            )}
            <Link to="/" className="block text-offwhite/45 hover:text-yellow-brand">
              Voltar para a página inicial
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  name,
  type = "text",
  minLength,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  minLength?: number;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-display text-xs uppercase tracking-wider text-offwhite/70">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required
        minLength={minLength}
        maxLength={maxLength}
        autoComplete={
          name === "email" ? "email" : name === "password" ? "current-password" : undefined
        }
        className="w-full rounded-md border border-yellow-brand/20 bg-brown-deep/55 px-3 py-2.5 text-offwhite outline-none transition focus:border-yellow-brand focus:ring-2 focus:ring-yellow-brand/15"
      />
    </label>
  );
}
