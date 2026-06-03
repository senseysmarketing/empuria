import { Link } from "@tanstack/react-router";
import { ArrowRight, CreditCard, Landmark, MapPin, Plane, Users } from "lucide-react";
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
  online_price_cents?: number | null;
  online_currency?: string | null;
  display_price_note?: string | null;
  requires_slot: boolean;
};

function formatPrice(service: PublicService) {
  const cents = service.online_price_cents ?? service.price_cents;
  const currency = service.online_currency ?? service.currency;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

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
  const isDark = variant === "dark";

  return (
    <div
      className={`group flex h-full flex-col rounded-xl border p-6 transition-all hover:-translate-y-1 ${
        isDark
          ? "border-transparent bg-offwhite text-brown-deep hover:border-orange-brand hover:shadow-warm"
          : "border-border bg-card text-brown-deep hover:border-orange-brand hover:shadow-lg"
      }`}
    >
      <div className="mb-4 flex items-start justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-orange-brand/10 text-orange-brand">
          <Icon className="h-5 w-5" strokeWidth={1.7} />
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-extrabold text-brown">
            {formatPrice(service)}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-brown-deep/50">unico</div>
        </div>
      </div>
      <h4 className="font-display text-lg font-bold uppercase leading-tight tracking-tight text-brown">
        {service.title}
      </h4>
      <p className="mt-2 flex-1 font-body text-sm leading-snug text-brown-deep/70">
        {service.short_description}
      </p>
      {service.display_price_note && (
        <p className="mt-3 text-xs text-brown-deep/50">{service.display_price_note}</p>
      )}
      <div className="mt-5 flex gap-2">
        <button
          onClick={() => onBuy(service)}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-orange-brand px-4 py-2.5 font-display text-xs font-semibold uppercase tracking-widest text-offwhite transition-all hover:bg-red-brand"
        >
          Comprar <ArrowRight className="h-3.5 w-3.5" />
        </button>
        {onDetails ? (
          <button
            onClick={() => onDetails(service)}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 font-display text-xs font-semibold uppercase tracking-widest text-brown-deep transition-all hover:bg-muted"
          >
            Detalhes
          </button>
        ) : (
          <Link
            to="/servicos/$slug"
            params={{ slug: service.slug }}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 font-display text-xs font-semibold uppercase tracking-widest text-brown-deep transition-all hover:bg-muted"
          >
            Detalhes
          </Link>
        )}
      </div>
    </div>
  );
}
