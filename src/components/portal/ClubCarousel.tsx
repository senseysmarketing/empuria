import { Play } from "lucide-react";
import type { ClubVideo } from "./VideoPlayerModal";

type Item = ClubVideo & { thumbnail_url: string | null };

export function ClubCarousel({
  title,
  items,
  onSelect,
  locked,
}: {
  title?: string;
  items: Item[];
  onSelect: (v: ClubVideo) => void;
  locked?: boolean;
}) {
  return (
    <section>
      {title ? (
        <h2 className="font-display text-sm uppercase tracking-[0.25em] text-admin-ink-soft mb-3 px-1">{title}</h2>
      ) : null}
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-2 px-2 scrollbar-thin">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => !locked && onSelect(item)}
            disabled={locked}
            className="group relative shrink-0 w-[280px] md:w-[360px] snap-start rounded-xl overflow-hidden bg-admin-surface-2 border border-admin-border shadow-[var(--shadow-admin)] hover:shadow-[var(--shadow-admin-hover)] transition-all disabled:cursor-not-allowed text-left"
          >
            <div className="aspect-video bg-brown-deep relative overflow-hidden">
              {item.thumbnail_url ? (
                <img
                  src={item.thumbnail_url}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-brown via-red-brand to-orange-brand" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              {!locked && (
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="h-14 w-14 rounded-full bg-orange-brand/90 flex items-center justify-center backdrop-blur">
                    <Play className="h-6 w-6 text-offwhite fill-offwhite ml-0.5" />
                  </div>
                </div>
              )}
              {locked && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <span className="text-xs uppercase tracking-widest font-display text-yellow-brand">Só membros</span>
                </div>
              )}
            </div>
            <div className="p-4">
              <h3 className="font-display text-base font-bold text-admin-ink line-clamp-1">{item.title}</h3>
              {item.description && (
                <p className="text-xs text-admin-ink-muted line-clamp-2 mt-1 font-body">{item.description}</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
