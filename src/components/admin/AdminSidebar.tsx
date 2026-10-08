import { useEffect } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  Home,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  PackageCheck,
  Settings,
  Ticket,
  Users,
  WalletCards,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import logoCompleta from "@/assets/logo-empuria-completa.png";
import logoIcone from "@/assets/logo-empuria-icone.png";

const mainItems = [
  { to: "/admin", label: "Cockpit", icon: LayoutDashboard, exact: true },
  { to: "/admin/pdv", label: "PDV", icon: Wine },
  { to: "/admin/eventos", label: "Eventos", icon: Ticket },
  { to: "/admin/esteira", label: "Pedidos", icon: PackageCheck },
  { to: "/admin/crm", label: "CRM", icon: Filter },
  { to: "/admin/financeiro", label: "Financeiro", icon: WalletCards, adminOnly: true },
  { to: "/admin/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/admin/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/admin/usuarios", label: "Membros", icon: Users },
] as const;

type SidebarProps = {
  collapsed: boolean;
  isAdmin: boolean;
  mobileOpen: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onMobileOpenChange: (open: boolean) => void;
};

type SidebarItemProps = {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  locked?: boolean;
  onNavigate?: () => void;
};

function SidebarItem({
  to,
  label,
  icon: Icon,
  active,
  collapsed,
  locked,
  onNavigate,
}: SidebarItemProps) {
  const link = (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "group flex h-10 items-center rounded-lg text-sm font-display transition-colors",
        collapsed ? "justify-center px-0" : "gap-3 px-3",
        active
          ? "bg-orange-brand text-white shadow-sm"
          : "text-offwhite/70 hover:bg-white/8 hover:text-offwhite",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && locked && (
        <LockKeyhole
          className="h-3.5 w-3.5 shrink-0 text-yellow-brand"
          aria-label="Exclusivo de admin"
        />
      )}
      {collapsed && locked && (
        <span
          className="absolute ml-7 mt-7 h-2 w-2 rounded-full bg-yellow-brand"
          aria-hidden="true"
        />
      )}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className="bg-brown-deep text-offwhite">
        {label}
        {locked ? " · exclusivo de admin" : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarContents({
  collapsed,
  onCollapsedChange,
  onNavigate,
  mobile = false,
  isAdmin,
}: {
  collapsed: boolean;
  isAdmin: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);

  const signOut = async () => {
    await supabase.auth.signOut();
    onNavigate?.();
    navigate({ to: "/login/admin", search: { redirect: undefined } });
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full min-h-0 flex-col bg-brown-deep text-offwhite">
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-white/10",
            collapsed ? "justify-center px-2" : "px-4",
          )}
        >
          <Link to="/admin" onClick={onNavigate} aria-label="Instituto Empuria — Cockpit">
            <img
              src={collapsed ? logoIcone : logoCompleta}
              alt="Instituto Empuria"
              className={cn("object-contain", collapsed ? "h-8 w-8" : "h-9 w-auto max-w-40")}
            />
          </Link>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-4" aria-label="Administração">
          <ul className="space-y-1">
            {mainItems.map((item) => (
              <li key={item.to} className="relative">
                <SidebarItem
                  to={item.to}
                  label={item.label}
                  icon={item.icon}
                  active={isActive(item.to, "exact" in item ? item.exact : false)}
                  collapsed={collapsed}
                  locked={"adminOnly" in item && item.adminOnly && !isAdmin}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </nav>

        <div className="shrink-0 space-y-1 border-t border-white/10 p-2">
          <SidebarItem
            to="/admin/usuarios"
            label="Membro"
            icon={Home}
            active={false}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
          <SidebarItem
            to="/admin/configuracoes"
            label="Configurações"
            icon={Settings}
            active={isActive("/admin/configuracoes")}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={signOut}
                aria-label={collapsed ? "Sair" : undefined}
                className={cn(
                  "flex h-10 w-full items-center rounded-lg text-sm font-display text-offwhite/60 transition-colors hover:bg-white/8 hover:text-red-300",
                  collapsed ? "justify-center px-0" : "gap-3 px-3",
                )}
              >
                <LogOut className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span>Sair</span>}
              </button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right" className="bg-brown-deep text-offwhite">
                Sair
              </TooltipContent>
            )}
          </Tooltip>

          {!mobile && (
            <button
              type="button"
              onClick={() => onCollapsedChange(!collapsed)}
              aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
              className={cn(
                "mt-2 flex h-9 w-full items-center rounded-lg border border-white/10 text-xs font-display uppercase tracking-wider text-offwhite/55 transition-colors hover:border-white/20 hover:bg-white/8 hover:text-offwhite",
                collapsed ? "justify-center" : "justify-between px-3",
              )}
            >
              {!collapsed && <span>Recolher</span>}
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

export function AdminSidebar({
  collapsed,
  isAdmin,
  mobileOpen,
  onCollapsedChange,
  onMobileOpenChange,
}: SidebarProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    onMobileOpenChange(false);
    // Close the drawer whenever navigation completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-brown/40 bg-brown-deep shadow-xl transition-[width] duration-200 md:block",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        <SidebarContents
          collapsed={collapsed}
          isAdmin={isAdmin}
          onCollapsedChange={onCollapsedChange}
        />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent
          side="left"
          className="w-[min(86vw,320px)] border-brown/40 bg-brown-deep p-0 text-offwhite [&>button]:text-offwhite"
        >
          <SheetTitle className="sr-only">Menu administrativo</SheetTitle>
          <SidebarContents
            collapsed={false}
            isAdmin={isAdmin}
            mobile
            onCollapsedChange={onCollapsedChange}
            onNavigate={() => onMobileOpenChange(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
