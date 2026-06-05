import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CheckoutModal } from "@/components/checkout/CheckoutModal";
import { getPublicService } from "@/lib/services-public.functions";
import { ArrowRight, Check } from "lucide-react";

export const Route = createFileRoute("/servicos/$slug")({
  component: ServiceDetailPage,
});

function ServiceDetailPage() {
  const { slug } = Route.useParams();
  const fetchSvc = useServerFn(getPublicService);
  const { data: service, isLoading } = useQuery({
    queryKey: ["public-service", slug],
    queryFn: () => fetchSvc({ data: { slug } }),
  });
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-offwhite">
        <SiteHeader />
        <div className="pt-40 text-center text-brown-deep/60">Carregando...</div>
      </div>
    );
  }
  if (!service) {
    return (
      <div className="min-h-screen bg-offwhite">
        <SiteHeader />
        <div className="pt-40 text-center text-brown-deep/60">
          Serviço não encontrado.{" "}
          <Link to="/servicos" className="text-orange-brand underline">Ver todos</Link>
        </div>
      </div>
    );
  }
  const isInactive = service.is_active === false;

  const price = (service.price_cents / 100).toFixed(0);
  const docs = Array.isArray(service.document_checklist) ? (service.document_checklist as string[]) : [];

  return (
    <div className="min-h-screen bg-offwhite text-brown-deep">
      <SiteHeader />
      <section className="pt-32 pb-20 bg-topo relative">
        <div className="absolute inset-0 bg-brown/90" />
        <div className="relative max-w-5xl mx-auto px-6 text-offwhite">
          <Link to="/servicos" className="text-yellow-brand text-xs uppercase font-display tracking-widest">
            ← Todos os serviços
          </Link>
          <div className="mt-6 grid md:grid-cols-3 gap-10">
            <div className="md:col-span-2">
              <h1 className="font-display font-extrabold uppercase text-4xl md:text-5xl leading-[1]">
                {service.title}
              </h1>
              <p className="mt-6 font-body text-offwhite/85 text-lg leading-relaxed">
                {service.description}
              </p>
              {service.meeting_address && (
                <div className="mt-6 bg-brown-deep/60 border border-yellow-brand/20 rounded-md p-4 text-sm">
                  <div className="text-yellow-brand text-[10px] uppercase tracking-widest font-display mb-1">
                    Local
                  </div>
                  {service.meeting_address}
                </div>
              )}
              {docs.length > 0 && (
                <div className="mt-8">
                  <div className="text-yellow-brand text-[10px] uppercase tracking-widest font-display mb-3">
                    Você vai precisar de
                  </div>
                  <ul className="space-y-2">
                    {docs.map((d) => (
                      <li key={d} className="flex gap-2 items-start">
                        <Check className="h-4 w-4 text-yellow-brand mt-0.5 shrink-0" />
                        <span className="text-offwhite/85 text-sm">{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div>
              <div className="bg-offwhite text-brown-deep rounded-xl p-6 sticky top-28 shadow-warm">
                <div className="text-[10px] uppercase tracking-widest font-display text-brown-deep/50">
                  Investimento
                </div>
                <div className="font-display font-extrabold text-4xl text-brown mt-1">€{price}</div>
                <button
                  onClick={() => setOpen(true)}
                  className="mt-5 w-full inline-flex items-center justify-center gap-2 bg-orange-brand text-offwhite px-5 py-3 rounded-md font-display font-bold text-sm uppercase tracking-widest hover:bg-red-brand transition-all"
                >
                  Comprar Agora <ArrowRight className="w-4 h-4" />
                </button>
                <p className="text-[11px] text-brown-deep/50 mt-3 font-body text-center">
                  Pagamento via PIX ou Cartão · Acesso imediato ao Portal
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
      <SiteFooter />
      <CheckoutModal
        service={service as Parameters<typeof CheckoutModal>[0]["service"]}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}
