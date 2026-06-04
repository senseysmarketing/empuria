import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildVideoFromUrl } from "@/lib/clube/video-provider";

export type ClubVideo = {
  id: string;
  title: string;
  description: string | null;
  video_url?: string | null;
  video_provider?: string | null;
  video_file_id?: string | null;
  video_embed_url?: string | null;
  video_source_url?: string | null;
};

export function VideoPlayerModal({
  video,
  open,
  onOpenChange,
  watermark,
}: {
  video: ClubVideo | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  watermark?: string | null;
}) {
  if (!video) return null;

  // Resolve provider/embed: prefer stored fields, fallback to building from URL
  let provider = video.video_provider ?? null;
  let embedUrl = video.video_embed_url ?? null;
  if (!provider || !embedUrl) {
    const built = buildVideoFromUrl(video.video_source_url ?? video.video_url ?? "");
    provider = provider ?? built.provider ?? null;
    embedUrl = embedUrl ?? built.embed_url ?? null;
  }

  const hasContent = !!embedUrl;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-admin-surface text-admin-ink border-admin-border p-0">
        <DialogHeader className="px-6 pt-5 pb-2">
          <DialogTitle className="font-display text-2xl">{video.title}</DialogTitle>
        </DialogHeader>
        <div className="relative aspect-video bg-black select-none">
          {hasContent ? (
            provider === "direct" ? (
              <video
                controls
                autoPlay
                src={embedUrl!}
                className="w-full h-full"
                controlsList="nodownload"
                onContextMenu={(e) => e.preventDefault()}
              />
            ) : (
              <iframe
                src={
                  provider === "youtube" || provider === "vimeo"
                    ? `${embedUrl}${embedUrl!.includes("?") ? "&" : "?"}autoplay=1`
                    : embedUrl!
                }
                className="w-full h-full"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
                title={video.title}
              />
            )
          ) : (
            <div className="w-full h-full flex items-center justify-center text-offwhite/60 text-sm">
              Conteúdo em breve.
            </div>
          )}

          {/* Marca d'água visual — não impede download técnico mas desencoraja compartilhamento */}
          {hasContent && watermark && (
            <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-3">
              <span className="text-[10px] uppercase tracking-widest font-display text-white/40 bg-black/30 backdrop-blur-sm px-2 py-1 rounded">
                Empuria · {watermark}
              </span>
            </div>
          )}
        </div>
        {video.description && (
          <div className="px-6 py-4 text-sm text-admin-ink-soft font-body">{video.description}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
