import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, MapPin, Calendar } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { listHomeEvents } from "@/lib/events/tickets.functions";

const GRAN_VIA_MAPS = "https://maps.app.goo.gl/RCrtChFM8PC1Ycbs7";

type EventRow = {
  id: string;
  slug: string;
  title: string;
  starts_at: string;
  cover_url: string | null;
  cover_url_vertical?: string | null;
  location_address: string | null;
  is_home_featured?: boolean;
};

const dayFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit" });
const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "short" });
const fullDateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

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

  const featured = (data?.featured ?? null) as EventRow | null;
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
              Mais do que serviços, criamos conexões. Confira os próximos encontros na Gran Via, 40
              ou relembre o que já rolou por aqui.
            </p>
          </Reveal>
        </div>

        {/* DESTAQUE — evento manual em destaque na home */}
        {featured && (
          <Reveal>
            <Link
              to="/evento/$slug"
              params={{ slug: featured.slug }}
              className="group mt-14 block relative overflow-hidden rounded-2xl bg-brown text-offwhite shadow-warm border border-yellow-brand/20"
            >
              {/* Mobile: vertical 4:5 */}
              <div className="md:hidden relative aspect-[4/5]">
                {(featured.cover_url_vertical || featured.cover_url) ? (
                  <img
                    src={featured.cover_url_vertical || featured.cover_url || ""}
                    alt={featured.title}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-brown to-brown-deep" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-brown via-brown/40 to-transparent" />
                <div className="absolute top-4 left-4 bg-yellow-brand text-brown rounded-lg px-3 py-2 text-center shadow-warm">
                  <div className="font-display font-extrabold text-2xl leading-none">{formatTag(featured.starts_at).day}</div>
                  <div className="font-display font-semibold text-[10px] tracking-widest mt-0.5">{formatTag(featured.starts_at).month}</div>
                </div>
                <div className="absolute inset-x-0 bottom-0 p-6">
                  <div className="text-yellow-brand font-display font-semibold text-[10px] tracking-[0.3em] uppercase mb-2">
                    Evento em destaque
                  </div>
                  <h3 className="font-display font-extrabold text-2xl uppercase leading-tight">
                    {featured.title}
                  </h3>
                  {featured.location_address && (
                    <div className="mt-2 flex items-start gap-2 text-offwhite/80 text-sm font-body">
                      <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-yellow-brand" />
                      <span className="line-clamp-2">{featured.location_address}</span>
                    </div>
                  )}
                  <div className="mt-4 inline-flex items-center gap-2 bg-orange-brand text-offwhite px-5 py-3 rounded-md font-display font-bold text-xs uppercase tracking-widest">
                    Ver detalhes e ingressos <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </div>

              {/* Desktop: horizontal 21:9 */}
              <div className="hidden md:block relative aspect-[21/9]">
                {featured.cover_url ? (
                  <img
                    src={featured.cover_url}
                    alt={featured.title}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-brown to-brown-deep" />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-brown via-brown/60 to-transparent" />
                <div className="absolute top-6 left-6 bg-yellow-brand text-brown rounded-lg px-4 py-3 text-center shadow-warm">
                  <div className="font-display font-extrabold text-3xl leading-none">{formatTag(featured.starts_at).day}</div>
                  <div className="font-display font-semibold text-xs tracking-widest mt-1">{formatTag(featured.starts_at).month}</div>
                </div>
                <div className="absolute inset-y-0 left-0 flex flex-col justify-end p-10 max-w-2xl">
                  <div className="text-yellow-brand font-display font-semibold text-xs tracking-[0.3em] uppercase mb-3">
                    Evento em destaque · {fullDateFmt.format(new Date(featured.starts_at))}
                  </div>
                  <h3 className="font-display font-extrabold text-offwhite text-3xl lg:text-5xl uppercase leading-[1]">
                    {featured.title}
                  </h3>
                  {featured.location_address && (
                    <div className="mt-4 flex items-start gap-2 text-offwhite/80 text-sm font-body">
                      <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-yellow-brand" />
                      <span>{featured.location_address}</span>
                    </div>
                  )}
                  <div className="mt-6 inline-flex items-center gap-2 self-start bg-orange-brand text-offwhite group-hover:bg-yellow-brand group-hover:text-brown px-6 py-3 rounded-md font-display font-bold text-xs uppercase tracking-widest transition-all">
                    Ver detalhes e ingressos <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </Link>
          </Reveal>
        )}

        {(() => {
          const others = [...upcoming, ...past];
          if (others.length === 0) {
            if (featured) return null;
            return (
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
                      Enquanto a data não sai, as portas da Gran Via, 40 seguem abertas. Venha tomar um
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
            );
          }

          const gridCols =
            others.length === 1 ? "md:grid-cols-1 md:max-w-[280px] md:mx-auto"
            : others.length === 2 ? "md:grid-cols-2 md:max-w-3xl md:mx-auto"
            : "md:grid-cols-2 lg:grid-cols-3 lg:max-w-5xl lg:mx-auto";

          const renderCard = (ev: EventRow, i: number) => {
            const { day, month } = formatTag(ev.starts_at);
            const img = ev.cover_url_vertical || ev.cover_url;
            return (
              <Reveal key={ev.id} delay={i * 80}>
                <Link
                  to="/evento/$slug"
                  params={{ slug: ev.slug }}
                  className="group block rounded-2xl overflow-hidden bg-brown text-offwhite shadow-warm hover:-translate-y-1 transition-all border border-brown-deep/10 h-full"
                >
                  <div className="relative aspect-[4/5]">
                    {img ? (
                      <img
                        src={img}
                        alt={ev.title}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-brown to-brown-deep" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-brown via-brown/20 to-transparent" />
                    <div className="absolute top-3 left-3 bg-yellow-brand text-brown rounded-md px-2.5 py-1.5 text-center shadow-warm">
                      <div className="font-display font-extrabold text-lg leading-none">{day}</div>
                      <div className="font-display font-semibold text-[9px] tracking-widest mt-0.5">{month}</div>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-display font-extrabold text-base uppercase leading-tight line-clamp-2">
                      {ev.title}
                    </h3>
                    {ev.location_address && (
                      <div className="mt-1.5 flex items-start gap-1.5 text-offwhite/70 text-xs font-body">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-yellow-brand" />
                        <span className="line-clamp-1">{ev.location_address}</span>
                      </div>
                    )}
                    <div className="mt-4 inline-flex items-center gap-1.5 bg-orange-brand text-offwhite px-3.5 py-2 rounded-md font-display font-bold text-[11px] uppercase tracking-widest group-hover:bg-yellow-brand group-hover:text-brown transition-colors">
                      Ver Detalhes <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </Link>
              </Reveal>
            );
          };

          return (
            <>
              {/* Mobile: carrossel horizontal com snap */}
              <div className="md:hidden mt-14 -mx-6 px-6 flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4">
                {others.map((ev, i) => {
                  const { day, month } = formatTag(ev.starts_at);
                  const img = ev.cover_url_vertical || ev.cover_url;
                  return (
                    <Link
                      key={ev.id}
                      to="/evento/$slug"
                      params={{ slug: ev.slug }}
                      className={`group shrink-0 snap-start rounded-2xl overflow-hidden bg-brown text-offwhite shadow-warm border border-brown-deep/10 ${others.length === 1 ? "w-full" : "w-[70%]"}`}
                    >
                      <div className="relative aspect-[4/5]">
                        {img ? (
                          <img
                            src={img}
                            alt={ev.title}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
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
                        <div className="mt-5 inline-flex items-center gap-2 bg-orange-brand text-offwhite px-5 py-3 rounded-md font-display font-bold text-xs uppercase tracking-widest">
                          Ver Detalhes e Ingressos <ArrowRight className="w-4 h-4" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>

              {/* Desktop: grid responsivo */}
              <div className={`hidden md:grid mt-14 gap-6 ${gridCols}`}>
                {others.map(renderCard)}
              </div>
            </>
          );
        })()}
      </div>
    </section>
  );
}
