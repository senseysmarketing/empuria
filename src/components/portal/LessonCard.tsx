import { CheckCircle2, Clock, Heart, Hourglass, Lock, Play } from "lucide-react";

export type LessonCardItem = {
  id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  duration_minutes?: number | null;
  is_featured?: boolean;
  published_at?: string | null;
  opened_at?: string | null;
  completed_at?: string | null;
};

export function LessonCard({
  lesson,
  moduleTitle,
  active,
  locked,
  comingSoon,
  completed,
  favorited,
  onToggleFavorite,
  onSelect,
  size = "md",
}: {
  lesson: LessonCardItem;
  moduleTitle?: string;
  active?: boolean;
  locked?: boolean;
  comingSoon?: boolean;
  completed?: boolean;
  favorited?: boolean;
  onToggleFavorite?: () => void;
  onSelect: () => void;
  size?: "md" | "lg";
}) {
  const isNew =
    !!lesson.published_at &&
    !comingSoon &&
    Date.now() - new Date(lesson.published_at).getTime() < 14 * 24 * 60 * 60 * 1000;

  const width =
    size === "lg" ? "w-[320px] md:w-[440px]" : "w-[260px] md:w-[320px]";

  const disabled = locked || comingSoon;
  const opened = !!lesson.opened_at;
  // Barra de progresso: 100% concluída, 30% iniciada, 0% nada
  const progressPct = completed ? 100 : opened ? 30 : 0;

  return (
    <div
      className={`group relative shrink-0 ${width} snap-start rounded-xl overflow-hidden border bg-admin-surface-2 transition-all
        ${active ? "border-orange-brand ring-2 ring-orange-brand/50" : "border-admin-border hover:border-yellow-brand/50 hover:shadow-xl"}
      `}
    >
      <button
        onClick={onSelect}
        disabled={disabled}
        className="w-full text-left disabled:cursor-not-allowed"
      >
        <div className="aspect-video relative overflow-hidden bg-brown-deep">
          {lesson.thumbnail_url ? (
            <img
              src={lesson.thumbnail_url}
              alt={lesson.title}
              className={`w-full h-full object-cover transition-transform duration-500 ${
                disabled ? "blur-sm grayscale opacity-70" : "group-hover:scale-[1.04]"
              }`}
            />
          ) : (
            <div className="absolute inset-0">
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(135deg, oklch(0.30 0.09 38) 0%, oklch(0.45 0.16 40) 60%, oklch(0.58 0.18 45) 100%)",
                }}
              />
              <div
                className="absolute -bottom-10 -right-10 h-40 w-40 rounded-full blur-3xl opacity-40"
                style={{ background: "radial-gradient(circle, oklch(0.78 0.13 75), transparent 70%)" }}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center text-offwhite px-4 text-center">
                {moduleTitle && (
                  <span className="text-[10px] uppercase tracking-[0.3em] font-display text-offwhite/70">
                    {moduleTitle}
                  </span>
                )}
                <span className="font-display text-lg font-bold line-clamp-2 mt-1">{lesson.title}</span>
              </div>
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

          {/* Badges */}
          <div className="absolute top-2 left-2 flex gap-1.5">
            {comingSoon && (
              <span className="rounded-md bg-yellow-brand/90 px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-display text-brown-deep">
                Em breve
              </span>
            )}
            {isNew && !locked && (
              <span className="rounded-md bg-orange-brand px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-display text-offwhite">
                Novo
              </span>
            )}
            {lesson.is_featured && !locked && !comingSoon && (
              <span className="rounded-md bg-yellow-brand/90 px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-display text-brown-deep">
                Destaque
              </span>
            )}
          </div>

          {completed && !comingSoon && (
            <div className="absolute top-2 right-2 rounded-full bg-emerald-500/90 p-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-white" />
            </div>
          )}

          {lesson.duration_minutes ? (
            <div className="absolute bottom-3 right-2 inline-flex items-center gap-1 rounded-md bg-black/70 backdrop-blur px-1.5 py-0.5 text-[10px] font-display text-white">
              <Clock className="h-3 w-3" /> {lesson.duration_minutes} min
            </div>
          ) : null}

          {/* Center: locked / coming soon / play */}
          {comingSoon ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
              <div className="h-12 w-12 rounded-full bg-black/60 border border-yellow-brand/40 flex items-center justify-center">
                <Hourglass className="h-5 w-5 text-yellow-brand" />
              </div>
              <span className="text-[10px] uppercase tracking-widest font-display text-yellow-brand">
                Em breve
              </span>
            </div>
          ) : locked ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
              <div className="h-12 w-12 rounded-full bg-black/60 border border-yellow-brand/40 flex items-center justify-center">
                <Lock className="h-5 w-5 text-yellow-brand" />
              </div>
              <span className="text-[10px] uppercase tracking-widest font-display text-yellow-brand">
                Só membros
              </span>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="h-14 w-14 rounded-full bg-orange-brand/95 flex items-center justify-center shadow-2xl">
                <Play className="h-6 w-6 text-offwhite fill-offwhite ml-0.5" />
              </div>
            </div>
          )}

          {/* Barra de progresso fina dourada */}
          {progressPct > 0 && !comingSoon && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
              <div
                className="h-full bg-gradient-to-r from-yellow-brand to-orange-brand transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
      </button>

      {/* Coração de favorito (não disparado pelo clique do card) */}
      {onToggleFavorite && !locked && !comingSoon && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={favorited ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          className={`absolute top-2 right-2 z-10 rounded-full p-1.5 transition backdrop-blur ${
            favorited
              ? "bg-orange-brand/90 text-white shadow-lg"
              : "bg-black/50 text-white/80 hover:bg-black/70"
          } ${completed && !comingSoon ? "translate-y-7" : ""}`}
        >
          <Heart className={`h-3.5 w-3.5 ${favorited ? "fill-current" : ""}`} />
        </button>
      )}

      <div className="p-3">
        <h3 className="font-display text-sm font-bold text-admin-ink line-clamp-1">{lesson.title}</h3>
        {lesson.description && (
          <p className="text-xs text-admin-ink-muted line-clamp-2 mt-1 font-body">{lesson.description}</p>
        )}
      </div>
    </div>
  );
}
