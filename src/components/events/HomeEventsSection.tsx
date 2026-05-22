import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, MapPin, Calendar } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { listHomeEvents } from "@/lib/events/tickets.functions";

const GRAN_VIA_MAPS =
  "https://www.google.com/maps/search/?api=1&query=Gran+V%C3%ADa+Madrid+Instituto+Empuria";

type EventRow = {
  id: string;
  slug: string;
  title: string;
  starts_at: string;
  cover_url: string | null;
  location_address: string | null;
};

const dayFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit" });
const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "short" });

function formatTag(iso: string) {
  const d = new Date(iso);
  const day = dayFmt.format(d);
  const month = monthFmt.format(d).replace(".", "").toUpperCase();
  return { day, month };
}

export function HomeEventsSection() {
  const fetchEvents = useServerFn(listHomeEvents);
  const { data } = useQuery({
    queryKey: ["home-events"],
    queryFn: () => fetchEvents(),
  });

  const upcoming = (data?.upcoming ?? []) as EventRow[];
  const past = (data?.past ?? []) as EventRow[];

  return (
    <section id="eventos" className="bg-offwhite py-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-3xl">
          <Reveal>
            <div className="text-orange-brand font-display font-semibold text-xs tracking-[0.3em] uppercase mb-4">
              Agenda & Comunidade
            </div>
          </Reveal>
          <Reveal delay={100}>
            <h2 className="font-display font-extrabold uppercase text-4xl md:text-5xl leading-[1] text-brown">
              A Agenda Empuria:{" "}
              <span className="text-orange-brand">nossa comunidade em movimento.</span>
            </h2>
          </Reveal>
          <Reveal delay={200}>
            <p className="font-body italic mt-5 text-brown-deep/75 text-lg">
              Mais do que serviços, criamos conexões. Confira os próximos encontros na Gran Vía
              ou relembre o que já rolou por aqui.
            </p>
          </Reveal>
        </div>

        {/* CENÁRIO A — eventos próximos */}
        {upcoming.length > 0 ? (
          <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {upcoming.map((ev, i) => {
              const { day, month } = formatTag(ev.starts_at);
              return (
                <Reveal key={ev.id} delay={i * 80}>
                  <Link
                    to="/evento/$slug"
                    params={{ slug: ev.slug }}
                    className="group block rounded-2xl overflow-hidden bg-brown text-offwhite shadow-warm hover:-translate-y-1 transition-all border border-brown-deep/10"
                  >
                    <div className="relative aspect-[4/5]">
                      {ev.cover_url ? (
                        <img
                          src={ev.cover_url}
                          alt={ev.title}
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-brown to-brown-deep" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-brown via-brown/20 to-transparent" />
                      <div className="absolute top-4 left-4 bg-yellow-brand text-brown rounded-lg px-3 py-2 text-center shadow-warm">
                        <div className="font-display font-extrabold text-2xl leading-none">{day}</div>
                        <div className="font-display font-semibold text-[10px] tracking-widest mt-0.5">{month}</div>
                      </div>
                    </div>
                    <div className="p-5">
                      <h3 className="font-display font-extrabold text-xl uppercase leading-tight">
                        {ev.title}
                      </h3>
                      {ev.location_address && (
                        <div className="mt-2 flex items-start gap-2 text-offwhite/70 text-sm font-body">
                          <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-yellow-brand" />
                          <span className="line-clamp-2">{ev.location_address}</span>
                        </div>
                      )}
                      <div className="mt-5 inline-flex items-center gap-2 bg-orange-brand text-offwhite px-5 py-3 rounded-md font-display font-bold text-xs uppercase tracking-widest group-hover:bg-yellow-brand group-hover:text-brown transition-colors">
                        Ver Detalhes e Ingressos <ArrowRight className="w-4 h-4" />
                      </div>
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        ) : (
          // CENÁRIO B — card convite
          <Reveal>
            <div className="mt-14 relative overflow-hidden rounded-2xl bg-brown bg-topo text-offwhite p-10 md:p-16 border border-yellow-brand/20 shadow-warm">
              <div className="absolute top-0 right-0 w-96 h-96 bg-yellow-brand/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
              <div className="relative max-w-3xl">
                <div className="inline-flex items-center gap-2 text-yellow-brand font-display font-semibold text-xs tracking-[0.3em] uppercase mb-5">
                  <Calendar className="w-4 h-4" /> Próximo encontro
                </div>
                <h3 className="font-display font-extrabold text-3xl md:text-4xl uppercase leading-tight">
                  Em breve, novos encontros.<br />
                  <span className="text-yellow-brand">As portas seguem abertas.</span>
                </h3>
                <p className="font-body mt-6 text-offwhite/80 text-lg leading-relaxed">
                  Nossa equipe está preparando a próxima grande experiência para a comunidade.
                  Enquanto a data não sai, as portas da Gran Vía seguem abertas. Venha tomar um
                  café, jogar uma partida de videogame e bater um papo conosco hoje mesmo.
                </p>
                <a
                  href={GRAN_VIA_MAPS}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-8 inline-flex items-center gap-2 border border-offwhite/70 text-offwhite hover:bg-offwhite hover:text-brown px-7 py-4 rounded-md font-display font-bold text-sm uppercase tracking-widest transition-all"
                >
                  <MapPin className="w-4 h-4" /> Como chegar ao Instituto
                </a>
              </div>
            </div>
          </Reveal>
        )}

        {/* Vitrine de eventos passados */}
        {past.length > 0 && (
          <div className="mt-20">
            <Reveal>
              <div className="flex items-end justify-between mb-6 border-b border-brown/10 pb-3">
                <h3 className="font-display font-bold text-brown uppercase tracking-widest text-xs">
                  Como foi por aqui · Galeria da comunidade
                </h3>
                <span className="font-body italic text-xs text-brown-deep/60 hidden md:block">
                  Passe o mouse para reviver
                </span>
              </div>
            </Reveal>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {past.map((ev) => (
                <Link
                  key={ev.id}
                  to="/evento/$slug"
                  params={{ slug: ev.slug }}
                  className="group relative aspect-square overflow-hidden rounded-md bg-brown-deep/10"
                >
                  {ev.cover_url ? (
                    <img
                      src={ev.cover_url}
                      alt={ev.title}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-brown to-brown-deep" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-brown via-brown/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-3">
                    <span className="font-display font-bold text-offwhite text-xs uppercase leading-tight">
                      Como foi o {ev.title}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
