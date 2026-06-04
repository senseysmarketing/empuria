import { CheckCircle2, ChevronRight, Download, FileText, PlayCircle } from "lucide-react";
import { buildVideoFromUrl } from "@/lib/clube/video-provider";
import logoIcone from "@/assets/logo-empuria-icone.png";

export type PlayerLesson = {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  video_provider: string | null;
  video_file_id: string | null;
  video_embed_url: string | null;
  video_source_url: string | null;
  files?: { id: string; label: string; file_url: string; file_type: string }[];
};

export type SidebarLesson = {
  id: string;
  title: string;
  duration_minutes: number | null;
  is_coming_soon: boolean;
  completed: boolean;
};

export function ClubPlayer({
  lesson,
  moduleTitle,
  watermark,
  isCompleted,
  onMarkComplete,
  onNext,
  nextTitle,
  sidebarLessons,
  onSelectSidebar,
}: {
  lesson: PlayerLesson | null;
  moduleTitle?: string | null;
  watermark?: string | null;
  isCompleted?: boolean;
  onMarkComplete?: () => void;
  onNext?: () => void;
  nextTitle?: string | null;
  sidebarLessons?: SidebarLesson[];
  onSelectSidebar?: (id: string) => void;
}) {
  if (!lesson) {
    return (
      <div className="rounded-3xl overflow-hidden border border-white/10 bg-black">
        <div className="aspect-video flex items-center justify-center text-offwhite/60 font-body">
          <div className="text-center">
            <PlayCircle className="h-12 w-12 mx-auto opacity-50 mb-3" />
            <p className="text-sm">Selecione uma aula para começar</p>
          </div>
        </div>
      </div>
    );
  }

  let provider = lesson.video_provider ?? null;
  let embedUrl = lesson.video_embed_url ?? null;
  if (!provider || !embedUrl) {
    const built = buildVideoFromUrl(lesson.video_source_url ?? lesson.video_url ?? "");
    provider = provider ?? built.provider ?? null;
    embedUrl = embedUrl ?? built.embed_url ?? null;
  }
  const isDrive = provider === "gdrive" || provider === "google_drive";
  const hasContent = !!embedUrl;
  const hasSidebar = !!sidebarLessons && sidebarLessons.length > 1;

  return (
    <div
      className={`grid gap-5 ${
        hasSidebar ? "lg:grid-cols-[1fr_320px]" : "grid-cols-1"
      }`}
    >
      <div className="rounded-3xl overflow-hidden border border-white/10 bg-[oklch(0.12_0.03_30)] shadow-2xl">
        <div className="relative aspect-video bg-black select-none">
          {hasContent ? (
            provider === "direct" ? (
              <video
                key={lesson.id}
                controls
                autoPlay
                src={embedUrl!}
                className="w-full h-full"
                controlsList="nodownload"
                onContextMenu={(e) => e.preventDefault()}
              />
            ) : (
              <>
                <iframe
                  key={lesson.id}
                  src={
                    provider === "youtube" || provider === "vimeo"
                      ? `${embedUrl}${embedUrl!.includes("?") ? "&" : "?"}autoplay=1`
                      : embedUrl!
                  }
                  className="w-full h-full"
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  allowFullScreen
                  title={lesson.title}
                />
                {isDrive && (
                  <div
                    className="absolute top-1.5 right-1.5 h-14 w-14 rounded-2xl bg-[oklch(0.22_0.07_38)] ring-1 ring-yellow-brand/30 flex items-center justify-center shadow-lg z-10 cursor-default"
                    aria-hidden="true"
                    onClick={(e) => e.preventDefault()}
                  >
                    <img src={logoIcone} alt="" className="h-8 w-8 object-contain opacity-90" />
                  </div>
                )}
              </>
            )
          ) : (
            <div className="w-full h-full flex items-center justify-center text-offwhite/60 text-sm font-body">
              Conteúdo em breve.
            </div>
          )}

          {hasContent && watermark && (
            <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-3">
              <span className="text-[10px] uppercase tracking-widest font-display text-white/40 bg-black/30 backdrop-blur-sm px-2 py-1 rounded">
                Empuria · {watermark}
              </span>
            </div>
          )}
        </div>

        <div className="p-6 md:p-8 text-offwhite">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              {moduleTitle && (
                <p className="text-[10px] uppercase tracking-[0.3em] font-display text-yellow-brand mb-2">
                  {moduleTitle}
                </p>
              )}
              <h2 className="font-display text-2xl md:text-3xl font-bold">{lesson.title}</h2>
              {lesson.description && (
                <p className="mt-3 text-sm text-offwhite/70 font-body max-w-2xl whitespace-pre-wrap">
                  {lesson.description}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 items-stretch md:items-end">
              {onMarkComplete && (
                <button
                  onClick={onMarkComplete}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-display text-xs uppercase tracking-wider transition border ${
                    isCompleted
                      ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-300"
                      : "border-offwhite/20 bg-white/5 text-offwhite/85 hover:bg-white/10"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isCompleted ? "Concluída" : "Marcar como concluída"}
                </button>
              )}
              {onNext && (
                <button
                  onClick={onNext}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-brand px-4 py-2.5 font-display text-xs uppercase tracking-wider text-offwhite hover:bg-orange-brand/90 transition shadow-lg"
                  title={nextTitle ?? undefined}
                >
                  Próxima aula <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {lesson.files && lesson.files.length > 0 && (
            <div className="mt-6 pt-6 border-t border-white/10">
              <h4 className="font-display text-[11px] uppercase tracking-[0.25em] text-yellow-brand/90 mb-3">
                Materiais da aula
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {lesson.files.map((f) => (
                  <a
                    key={f.id}
                    href={f.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm text-offwhite/85 hover:text-orange-brand rounded-lg p-2.5 bg-white/5 hover:bg-white/10 border border-white/5 transition"
                  >
                    {f.file_type === "link" ? (
                      <Download className="h-4 w-4 shrink-0" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate">{f.label}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {hasSidebar && (
        <aside className="rounded-3xl border border-white/10 bg-[oklch(0.12_0.03_30)] p-4 text-offwhite max-h-[640px] overflow-y-auto">
          <h4 className="font-display text-[11px] uppercase tracking-[0.25em] text-yellow-brand/90 mb-3 px-1">
            Neste módulo
          </h4>
          <ul className="space-y-1">
            {sidebarLessons!.map((s) => {
              const isActive = s.id === lesson.id;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => onSelectSidebar?.(s.id)}
                    disabled={s.is_coming_soon}
                    className={`w-full text-left rounded-xl px-3 py-2.5 transition flex items-center gap-2 ${
                      isActive
                        ? "bg-orange-brand text-white"
                        : "hover:bg-white/5 text-offwhite/85"
                    } ${s.is_coming_soon ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {s.completed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                    ) : (
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          isActive ? "bg-white" : "bg-white/30"
                        }`}
                      />
                    )}
                    <span className="flex-1 truncate text-sm font-body">{s.title}</span>
                    {s.duration_minutes ? (
                      <span className="text-[10px] opacity-70 shrink-0">{s.duration_minutes}m</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      )}
    </div>
  );
}
