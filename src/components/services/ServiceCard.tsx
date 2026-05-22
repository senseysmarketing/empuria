import { Link } from "@tanstack/react-router";
import { Plane, MapPin, CreditCard, Landmark, Users, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";


const ICONS: Record<string, LucideIcon> = {
  airport: Plane,
  tour: MapPin,
  consulting: CreditCard,
  banking: Landmark,
  meeting: Users,
};

export type PublicService = {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  kind: "airport" | "tour" | "consulting" | "banking" | "meeting";
  price_cents: number;
  currency: string;
  requires_slot: boolean;
};

export function ServiceCard({
  service,
  onBuy,
  onDetails,
  variant = "dark",
}: {
  service: PublicService;
  onBuy: (s: PublicService) => void;
  onDetails?: (s: PublicService) => void;
  variant?: "dark" | "light";
}) {
  const Icon = ICONS[service.kind] ?? MapPin;
  const price = (service.price_cents / 100).toFixed(0);
  const isDark = variant === "dark";

  return (
    <div
      className={`group rounded-xl p-6 border h-full flex flex-col transition-all hover:-translate-y-1 ${
        isDark
          ? "bg-offwhite text-brown-deep border-transparent hover:border-orange-brand hover:shadow-warm"
          : "bg-card text-brown-deep border-border hover:border-orange-brand hover:shadow-lg"
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-11 h-11 rounded-lg bg-orange-brand/10 text-orange-brand flex items-center justify-center">
          <Icon className="w-5 h-5" strokeWidth={1.7} />
        </div>
        <div className="text-right">
          <div className="font-display font-extrabold text-2xl text-brown">€{price}</div>
          <div className="text-[10px] uppercase tracking-widest text-brown-deep/50">único</div>
        </div>
      </div>
      <h4 className="font-display font-bold text-lg uppercase tracking-tight leading-tight text-brown">
        {service.title}
      </h4>
      <p className="font-body text-sm mt-2 text-brown-deep/70 leading-snug flex-1">
        {service.short_description}
      </p>
      <div className="mt-5 flex gap-2">
        <button
          onClick={() => onBuy(service)}
          className="flex-1 inline-flex items-center justify-center gap-2 bg-orange-brand text-offwhite px-4 py-2.5 rounded-md font-display font-semibold text-xs uppercase tracking-widest hover:bg-red-brand transition-all"
        >
          Comprar <ArrowRight className="w-3.5 h-3.5" />
        </button>
        {onDetails ? (
          <button
            onClick={() => onDetails(service)}
            className="inline-flex items-center justify-center gap-2 border border-border text-brown-deep px-4 py-2.5 rounded-md font-display font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-all"
          >
            Detalhes
          </button>
        ) : (
          <Link
            to="/servicos/$slug"
            params={{ slug: service.slug }}
            className="inline-flex items-center justify-center gap-2 border border-border text-brown-deep px-4 py-2.5 rounded-md font-display font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-all"
          >
            Detalhes
          </Link>
        )}
      </div>
    </div>
  );
}
