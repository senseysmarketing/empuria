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
      <div className="mx-auto max-w-3xl bg-brown-deep/95 backdrop-blur-xl border border-brown/40 rounded-2xl shadow-2xl">
        <ul className="flex items-stretch justify-between gap-1 px-3 py-2">
          <li className="flex items-center px-2">
            <img src={logoIcone} alt="Empuria" className="h-7 w-7 object-contain opacity-90" />
          </li>
          <li className="w-px self-stretch bg-brown/60 mx-1" />
          {items.map((it) => {
            const active = isActive(it.to, "exact" in it ? it.exact : false);
            return (
              <li key={it.to} className="flex-1">
                <Link
                  to={it.to}
                  data-active={active}
                  className="admin-dock-item group flex items-center justify-center h-12 px-3 rounded-xl text-offwhite/80 hover:text-offwhite hover:bg-brown/60 data-[active=true]:bg-orange-brand data-[active=true]:text-offwhite transition-colors"
                >
                  <it.icon className="h-5 w-5 shrink-0" />
                  <span className="dock-label text-xs font-display uppercase tracking-wider">{it.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="w-px self-stretch bg-brown/60 mx-1" />
          <li>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/login" });
              }}
              className="admin-dock-item flex items-center justify-center h-12 px-3 rounded-xl text-offwhite/60 hover:text-red-brand hover:bg-brown/60 transition-colors"
              title="Sair"
            >
              <LogOut className="h-5 w-5" />
              <span className="dock-label text-xs font-display uppercase tracking-wider">Sair</span>
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}
