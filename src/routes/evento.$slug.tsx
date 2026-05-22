import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getPublishedEvent } from "@/lib/events/tickets.functions";
import { Button } from "@/components/ui/button";
import { Calendar, MapPin, Ticket, Check } from "lucide-react";
import { EventCheckoutModal } from "@/components/events/EventCheckoutModal";

export const Route = createFileRoute("/evento/$slug")({
  loader: async ({ params }) => {
    const res = await getPublishedEvent({ data: { slug: params.slug } });
    if (!res.event) throw notFound();
    return res;
  },
  head: ({ loaderData }) => {
    const e = loaderData?.event;
    return {
      meta: [
        { title: e ? `${e.title} · Empuria` : "Evento" },
        { name: "description", content: e?.description?.slice(0, 160) ?? "Evento Empuria" },
        ...(e?.cover_url ? [{ property: "og:image", content: e.cover_url }] : []),
      ],
    };
  },
  component: EventPage,
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center text-offwhite bg-brown-deep">
      Evento não encontrado.
    </div>
  ),
  errorComponent: () => (
    <div className="min-h-screen flex items-center justify-center text-offwhite bg-brown-deep">
      Erro ao carregar evento.
    </div>
  ),
});

function EventPage() {
  const params = Route.useParams();
  const fetchEv = useServerFn(getPublishedEvent);
  const { data } = useQuery({
    queryKey: ["public-event", params.slug],
    queryFn: () => fetchEv({ data: { slug: params.slug } }),
  });
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  if (!data?.event) return null;
  const { event, tiers } = data;

  const isSimple = event.sales_mode === "simples";
  const activeTier = selectedTier
    ? tiers.find((t) => t.id === selectedTier)
    : isSimple ? tiers[0] : null;

  const startsAt = new Date(event.starts_at);
  const dateLabel = startsAt.toLocaleString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
  });

  const totalCents = activeTier ? activeTier.price_cents * qty : 0;
  const isFree = activeTier?.price_cents === 0;
  const ctaLabel = !activeTier
    ? "Selecione um ingresso"
    : isFree
      ? `Reservar (Gratuito)${qty > 1 ? ` · ${qty}` : ""}`
      : `Garantir ingresso · € ${(totalCents / 100).toFixed(2)}`;

  return (
    <div className="min-h-screen bg-offwhite text-brown-deep pb-28">
      {/* Hero */}
      <section className="relative h-[60vh] min-h-[420px] overflow-hidden">
        {event.cover_url && (
          <img src={event.cover_url} alt={event.title} className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-brown-deep via-brown-deep/60 to-transparent" />
        <div className="relative h-full max-w-6xl mx-auto px-6 flex flex-col justify-end pb-12 text-offwhite">
          <Link to="/" className="text-xs uppercase tracking-widest font-display opacity-70 mb-4">
            ← Empuria
          </Link>
          <p className="text-sm font-display uppercase tracking-widest mb-2" style={{ color: "#e5a657" }}>
            {dateLabel}
          </p>
          <h1 className="font-display text-5xl md:text-7xl font-bold leading-[0.95] mb-4 max-w-3xl">
            {event.title}
          </h1>
          {event.location_address && (
            <p className="text-sm md:text-base opacity-80 flex items-center gap-2">
              <MapPin className="h-4 w-4" /> {event.location_address}
            </p>
          )}
        </div>
      </section>

      {/* Bento grid */}
      <section className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-12 gap-4">
        <div className="col-span-12 md:col-span-8 bg-brown-deep text-offwhite rounded-2xl p-8">
          <h2 className="font-display uppercase tracking-widest text-xs opacity-60 mb-3">Sobre</h2>
          <p className="font-body text-base leading-relaxed whitespace-pre-line opacity-90">
            {event.description ?? "Detalhes em breve."}
          </p>
        </div>
        <div className="col-span-6 md:col-span-4 bg-orange-brand text-offwhite rounded-2xl p-6 flex flex-col justify-between">
          <Calendar className="h-6 w-6" />
          <div>
            <p className="text-xs uppercase tracking-widest font-display opacity-80">Quando</p>
            <p className="font-display text-xl mt-1">{dateLabel}</p>
          </div>
        </div>
        <div className="col-span-12 md:col-span-4 bg-brown text-offwhite rounded-2xl p-6 flex flex-col justify-between min-h-[180px]">
          <MapPin className="h-6 w-6" />
          <div>
            <p className="text-xs uppercase tracking-widest font-display opacity-80">Onde</p>
            <p className="font-display text-base mt-1">{event.location_address ?? "Local a definir"}</p>
          </div>
        </div>
        <div className="col-span-12 md:col-span-8 bg-offwhite border border-brown/20 rounded-2xl p-8">
          <h2 className="font-display uppercase tracking-widest text-xs opacity-60 mb-4">Ingressos</h2>
          <div className="space-y-3">
            {tiers.map((t) => {
              const soldOut = t.capacity != null && t.sold >= t.capacity;
              const remaining = t.capacity != null ? t.capacity - t.sold : null;
              const active = selectedTier === t.id || (isSimple && tiers.length === 1);
              return (
                <button
                  key={t.id}
                  disabled={soldOut}
                  onClick={() => { setSelectedTier(t.id); setQty(1); }}
                  className={`w-full text-left rounded-xl border p-4 transition ${
                    soldOut ? "border-brown/10 bg-muted/30 opacity-50 cursor-not-allowed" :
                    active ? "border-orange-brand bg-orange-brand/5" : "border-brown/20 hover:border-orange-brand/60"
                  }`}
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-display text-lg">{t.name}</h3>
                        {soldOut && <span className="text-[10px] uppercase tracking-widest bg-brown/80 text-offwhite px-2 py-0.5 rounded">Esgotado</span>}
                      </div>
                      {Array.isArray(t.benefits) && t.benefits.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {(t.benefits as string[]).map((b, i) => (
                            <li key={i} className="text-xs text-brown-deep/70 flex items-center gap-1.5">
                              <Check className="h-3 w-3 text-orange-brand" /> {b}
                            </li>
                          ))}
                        </ul>
                      )}
                      {remaining != null && !soldOut && remaining < 20 && (
                        <p className="text-[11px] text-red-brand mt-2 font-display uppercase tracking-wider">
                          Restam apenas {remaining}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-display text-2xl">
                        {t.price_cents === 0 ? "Grátis" : `€ ${(t.price_cents / 100).toFixed(2)}`}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {activeTier && (
            <div className="mt-6 flex items-center justify-between bg-muted/40 rounded-lg p-3">
              <span className="text-sm font-display uppercase tracking-wider">Quantidade</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-8 h-8 rounded-full border border-brown/20 hover:bg-brown/10">−</button>
                <span className="w-8 text-center font-display text-lg">{qty}</span>
                <button onClick={() => setQty(Math.min(10, qty + 1))} className="w-8 h-8 rounded-full border border-brown/20 hover:bg-brown/10">+</button>
              </div>
            </div>
          )}
        </div>
        <div className="col-span-12 md:col-span-4 bg-brown-deep text-offwhite rounded-2xl p-6">
          <Ticket className="h-6 w-6 text-orange-brand" />
          <p className="font-display uppercase tracking-widest text-xs opacity-60 mt-3">Como funciona</p>
          <p className="font-body text-sm mt-2 opacity-90">
            Compre uma vez, apresente seu Passaporte Empuria na entrada. Nada de QR avulso — você é o ingresso.
          </p>
        </div>
      </section>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-brown-deep/95 backdrop-blur-xl border-t border-brown/40 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div className="text-offwhite min-w-0">
            <p className="text-xs uppercase tracking-widest opacity-70 font-display truncate">{event.title}</p>
            {activeTier && (
              <p className="font-display text-sm">{activeTier.name} × {qty}</p>
            )}
          </div>
          <Button
            disabled={!activeTier}
            onClick={() => setCheckoutOpen(true)}
            className="bg-orange-brand hover:bg-red-brand text-offwhite font-display"
            size="lg"
          >
            {ctaLabel}
          </Button>
        </div>
      </div>

      {activeTier && (
        <EventCheckoutModal
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          event={{ id: event.id, title: event.title }}
          tier={{ id: activeTier.id, name: activeTier.name, price_cents: activeTier.price_cents }}
          qty={qty}
        />
      )}
    </div>
  );
}
