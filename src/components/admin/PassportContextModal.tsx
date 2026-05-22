import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { registerCheckIn, openTab } from "@/lib/admin/pdv.functions";
import { Crown, MapPin, CalendarClock, Receipt, ShoppingBag, UserCheck } from "lucide-react";
import { toast } from "sonner";

export type PassportContext = {
  profile: { id: string; full_name: string | null; avatar_url: string | null; is_club_member: boolean; created_at: string; phone: string | null };
  visitCount: number;
  todayAppointments: Array<{ id: string; starts_at: string; status: string; services: { title: string } | null }>;
  nextAppointment: { id: string; starts_at: string; status: string; services: { title: string } | null } | null;
  openTab: { id: string; total_cents: number; opened_at: string } | null;
  activeServices: Array<{ id: string; service_title: string; delivery_status: string }>;
};

export function PassportContextModal({ context, open, onClose }: { context: PassportContext; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const checkIn = useServerFn(registerCheckIn);
  const openTabFn = useServerFn(openTab);
  const p = context.profile;
  const initial = (p.full_name ?? "?").charAt(0).toUpperCase();

  const doCheckIn = async () => {
    try {
      await checkIn({ data: { userId: p.id, visitorName: p.full_name ?? "Membro", purpose: "Check-in via passaporte" } });
      toast.success("Chegada registrada");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const goToPdv = async () => {
    try {
      const { tabId } = await openTabFn({ data: { userId: p.id } });
      onClose();
      navigate({ to: "/admin/pdv", search: { tab: tabId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-admin-surface border-admin-border text-admin-ink max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Hospitalidade · Passaporte Empuria</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Perfil */}
          <div className="md:col-span-1 bg-gradient-to-br from-brown-deep via-brown to-red-brand rounded-xl p-5 text-offwhite">
            <div className="flex items-center gap-3 mb-4">
              {p.avatar_url ? (
                <img src={p.avatar_url} alt={p.full_name ?? ""} className="h-16 w-16 rounded-full object-cover ring-2 ring-yellow-brand" />
              ) : (
                <div className="h-16 w-16 rounded-full bg-offwhite/15 flex items-center justify-center text-2xl font-display font-bold">{initial}</div>
              )}
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-yellow-brand/90 font-display">Passageiro</div>
                <div className="font-display text-lg font-bold truncate">{p.full_name ?? "Imigrante"}</div>
              </div>
            </div>
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-widest font-display ${p.is_club_member ? "bg-yellow-brand text-brown-deep" : "bg-offwhite/15"}`}>
              <Crown className="h-3 w-3" /> {p.is_club_member ? "Classe Clube" : "Standard"}
            </div>
            <div className="mt-4 text-[11px] text-offwhite/70 font-body">
              Desde {new Date(p.created_at).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
            </div>
          </div>

          {/* Contexto */}
          <div className="bg-admin-surface-2 border border-admin-border rounded-xl p-5 flex flex-col">
            <div className="text-[10px] uppercase tracking-widest text-admin-ink-muted font-display">Contexto</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold text-admin-accent tabular-nums">{context.visitCount}ª</span>
              <MapPin className="h-4 w-4 text-admin-ink-muted" />
            </div>
            <div className="text-sm text-admin-ink mt-1">Visita ao Instituto</div>
            {context.openTab && (
              <div className="mt-auto pt-3 border-t border-admin-border text-xs">
                <span className="inline-flex items-center gap-1 text-yellow-brand font-display uppercase tracking-wider">
                  <Receipt className="h-3 w-3" /> Comanda aberta
                </span>
                <div className="text-admin-ink mt-1 font-display text-lg">€ {(context.openTab.total_cents / 100).toFixed(2)}</div>
              </div>
            )}
          </div>

          {/* Agenda */}
          <div className="bg-admin-surface-2 border border-admin-border rounded-xl p-5">
            <div className="text-[10px] uppercase tracking-widest text-admin-ink-muted font-display mb-2">Agenda</div>
            {context.todayAppointments.length === 0 && !context.nextAppointment ? (
              <p className="text-xs text-admin-ink-muted">Sem agendamentos.</p>
            ) : (
              <ul className="space-y-2">
                {context.todayAppointments.map((a) => (
                  <li key={a.id} className="text-sm">
                    <div className="flex items-center gap-1.5 text-admin-accent font-display uppercase tracking-wider text-[10px]">
                      <CalendarClock className="h-3 w-3" /> Hoje · {new Date(a.starts_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="text-admin-ink">{a.services?.title ?? "Reunião"}</div>
                  </li>
                ))}
                {context.todayAppointments.length === 0 && context.nextAppointment && (
                  <li className="text-sm">
                    <div className="text-[10px] uppercase tracking-wider text-admin-ink-muted font-display">Próximo</div>
                    <div className="text-admin-ink">{context.nextAppointment.services?.title}</div>
                    <div className="text-xs text-admin-ink-muted">
                      {new Date(context.nextAppointment.starts_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </li>
                )}
              </ul>
            )}
            {context.activeServices.length > 0 && (
              <div className="mt-3 pt-3 border-t border-admin-border">
                <div className="text-[10px] uppercase tracking-widest text-admin-ink-muted font-display mb-1">Serviços ativos</div>
                {context.activeServices.slice(0, 2).map((s) => (
                  <div key={s.id} className="text-xs text-admin-ink truncate">• {s.service_title}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-2">
          <Button onClick={doCheckIn} variant="outline" className="flex-1 border-admin-border">
            <UserCheck className="h-4 w-4 mr-2" /> Registrar chegada
          </Button>
          <Button onClick={goToPdv} className="flex-1 bg-orange-brand hover:bg-red-brand text-offwhite">
            <ShoppingBag className="h-4 w-4 mr-2" /> Abrir Comanda (PDV)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
