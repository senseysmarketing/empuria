import { Link } from "@tanstack/react-router";
import { Calendar, Coffee, ArrowRight } from "lucide-react";

type Appt = {
  id: string;
  starts_at: string;
  services?: { title?: string | null; kind?: string | null; meeting_address?: string | null } | null;
} | null;

export function NextStepWidget({ appointment }: { appointment: Appt }) {
  if (appointment) {
    const d = new Date(appointment.starts_at);
    const dateLabel = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
    const timeLabel = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest font-display text-admin-accent mb-3">
          <Calendar className="h-3.5 w-3.5" /> Próximo passo
        </div>
        <div className="font-display text-xl font-bold text-admin-ink leading-tight mb-1">
          {appointment.services?.title ?? "Agendamento"}
        </div>
        <div className="text-sm text-admin-ink-soft capitalize">{dateLabel}</div>
        <div className="text-admin-ink font-display text-2xl tabular-nums mt-1">{timeLabel}</div>
        {appointment.services?.meeting_address && (
          <div className="text-xs text-admin-ink-muted mt-2">{appointment.services.meeting_address}</div>
        )}
        <Link
          to="/portal/servicos"
          className="mt-auto inline-flex items-center gap-1 text-xs font-display uppercase tracking-wider text-admin-accent hover:underline pt-4"
        >
          Ver detalhes <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest font-display text-admin-accent mb-3">
        <Coffee className="h-3.5 w-3.5" /> Convite
      </div>
      <div className="font-display text-xl font-bold text-admin-ink leading-tight mb-2">
        O café está quente na Gran Vía.
      </div>
      <p className="text-sm text-admin-ink-soft font-body">
        Venha nos visitar hoje, ou contrate um serviço da Esteira para iniciar sua jornada.
      </p>
      <Link
        to="/portal/loja"
        className="mt-auto inline-flex items-center gap-1 text-xs font-display uppercase tracking-wider text-admin-accent hover:underline pt-4"
      >
        Ver serviços <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
