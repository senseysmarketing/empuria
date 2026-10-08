import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Home, Wallet, FileText, Ticket, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const items = [
  { to: "/portal", label: "Início", icon: Home, exact: true },
  { to: "/portal/servicos", label: "Serviços", icon: Wallet },
  { to: "/portal/documentos", label: "Documentos", icon: FileText },
  { to: "/portal/ingressos", label: "Ingressos", icon: Ticket },
] as const;

export function PortalDock() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 px-4 pb-4">
      <div className="mx-auto max-w-md bg-brown-deep/95 backdrop-blur-xl border border-brown/40 rounded-2xl shadow-2xl">
        <ul className="flex items-center justify-between gap-0 px-2 py-2">
          {items.map((it) => {
            const active = isActive(it.to, "exact" in it ? it.exact : false);
            return (
              <li key={it.to}>
                <Link
                  to={it.to}
                  data-active={active}
                  className={`admin-dock-item flex items-center justify-center h-10 rounded-full text-offwhite/70 transition-colors ${
                    active
                      ? "bg-admin-accent text-white px-3 gap-2"
                      : "px-2.5 hover:text-offwhite hover:bg-brown/50"
                  }`}
                >
                  <it.icon className="h-[18px] w-[18px]" />
                  <span className="dock-label text-[10px] font-display uppercase tracking-wide">
                    {it.label}
                  </span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/login", search: { redirect: undefined } });
              }}
              className="admin-dock-item flex items-center justify-center h-10 px-2.5 rounded-full text-offwhite/50 hover:text-red-brand hover:bg-brown/50 transition-colors"
              title="Sair"
            >
              <LogOut className="h-[18px] w-[18px]" />
              <span className="dock-label text-[10px] font-display uppercase tracking-wide">
                Sair
              </span>
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}
