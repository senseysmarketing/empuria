import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getClubContent } from "@/lib/portal/clube.functions";
import { ClubCarousel } from "@/components/portal/ClubCarousel";
import { VideoPlayerModal, type ClubVideo } from "@/components/portal/VideoPlayerModal";
import { GridSkeleton } from "@/components/portal/PortalSkeleton";
import { Crown, Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/clube")({
  component: ClubePage,
});

function ClubePage() {
  const fetchContent = useServerFn(getClubContent);
  const { data, isLoading } = useQuery({
    queryKey: ["club-content"],
    queryFn: () => fetchContent(),
  });
  const [selected, setSelected] = useState<ClubVideo | null>(null);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-admin-accent-soft text-admin-accent flex items-center justify-center">
            <Crown className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">Clube do Imigrante</h1>
            <p className="text-admin-ink-muted text-sm mt-1 font-body">
              Conteúdo exclusivo: mentalidade, passos iniciais e cultura espanhola.
            </p>
          </div>
        </div>
        {data && !data.isMember && (
          <Link
            to="/"
            hash="clube"
            className="bg-orange-brand hover:bg-red-brand text-offwhite px-5 py-2.5 rounded-lg text-xs uppercase font-display tracking-wider"
          >
            Associar-se ao Clube
          </Link>
        )}
      </header>

      {!data?.isMember && (
        <div className="rounded-xl border border-admin-border bg-admin-surface-2 p-4 flex items-center gap-3">
          <Lock className="h-4 w-4 text-admin-ink-muted" />
          <p className="text-sm text-admin-ink-soft font-body">
            Você está vendo a vitrine. Associe-se ao Clube para desbloquear todos os vídeos.
          </p>
        </div>
      )}

      {isLoading ? (
        <GridSkeleton />
      ) : !data || data.modules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-admin-border p-12 text-center">
          <p className="font-display text-admin-ink-soft">Conteúdo chegando em breve.</p>
        </div>
      ) : (
        <div className="space-y-10">
          {data.modules.map((m) => (
            <ClubCarousel
              key={m.module}
              title={m.module}
              items={m.items}
              locked={!data.isMember}
              onSelect={(v) => setSelected(v)}
            />
          ))}
        </div>
      )}

      <VideoPlayerModal video={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}
