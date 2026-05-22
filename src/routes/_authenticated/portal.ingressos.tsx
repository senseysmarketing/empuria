import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMyTickets } from "@/lib/events/tickets.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Ticket, MapPin, Calendar } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/ingressos")({
  component: TicketsPage,
});

function TicketsPage() {
  const fetchTickets = useServerFn(getMyTickets);
  const { data, isLoading } = useQuery({ queryKey: ["my-tickets"], queryFn: () => fetchTickets() });

  if (isLoading || !data) return <div className="text-admin-ink-muted">Carregando...</div>;

  // Group by event+tier
  const groups = new Map<string, { event: typeof data.events[number]; tier: typeof data.tiers[number]; tickets: typeof data.tickets }>();
  for (const t of data.tickets) {
    const key = `${t.event_id}::${t.tier_id}`;
    const ev = data.events.find((e) => e.id === t.event_id);
    const tier = data.tiers.find((x) => x.id === t.tier_id);
    if (!ev || !tier) continue;
    if (!groups.has(key)) groups.set(key, { event: ev, tier, tickets: [] });
    groups.get(key)!.tickets.push(t);
  }
  const list = Array.from(groups.values()).sort((a, b) =>
    new Date(b.event.starts_at).getTime() - new Date(a.event.starts_at).getTime()
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold text-admin-ink">Meus Ingressos</h1>
        <p className="text-admin-ink-muted text-sm font-body">Apresente seu Passaporte Empuria na entrada.</p>
      </header>

      {list.length === 0 && (
        <BentoCard padded>
          <div className="text-center py-8">
            <Ticket className="h-10 w-10 mx-auto opacity-30 text-admin-ink" />
            <p className="mt-2 text-sm text-admin-ink-muted">Nenhum ingresso ainda.</p>
            <Link to="/" className="text-admin-accent text-sm font-display uppercase tracking-wider">Explorar eventos</Link>
          </div>
        </BentoCard>
      )}

      <div className="grid grid-cols-12 gap-4">
        {list.map(({ event, tier, tickets }) => {
          const used = tickets.filter((t) => t.status === "usado").length;
          const valid = tickets.filter((t) => t.status === "valido").length;
          const isPast = new Date(event.starts_at) < new Date(Date.now() - 1000 * 60 * 60 * 12);
          return (
            <BentoCard key={`${event.id}-${tier.id}`} className="col-span-12 md:col-span-6" padded>
              {event.cover_url && (
                <img src={event.cover_url} alt={event.title} className="w-full h-32 object-cover rounded-lg mb-3" />
              )}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-lg text-admin-ink truncate">{event.title}</h3>
                  <p className="text-xs text-admin-ink-muted flex items-center gap-1.5 mt-1">
                    <Calendar className="h-3 w-3" />
                    {new Date(event.starts_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                  {event.location_address && (
                    <p className="text-xs text-admin-ink-muted flex items-center gap-1.5 mt-0.5">
                      <MapPin className="h-3 w-3" /> {event.location_address}
                    </p>
                  )}
                </div>
                <span className={`text-[10px] uppercase tracking-widest px-2 py-1 rounded font-display ${isPast ? "bg-muted text-admin-ink-muted" : "bg-admin-accent text-white"}`}>
                  {tier.name} × {tickets.length}
                </span>
              </div>
              <div className="mt-3 flex gap-3 text-xs">
                <span className="text-admin-ink-muted">Válidos: <strong className="text-admin-ink">{valid}</strong></span>
                <span className="text-admin-ink-muted">Usados: <strong className="text-admin-ink">{used}</strong></span>
              </div>
            </BentoCard>
          );
        })}
      </div>
    </div>
  );
}
