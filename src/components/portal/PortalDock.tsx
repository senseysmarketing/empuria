import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Home, Crown, Wallet, ShoppingBag, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import logoIcone from "@/assets/logo-empuria-icone.png";

const items = [
  { to: "/portal", label: "Início", icon: Home, exact: true },
  { to: "/portal/clube", label: "Clube", icon: Crown },
  { to: "/portal/servicos", label: "Serviços", icon: Wallet },
  { to: "/portal/loja", label: "Loja", icon: ShoppingBag },
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
          <li className="flex items-center px-1.5">
            <img src={logoIcone} alt="Empuria" className="h-6 w-6 object-contain opacity-90" />
          </li>
          <li className="w-px h-5 bg-brown/60 mx-0.5" />
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
                  <it.icon className="h-[18px] w-[18px] shrink-1" />
                  <span className={`dock-label text-[10px] font-unbounded uppercase tracking-wide ${active ? "" : ""}`}>
                    {it.label}
                  </span>
                </Link>
              </li>
            );
          })}
          <li className="w-px h-5 bg-brown/60 mx-0.5" />
          <li>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/login" });
              }}
              className="admin-dock-item flex items-center justify-center h-10 px-2.5 rounded-full text-offwhite/50 hover:text-red-brand hover:bg-brown/50 transition-colors"
              title="Sair"
            >
              <LogOut className="h-[18px] w-[18px]" />
              <span className="dock-label text-[10px] font-unbounded uppercase tracking-wide">Sair</span>
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}
