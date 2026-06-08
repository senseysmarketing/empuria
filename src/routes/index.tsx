import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Reveal } from "@/components/Reveal";
import { ServiceCard, type PublicService } from "@/components/services/ServiceCard";
import { CheckoutModal } from "@/components/checkout/CheckoutModal";
import { ServiceDetailsModal } from "@/components/services/ServiceDetailsModal";
import { HomeEventsSection } from "@/components/events/HomeEventsSection";
import { ConsultoriaWizardModal } from "@/components/leads/ConsultoriaWizardModal";
import { listPublicServices } from "@/lib/services-public.functions";
import lounge from "@/assets/instituto-lounge.jpg";
import heroWelcome from "@/assets/hero-welcome-brazil-madrid.jpg.asset.json";
import manifesto1 from "@/assets/manifesto-instituto-1.jpg.asset.json";
import manifesto2 from "@/assets/manifesto-instituto-2.jpg.asset.json";
import manifesto3 from "@/assets/manifesto-instituto-3.jpg.asset.json";
import barbearia from "@/assets/instituto-barbearia.jpg";
import bar from "@/assets/instituto-bar.jpg";
import granvia from "@/assets/gran-via.jpg";
import {
  Compass,
  ShieldCheck,
  Handshake,
  Scissors,
  Beer,
  Gamepad2,
  Sparkles,
  ArrowRight,
  Check,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Instituto Empuria — A Embaixada Emocional do Brasileiro em Madrid" },
      {
        name: "description",
        content:
          "O primeiro instituto de imigração brasileiro do mundo. Na Gran Via, 40, em Madrid. Recepção no aeroporto, consultoria imigratória, espaço físico de acolhimento e mais.",
      },
      { property: "og:title", content: "Instituto Empuria — A Casa do Brasileiro em Madrid" },
      { property: "og:description", content: "Nenhum brasileiro está sozinho. Gran Via, 40 · Madrid." },
    ],
  }),
  component: HomePage,
});

const fastServices: never[] = [];

const espacoChecklist = [
  { icon: Scissors, text: "Barbearia com estilo e corte brasileiro — só chegar e esperar." },
  { icon: Beer, text: "Bar com cerveja gelada, Ruffles e petiscos com gosto de casa." },
  { icon: Gamepad2, text: "Sofá, videogame e aquele bate-papo sem pressa." },
  { icon: Sparkles, text: "Ambiente premium, 100% instagramável para registrar sua chegada." },
];

void fastServices;

