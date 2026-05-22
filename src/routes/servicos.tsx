import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ServiceCard, type PublicService } from "@/components/services/ServiceCard";
import { CheckoutModal } from "@/components/checkout/CheckoutModal";
import { ServiceDetailsModal } from "@/components/services/ServiceDetailsModal";
import { listPublicServices } from "@/lib/services-public.functions";

export const Route = createFileRoute("/servicos")({
  head: () => ({
    meta: [
      { title: "Serviços — Instituto Empuria" },
      { name: "description", content: "Recepção no aeroporto, tours, vale transporte, conta bancária e reuniões presenciais em Madrid." },
      { property: "og:title", content: "Serviços do Instituto Empuria" },
      { property: "og:description", content: "Tudo o que você precisa para se estabelecer na Espanha." },
    ],
  }),
  component: ServicosPage,
});

function ServicosPage() {
  const fetchServices = useServerFn(listPublicServices);
  const { data: services = [], isLoading } = useQuery({
    queryKey: ["public-services"],
    queryFn: () => fetchServices(),
  });
  const [selected, setSelected] = useState<PublicService | null>(null);
  const [open, setOpen] = useState(false);

  const onBuy = (s: PublicService) => {
    setSelected(s);
    setOpen(true);
  };

  return (
    <div className="min-h-screen bg-offwhite text-brown-deep">
      <SiteHeader />
      <section className="pt-32 pb-20 bg-topo relative">
        <div className="absolute inset-0 bg-brown/90" />
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="max-w-3xl text-offwhite">
            <div className="text-yellow-brand font-display font-semibold text-xs tracking-[0.3em] uppercase mb-4">
              Esteira 1 · Compra Direta
            </div>
            <h1 className="font-display font-extrabold uppercase text-4xl md:text-6xl leading-[1]">
              Escolha seu próximo <span className="text-yellow-brand">passo</span> em Madrid.
            </h1>
            <p className="font-body mt-5 text-offwhite/80 text-lg max-w-2xl">
              Cinco serviços essenciais, contratados em minutos, com confirmação imediata.
            </p>
          </div>
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-56 bg-offwhite/10 animate-pulse rounded-xl" />
                ))
              : services.map((s) => (
                  <ServiceCard key={s.id} service={s as PublicService} onBuy={onBuy} variant="dark" />
                ))}
          </div>
        </div>
      </section>
      <SiteFooter />
      <CheckoutModal service={selected} open={open} onOpenChange={setOpen} />
    </div>
  );
}
