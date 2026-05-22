import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ClubVideo = {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
};

export function VideoPlayerModal({
  video,
  open,
  onOpenChange,
}: {
  video: ClubVideo | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  if (!video) return null;
  const url = video.video_url ?? "";
  const isYouTube = /youtube\.com|youtu\.be/.test(url);
  const isVimeo = /vimeo\.com/.test(url);
  const ytId = isYouTube
    ? url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/)?.[1]
    : null;
  const vimeoId = isVimeo ? url.match(/vimeo\.com\/(\d+)/)?.[1] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-admin-surface text-admin-ink border-admin-border p-0">
        <DialogHeader className="px-6 pt-5 pb-2">
          <DialogTitle className="font-display text-2xl">{video.title}</DialogTitle>
        </DialogHeader>
        <div className="aspect-video bg-black">
          {url ? (
            ytId ? (
              <iframe
                src={`https://www.youtube.com/embed/${ytId}?autoplay=1`}
                className="w-full h-full"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                title={video.title}
              />
            ) : vimeoId ? (
              <iframe
                src={`https://player.vimeo.com/video/${vimeoId}?autoplay=1`}
                className="w-full h-full"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                title={video.title}
              />
            ) : (
              <video controls autoPlay src={url} className="w-full h-full" />
            )
          ) : (
            <div className="w-full h-full flex items-center justify-center text-offwhite/60 text-sm">
              Conteúdo em breve.
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