function HomePage() {
  const fetchServices = useServerFn(listPublicServices);
  const { data: services = [] } = useQuery({
    queryKey: ["public-services"],
    queryFn: () => fetchServices(),
  });
  const [selected, setSelected] = useState<PublicService | null>(null);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<PublicService | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const onBuy = (s: PublicService) => {
    setSelected(s);
    setOpen(true);
  };
  const onDetails = (s: PublicService) => {
    setDetails(s);
    setDetailsOpen(true);
  };

  return (
    <div className="min-h-screen bg-offwhite text-brown-deep overflow-x-hidden">
      <SiteHeader />
      <CheckoutModal service={selected} open={open} onOpenChange={setOpen} />
      <ServiceDetailsModal
        service={details}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        onBuy={onBuy}
      />

      {/* HERO */}
      <section className="relative min-h-screen flex items-center pt-24 pb-16 bg-topo">
        <div className="absolute inset-0 bg-gradient-to-b from-brown/60 via-brown/70 to-brown" />
        <div
          className="absolute inset-0 opacity-25 mix-blend-overlay"
          style={{
            backgroundImage: `url(${granvia})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-6 grid lg:grid-cols-12 gap-10 items-center w-full">
          <div className="lg:col-span-8 text-offwhite">
            <Reveal>
              <div className="text-yellow-brand font-display font-semibold text-xs tracking-[0.3em] uppercase mb-6">
                ★ Bem-vindo à sua nova casa na Europa
              </div>
            </Reveal>
            <Reveal delay={100}>
              <h1 className="font-display font-extrabold uppercase leading-[0.95] text-5xl md:text-7xl lg:text-[5.5rem] tracking-tight">
                A Embaixada
                <br />
                <span className="text-yellow-brand">Emocional</span>
                <br />
                do brasileiro
                <br />
                no exterior.
              </h1>
            </Reveal>
            <Reveal delay={250}>
              <p className="font-body text-lg md:text-xl mt-8 text-offwhite/85 max-w-2xl leading-relaxed">
                Você cruzou o oceano para viver um sonho. Nós estamos aqui para garantir que você
                não precise vivê-lo sozinho. O primeiro instituto de imigração brasileiro do mundo,
                no coração de Madrid.
              </p>
            </Reveal>
            <Reveal delay={400}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a
                  href="#servicos"
                  className="inline-flex items-center gap-2 bg-orange-brand hover:bg-red-brand text-offwhite px-7 py-4 rounded-md font-display font-bold text-sm uppercase tracking-widest transition-all hover:shadow-warm hover:-translate-y-0.5"
                >
                  Ver Nossos Serviços <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href="https://maps.app.goo.gl/RCrtChFM8PC1Ycbs7"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-yellow-brand/60 text-yellow-brand hover:bg-yellow-brand hover:text-brown px-7 py-4 rounded-md font-display font-bold text-sm uppercase tracking-widest transition-all"
                >
                  Conhecer o Instituto Físico
                </a>
              </div>
            </Reveal>
          </div>

          <Reveal delay={500} className="lg:col-span-4 hidden lg:block">
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-sunset opacity-30 blur-3xl rounded-full" />
              <div className="relative aspect-[3/4] rounded-2xl overflow-hidden border-2 border-yellow-brand/30 shadow-warm">
                <img src={heroWelcome.url} alt="Welcome Brazil Madrid — Lounge do Instituto Empuria na Gran Via, 40" className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-6 -left-6 bg-offwhite text-brown-deep px-5 py-3 rounded-md shadow-warm">
                <div className="font-display font-extrabold text-xs uppercase tracking-widest text-orange-brand">
                  Gran Via, 40
                </div>
                <div className="font-body italic text-sm">Madrid · Espanha</div>
              </div>
            </div>
          </Reveal>
        </div>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-yellow-brand/70 font-body italic text-sm tracking-wide">
          Nenhum brasileiro está sozinho.
        </div>
      </section>

      {/* DOR E EMPATIA */}
      <section className="bg-offwhite py-24">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <Reveal>
              <div className="text-orange-brand font-display font-semibold text-xs tracking-[0.3em] uppercase mb-4">
                Por que existimos
              </div>
            </Reveal>
            <Reveal delay={100}>
              <h2 className="font-display font-extrabold text-4xl md:text-5xl uppercase leading-[1] text-brown">
                Emigrar exige
                <br />
                <span className="text-orange-brand">coragem.</span>
                <br />
                Mas o pouso não
                <br />
                precisa ser difícil.
              </h2>
            </Reveal>
          </div>
          <div className="lg:col-span-7">
            <Reveal delay={150}>
              <p className="font-body text-lg leading-relaxed text-brown-deep/80">
                Sabemos o que é chegar a um país novo. A burocracia intimida, a língua pode ser uma
                barreira inicial e a saudade de casa bate à porta. Foi por isso que o Instituto
                Empuria nasceu. Nós transformamos a jornada solitária do imigrante em uma
                experiência acolhedora, segura e direcionada. Não somos apenas uma agência; somos o
                seu ponto de apoio.
              </p>
            </Reveal>
            <div className="grid md:grid-cols-3 gap-5 mt-10">
              {[
                {
                  icon: Compass,
                  title: "Direção Clara",
                  text: "Do visto ao vale-transporte, mostramos o caminho das pedras.",
                },
                {
                  icon: ShieldCheck,
                  title: "Apoio Seguro",
                  text: "Chegue com tudo estruturado: aeroporto, moradia e banco.",
                },
                {
                  icon: Handshake,
                  title: "Comunidade Forte",
                  text: "Cercado de quem fala a sua língua e entende sua cultura.",
                },
              ].map((b, i) => (
                <Reveal key={b.title} delay={200 + i * 100}>
                  <div className="bg-muted/60 border border-border rounded-xl p-5 h-full hover:border-orange-brand/50 transition">
                    <b.icon className="w-7 h-7 text-orange-brand mb-3" strokeWidth={1.5} />
                    <div className="font-display font-bold text-brown text-base uppercase tracking-wide mb-1">
                      {b.title}
                    </div>
                    <div className="font-body text-sm text-brown-deep/75 leading-snug">
                      {b.text}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* MANIFESTO + ESPAÇO FÍSICO */}
      <section
        id="instituto"
        className="relative bg-topo bg-topo-red text-offwhite py-24 overflow-hidden"
      >
        <div className="absolute inset-0 bg-red-brand/85" />
        <div className="relative max-w-7xl mx-auto px-6 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6">
            <Reveal>
              <div className="text-yellow-brand font-display font-semibold text-xs tracking-[0.3em] uppercase mb-4">
                Manifesto · A Casa do Brasileiro
              </div>
            </Reveal>
            <Reveal delay={100}>
              <h2 className="font-display font-extrabold uppercase text-4xl md:text-6xl leading-[0.95]">
                Nenhum
                <br />
                brasileiro
                <br />
                <span className="text-yellow-brand">está sozinho.</span>
              </h2>
            </Reveal>
            <Reveal delay={200}>
              <p className="font-body italic text-xl mt-6 text-offwhite/90">
                Seu primeiro destino oficial em Madrid é na Gran Via, 40.
              </p>
            </Reveal>
            <Reveal delay={300}>
              <p className="font-body text-base mt-6 text-offwhite/85 leading-relaxed max-w-xl">
                Criamos um espaço físico focado 100% no seu acolhimento. Sem custos, sem necessidade
                de agendamento. Chegou em Madrid? A porta está aberta. Aqui dentro, o idioma oficial
                é o português e a energia é do Brasil.
              </p>
            </Reveal>
            <ul className="mt-8 space-y-3">
              {espacoChecklist.map((c, i) => (
                <Reveal key={c.text} delay={400 + i * 80}>
                  <li className="flex items-start gap-3 font-body">
                    <span className="mt-1 w-6 h-6 rounded-full bg-yellow-brand text-brown flex items-center justify-center shrink-0">
                      <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    </span>
                    <span className="text-offwhite/90 leading-snug">
                      <c.icon className="inline w-4 h-4 mr-1.5 text-yellow-brand" /> {c.text}
                    </span>
                  </li>
                </Reveal>
              ))}
            </ul>
            <Reveal delay={750}>
              <a
                href="https://maps.app.goo.gl/RCrtChFM8PC1Ycbs7"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-10 inline-flex items-center gap-2 bg-orange-brand hover:bg-yellow-brand hover:text-brown text-offwhite px-7 py-4 rounded-md font-display font-bold text-sm uppercase tracking-widest transition-all hover:shadow-warm"
              >
                Quero Visitar o Instituto <ArrowRight className="w-4 h-4" />
              </a>
            </Reveal>
          </div>

          {/* Carousel marquee */}
          <div className="lg:col-span-6 relative h-[520px] overflow-hidden rounded-2xl border border-yellow-brand/30">
            <div className="flex marquee-track gap-4 h-full" style={{ width: "200%" }}>
              {[manifesto1.url, manifesto2.url, manifesto3.url, manifesto1.url, manifesto2.url, manifesto3.url].map((src, i) => (
                <div
                  key={i}
                  className="relative h-full aspect-[3/4] shrink-0 rounded-xl overflow-hidden"
                >
                  <img
                    src={src}
                    alt="Espaço Empuria"
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-brown/60 to-transparent" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SERVIÇOS */}
      <section id="servicos" className="relative bg-topo text-offwhite py-24">
        <div className="absolute inset-0 bg-brown/90" />
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="max-w-3xl">
            <Reveal>
              <div className="text-yellow-brand font-display font-semibold text-xs tracking-[0.3em] uppercase mb-4">
                Nossos Serviços
              </div>
            </Reveal>
            <Reveal delay={100}>
              <h2 className="font-display font-extrabold uppercase text-4xl md:text-5xl leading-[1]">
                Tudo o que você precisa para se{" "}
                <span className="text-yellow-brand">estabelecer</span> na Espanha.
              </h2>
            </Reveal>
            <Reveal delay={200}>
              <p className="font-body mt-5 text-offwhite/80 text-lg">
                Do desembarque à regularização. Escolha o suporte ideal para o seu momento.
              </p>
            </Reveal>
          </div>

          {/* Esteira 1 — Cards rápidos */}
          <div className="mt-14">
            <div className="flex items-end justify-between mb-6 border-b border-yellow-brand/20 pb-3">
              <h3 className="font-display font-bold text-yellow-brand uppercase tracking-widest text-xs">
                Chegada & Praticidade · Compra Direta
              </h3>
              <span className="font-body italic text-xs text-offwhite/60 hidden md:block">
                Visualize, cadastre, confirme — só então geramos o pagamento.
              </span>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {services.slice(0, 6).map((s, i) => (
                <Reveal key={s.id} delay={i * 70}>
                  <ServiceCard
                    service={s as PublicService}
                    onBuy={onBuy}
                    onDetails={onDetails}
                    variant="dark"
                  />
                </Reveal>
              ))}
            </div>
          </div>

          {/* Esteira 2 — High ticket */}
          <Reveal>
            <div className="mt-16 relative overflow-hidden rounded-2xl border border-yellow-brand/30 bg-gradient-to-br from-brown-deep to-brown p-10 md:p-14">
              <div className="absolute top-0 right-0 w-80 h-80 bg-yellow-brand/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
              <div className="relative grid md:grid-cols-12 gap-8 items-center">
                <div className="md:col-span-8">
                  <div className="text-yellow-brand font-display font-semibold text-xs tracking-[0.3em] uppercase mb-4">
                    Exclusivo · High-Ticket
                  </div>
                  <h3 className="font-display font-extrabold text-3xl md:text-4xl uppercase leading-tight">
                    Consultoria Imigratória
                    <br />
                    <span className="text-yellow-brand">& Relocation.</span>
                  </h3>
                  <p className="font-body text-base mt-5 text-offwhite/80 max-w-xl leading-relaxed">
                    Para processos de Visto, Autorização de Residência e mudança familiar completa,
                    nosso time de especialistas oferece um acompanhamento técnico de alto nível.
                  </p>
                </div>
                <div className="md:col-span-4 flex md:justify-end">
                  <button
                    type="button"
                    onClick={() => setWizardOpen(true)}
                    className="inline-flex items-center gap-2 bg-orange-brand hover:bg-yellow-brand hover:text-brown text-offwhite px-7 py-4 rounded-md font-display font-bold text-sm uppercase tracking-widest transition-all hover:shadow-warm w-full md:w-auto justify-center"
                  >
                    Aplicar para Consultoria <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* EVENTOS - A Agenda Empuria */}
      <HomeEventsSection />

      {/* CLUBE */}
      <section id="clube" className="bg-offwhite py-24">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <Reveal>
              <div className="text-orange-brand font-display font-semibold text-xs tracking-[0.3em] uppercase mb-4">
                Comunidade & Retenção
              </div>
            </Reveal>
            <Reveal delay={100}>
              <h2 className="font-display font-extrabold text-4xl md:text-5xl uppercase leading-[1] text-brown">
                Muito mais que um serviço.
                <br />
                Uma <span className="text-orange-brand">comunidade.</span>
              </h2>
            </Reveal>
            <Reveal delay={200}>
              <p className="font-body text-lg mt-6 text-brown-deep/80 leading-relaxed max-w-xl">
                Faça parte do Clube de Imigração Empuria. Uma assinatura pensada para quem quer
                estar sempre um passo à frente. Acesso imediato a cursos completos, vídeos
                exclusivos sobre a vida na Europa, dicas de ouro de quem já trilhou o caminho e uma
                rede de contatos que impulsiona sua jornada.
              </p>
            </Reveal>
            <Reveal delay={300}>
              <a
                href="/login?redirect=/portal/clube"
                className="mt-8 inline-flex items-center gap-2 bg-orange-brand hover:bg-red-brand text-offwhite px-7 py-4 rounded-md font-display font-bold text-sm uppercase tracking-widest transition-all hover:shadow-warm hover:-translate-y-0.5"
              >
                Quero Fazer Parte do Clube <ArrowRight className="w-4 h-4" />
              </a>
            </Reveal>
          </div>
          <Reveal delay={200} className="lg:col-span-5">
            <div className="relative">
              <div className="absolute -inset-6 bg-gradient-sunset opacity-20 blur-3xl rounded-full" />
              <div className="relative bg-brown text-offwhite rounded-2xl p-8 shadow-warm border border-yellow-brand/20">
                <div className="flex items-center justify-between mb-6">
                  <div className="font-display font-extrabold text-yellow-brand uppercase tracking-widest text-xs">
                    Clube do Imigrante
                  </div>
                  <Sparkles className="w-5 h-5 text-yellow-brand" />
                </div>
                <div className="font-display font-extrabold text-5xl">
                  R$ 199<span className="text-lg text-offwhite/60">/mês</span>
                </div>
                <div className="mt-2 font-body text-sm text-offwhite/70">
                  ou 6x de R$ 133,17 <span className="text-offwhite/50">(semestral)</span>
                </div>
                <ul className="mt-6 space-y-3 font-body text-sm text-offwhite/85">
                  {[
                    "Cursos completos sobre vida na Europa",
                    "Vídeos exclusivos com especialistas",
                    "Rede de contatos brasileira ativa",
                    "Encontros mensais no espaço físico",
                  ].map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-yellow-brand mt-0.5 shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <SiteFooter />
      <ConsultoriaWizardModal open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
