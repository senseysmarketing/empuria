import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listPublicServices } from "@/lib/services-public.functions";
import { UpsellSheet, type ShopService } from "@/components/portal/UpsellSheet";
import { GridSkeleton } from "@/components/portal/PortalSkeleton";
import { ShoppingBag, ArrowRight, Plane, MapPin, CreditCard, Landmark, Users } from "lucide-react";

const KIND_ICON: Record<string, typeof Plane> = {
  airport: Plane,
  tour: MapPin,
  consulting: CreditCard,
  banking: Landmark,
  meeting: Users,
};

const KIND_IMAGE: Record<string, string> = {
  airport: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=800&auto=format&fit=crop",
  tour: "https://images.unsplash.com/photo-1543783207-ec64e4d95325?w=800&auto=format&fit=crop",
  consulting: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&auto=format&fit=crop",
  banking: "https://images.unsplash.com/photo-1601597111158-2fceff292cdc?w=800&auto=format&fit=crop",
  meeting: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800&auto=format&fit=crop",
};
const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1543783207-ec64e4d95325?w=800&auto=format&fit=crop";

export const Route = createFileRoute("/_authenticated/portal/loja")({
  component: LojaPage,
});

function LojaPage() {
  const fetchServices = useServerFn(listPublicServices);
  const { data, isLoading } = useQuery({
    queryKey: ["portal-loja"],
    queryFn: () => fetchServices(),
  });
  const [selected, setSelected] = useState<ShopService | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-admin-accent-soft text-admin-accent flex items-center justify-center">
          <ShoppingBag className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Loja Empuria</h1>
          <p className="text-admin-ink-muted text-sm mt-1 font-body">
            Contrate novos serviços direto pelo seu painel. Sem atrito, sem retrabalho.
          </p>
        </div>
      </header>

      {isLoading ? (
        <GridSkeleton rows={3} />
      ) : !data || data.length === 0 ? (
        <p className="text-admin-ink-muted text-sm">Sem serviços disponíveis no momento.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((s) => {
            const Icon = KIND_ICON[s.kind ?? ""] ?? ShoppingBag;
            return (
              <button
                key={s.id}
                onClick={() => setSelected(s as ShopService)}
                className="text-left bg-admin-surface border border-admin-border rounded-2xl overflow-hidden shadow-[var(--shadow-admin)] hover:shadow-[var(--shadow-admin-hover)] hover:-translate-y-0.5 transition-all group"
              >
                <div className="aspect-[16/10] bg-admin-surface-2 relative overflow-hidden">
                  <img
                    src={s.image_url ?? KIND_IMAGE[s.kind ?? ""] ?? FALLBACK_IMAGE}
                    alt={s.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                  <div className="absolute top-3 left-3 h-9 w-9 rounded-lg bg-admin-surface/95 backdrop-blur flex items-center justify-center text-admin-accent shadow">
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                  <div className="absolute top-3 left-3 h-9 w-9 rounded-lg bg-admin-surface/95 backdrop-blur flex items-center justify-center text-admin-accent shadow">
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="p-5">
                  <h3 className="font-display text-base font-bold text-admin-ink line-clamp-1">{s.title}</h3>
                  {s.short_description && (
                    <p className="text-xs text-admin-ink-muted line-clamp-2 mt-1 font-body">{s.short_description}</p>
                  )}
                  <div className="mt-4 flex items-center justify-between">
                    <span className="font-display text-lg text-admin-accent">€ {(s.price_cents / 100).toFixed(2)}</span>
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-display text-admin-ink-muted group-hover:text-admin-accent transition-colors">
                      Ver detalhes <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <UpsellSheet service={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}
