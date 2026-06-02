import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  PackageCheck,
  Filter,
  CalendarDays,
  LogOut,
  Home,
  Wine,
  Ticket,
  Users,
  WalletCards,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useModuleAccess } from "@/hooks/use-module-access";
import logoIcone from "@/assets/logo-empuria-icone.png";

const items = [
  { to: "/admin", label: "Cockpit", icon: LayoutDashboard, exact: true, module: "cockpit" },
  { to: "/admin/pdv", label: "PDV", icon: Wine, module: "pdv" },
  { to: "/admin/eventos", label: "Eventos", icon: Ticket, module: "eventos" },
  { to: "/admin/esteira", label: "Esteira", icon: PackageCheck, module: "esteira" },
  { to: "/admin/crm", label: "CRM", icon: Filter, module: "crm" },
  { to: "/admin/financeiro", label: "Caixa", icon: WalletCards, module: "financeiro" },
  { to: "/admin/agenda", label: "Agenda", icon: CalendarDays, module: "agenda" },
  { to: "/admin/usuarios", label: "Usuários", icon: Users, module: "usuarios" },
] as const;

export function AdminDock() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { can } = useModuleAccess();

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  const visibleItems = items.filter((it) => can(it.module));

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 px-4 pb-4">
      <div className="mx-auto max-w-3xl bg-brown-deep/95 backdrop-blur-xl border border-brown/40 rounded-2xl shadow-2xl">
        <ul className="flex items-center justify-between gap-0 px-2 py-2">
          <li className="flex items-center px-1.5">
            <Link
              to="/admin"
              aria-label="Cockpit"
              className="flex items-center transition-opacity hover:opacity-100 opacity-90"
            >
              <img src={logoIcone} alt="Empuria" className="h-6 w-6 object-contain" />
            </Link>
          </li>
          <li className="w-px h-5 bg-brown/60 mx-0.5" />
          {visibleItems.map((it) => {
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
          <li className="w-px h-5 bg-brown/60 mx-0.5" />
          <li>
            <Link
              to="/admin/usuarios"
              className="admin-dock-item flex items-center justify-center h-10 px-2.5 rounded-full text-offwhite/50 hover:text-offwhite hover:bg-brown/50 transition-colors"
              title="Impersonar membro"
            >
              <Home className="h-[18px] w-[18px]" />
              <span className="dock-label text-[10px] font-display uppercase tracking-wide">
                Membro
              </span>
            </Link>
          </li>
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
