import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plane,
  MapPin,
  CreditCard,
  Landmark,
  Users,
  Check,
  ShoppingBag,
  Clock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getServiceImage } from "@/lib/service-images";

const ICONS: Record<string, LucideIcon> = {
  airport: Plane,
  tour: MapPin,
  consulting: CreditCard,
  banking: Landmark,
  meeting: Users,
};

export type DetailedService = {
  id: string;
  slug: string;
  title: string;
  short_description?: string | null;
  description?: string | null;
  kind: string;
  price_cents: number;
  currency: string;
  online_price_cents?: number | null;
  online_currency?: string | null;
  display_price_note?: string | null;
  requires_slot?: boolean;
  document_checklist?: string[] | null;
  meeting_address?: string | null;
  image_url?: string | null;
};

export function ServiceDetailsModal<T extends DetailedService>({
  service,
  open,
  onOpenChange,
  onBuy,
}: {
  service: T | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onBuy: (s: T) => void;
}) {
  if (!service) return null;
  const Icon = ICONS[service.kind] ?? MapPin;
  const price = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: service.online_currency ?? service.currency,
  }).format((service.online_price_cents ?? service.price_cents) / 100);
  const checklist = Array.isArray(service.document_checklist) ? service.document_checklist : [];
  const image = getServiceImage(service);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0 bg-offwhite text-brown-deep">
        <div className="relative aspect-[21/9] overflow-hidden bg-brown">
          <img src={image} alt={service.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-brown-deep/85 via-brown-deep/20 to-transparent" />
          <div className="absolute top-4 left-4 inline-flex items-center gap-2 bg-offwhite/95 backdrop-blur px-3 py-1.5 rounded-full">
            <Icon className="w-3.5 h-3.5 text-orange-brand" strokeWidth={2} />
            <span className="font-display text-[10px] uppercase tracking-widest text-brown-deep">
              Esteira 1
            </span>
          </div>
          <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between gap-4">
            <DialogHeader className="text-left space-y-0">
              <DialogTitle className="font-display font-extrabold uppercase tracking-tight text-2xl md:text-3xl text-offwhite leading-tight">
                {service.title}
              </DialogTitle>
            </DialogHeader>
            <div className="text-right shrink-0">
              <div className="font-display font-extrabold text-3xl text-yellow-brand leading-none">
                {price}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-offwhite/70 font-display mt-1">
                único
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {service.short_description && (
            <p className="font-body text-base text-brown-deep/85 leading-relaxed">
              {service.short_description}
            </p>
          )}
          {service.description && (
            <div className="font-body text-sm text-brown-deep/75 whitespace-pre-line leading-relaxed">
              {service.description}
            </div>
          )}

          {checklist.length > 0 && (
            <div>
              <h4 className="font-display font-bold uppercase tracking-widest text-[11px] text-brown-deep/60 mb-3">
                O que está incluído
              </h4>
              <ul className="space-y-2">
                {checklist.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm font-body text-brown-deep/80">
                    <Check className="w-4 h-4 text-orange-brand shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(service.meeting_address || service.requires_slot) && (
            <div className="grid sm:grid-cols-2 gap-3 pt-2">
              {service.meeting_address && (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-display text-brown-deep/60 mb-1">
                    <MapPin className="w-3 h-3" /> Local
                  </div>
                  <div className="text-xs font-body text-brown-deep/80">
                    {service.meeting_address}
                  </div>
                </div>
              )}
              {service.requires_slot && (
                <div className="rounded-lg border border-orange-brand/30 bg-orange-brand/5 p-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-display text-orange-brand mb-1">
                    <Clock className="w-3 h-3" /> Agendamento
                  </div>
                  <div className="text-xs font-body text-brown-deep/80">
                    Você escolhe data e horário durante o checkout.
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-border">
            <button
              onClick={() => {
                onOpenChange(false);
                onBuy(service);
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-orange-brand text-offwhite px-5 py-3 rounded-md font-display font-bold text-xs uppercase tracking-widest hover:bg-red-brand transition-all"
            >
              <ShoppingBag className="w-4 h-4" /> Comprar por {price}
            </button>
            <button
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center justify-center gap-2 border border-border text-brown-deep px-5 py-3 rounded-md font-display font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-all"
            >
              Fechar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
