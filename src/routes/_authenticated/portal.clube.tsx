import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getClubContent } from "@/lib/portal/clube.functions";
import { ClubCarousel } from "@/components/portal/ClubCarousel";
import { VideoPlayerModal, type ClubVideo } from "@/components/portal/VideoPlayerModal";
import { GridSkeleton } from "@/components/portal/PortalSkeleton";
import {
  ArrowRight,
  Clock,
  Crown,
  Lock,
  MessageCircle,
  ShieldAlert,
  CheckCircle2,
  Megaphone,
  FileText,
  Download,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/clube")({
  component: ClubePage,
});

type LessonWithFiles = {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  duration_minutes: number | null;
  position: number;
  is_featured: boolean;
  files: { id: string; label: string; file_url: string; file_type: string; size_bytes: number | null }[];
};

function ClubePage() {
  const fetchContent = useServerFn(getClubContent);
  const { data, isLoading } = useQuery({
    queryKey: ["club-content"],
    queryFn: () => fetchContent(),
  });
  const [selected, setSelected] = useState<LessonWithFiles | null>(null);

  const settings = data?.settings;
  const title = settings?.public_title ?? "Clube do Imigrante";
  const description = settings?.public_description ?? "Conteúdo exclusivo: mentalidade, passos iniciais e cultura espanhola.";
  const ctaText = settings?.cta_text ?? "Assinar Clube";
  const lockedText = settings?.locked_screen_text ?? "Assine o Clube pela Hubla usando o mesmo e-mail cadastrado no Instituto Empuria.";
  const benefits = useMemo<string[]>(() => {
    const b = settings?.benefits;
    return Array.isArray(b) ? (b as string[]) : [];
  }, [settings]);
  const coverUrl = settings?.cover_url;

  return (
    <div className="space-y-8">
      {/* HERO */}
      <header
        className="relative overflow-hidden rounded-3xl border border-admin-border"
        style={
          coverUrl
            ? { backgroundImage: `linear-gradient(135deg, rgba(0,0,0,0.6), rgba(0,0,0,0.3)), url(${coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      >
        <div
          className={`p-8 md:p-10 ${
            coverUrl ? "text-white" : "bg-gradient-to-br from-admin-surface to-admin-surface-2 text-admin-ink"
          }`}
        >
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex items-start gap-4 max-w-2xl">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${coverUrl ? "bg-white/15 backdrop-blur" : "bg-admin-accent-soft text-admin-accent"}`}>
                <Crown className="h-7 w-7" />
              </div>
              <div>
                <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">{title}</h1>
                <p className={`mt-2 text-base font-body ${coverUrl ? "text-white/85" : "text-admin-ink-muted"}`}>{description}</p>
                {data?.isMember && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-3 py-1 text-xs uppercase tracking-wider font-display">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Membro ativo
                  </div>
                )}
              </div>
            </div>
            {data?.isMember && data.hubla.whatsappGroupUrl && (
              <a
                href={data.hubla.whatsappGroupUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 font-display text-xs uppercase tracking-wider text-white hover:bg-emerald-700 shadow-lg"
              >
                <MessageCircle className="h-4 w-4" /> Grupo no WhatsApp
              </a>
            )}
          </div>
        </div>
      </header>

      {/* COMUNICADOS */}
      {data?.isMember && data.posts.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="h-4 w-4 text-admin-accent" />
            <h2 className="font-display text-sm uppercase tracking-[0.25em] text-admin-ink-soft">Comunicados</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.posts.slice(0, 3).map((p) => (
              <div
                key={p.id}
                className={`rounded-xl border p-4 ${
                  p.is_pinned ? "border-admin-accent/40 bg-admin-accent-soft" : "border-admin-border bg-admin-surface-2"
                }`}
              >
                {p.is_pinned && (
                  <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-admin-accent font-display mb-1">
                    <Sparkles className="h-3 w-3" /> Fixado
                  </div>
                )}
                <p className="text-sm text-admin-ink font-body line-clamp-4 whitespace-pre-wrap">{p.body}</p>
                <p className="mt-2 text-[11px] text-admin-ink-muted">
                  {p.author_name} · {new Date(p.created_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* LOCKED PANEL */}
      {!isLoading && !data?.isMember && (
        <ClubAccessPanel
          subscription={data?.subscription ?? null}
          checkoutUrl={data?.hubla.checkoutUrl ?? null}
          isHublaEnabled={!!data?.hubla.isEnabled}
          ctaText={ctaText}
          lockedText={lockedText}
          benefits={benefits}
        />
      )}

      {/* MÓDULOS */}
      {isLoading ? (
        <GridSkeleton />
      ) : !data || data.modules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-admin-border p-12 text-center">
          <p className="font-display text-admin-ink-soft">Conteúdo chegando em breve.</p>
        </div>
      ) : (
        <div className="space-y-12">
          {data.modules.map((m) => (
            <section key={m.id}>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-display text-2xl font-bold text-admin-ink">{m.title}</h2>
                  {m.description && (
                    <p className="mt-1 text-sm text-admin-ink-muted max-w-2xl font-body">{m.description}</p>
                  )}
                </div>
                <span className="text-[11px] uppercase tracking-widest font-display text-admin-ink-muted">
                  {m.lessons.length} aula{m.lessons.length === 1 ? "" : "s"}
                </span>
              </div>
              <ClubCarousel
                title=""
                items={m.lessons.map((l) => ({
                  id: l.id,
                  title: l.title,
                  description: l.description,
                  video_url: l.video_url,
                  thumbnail_url: l.thumbnail_url,
                }))}
                locked={!data.isMember}
                onSelect={(v) => {
                  const lesson = m.lessons.find((x) => x.id === v.id);
                  if (lesson) setSelected(lesson as LessonWithFiles);
                }}
              />
            </section>
          ))}
        </div>
      )}

      <LessonModal lesson={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function LessonModal({ lesson, onClose }: { lesson: LessonWithFiles | null; onClose: () => void }) {
  const video: ClubVideo | null = lesson
    ? { id: lesson.id, title: lesson.title, description: null, video_url: lesson.video_url }
    : null;
  return (
    <>
      <VideoPlayerModal video={video} open={!!lesson} onOpenChange={(o) => !o && onClose()} />
      {/* Materials overlay rendered inside the modal via custom dialog isn't trivial; instead show them as a panel below the video by enhancing description. Simpler: nothing here — files live in description block of next iteration. */}
      {lesson && lesson.files && lesson.files.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[60] w-80 rounded-xl border border-admin-border bg-admin-surface shadow-[var(--shadow-admin-hover)] p-4">
          <h4 className="font-display text-xs uppercase tracking-widest text-admin-ink-soft mb-2">Materiais da aula</h4>
          <div className="space-y-1.5">
            {lesson.files.map((f) => (
              <a
                key={f.id}
                href={f.file_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm text-admin-ink hover:text-admin-accent rounded p-1.5 hover:bg-admin-bg"
              >
                {f.file_type === "link" ? <Download className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                <span className="flex-1 truncate">{f.label}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function ClubAccessPanel({
  subscription,
  checkoutUrl,
  isHublaEnabled,
  ctaText,
  lockedText,
  benefits,
}: {
  subscription: {
    status?: string | null;
    access_status?: string | null;
    current_period_end?: string | null;
  } | null;
  checkoutUrl: string | null;
  isHublaEnabled: boolean;
  ctaText: string;
  lockedText: string;
  benefits: string[];
}) {
  const status = subscription?.access_status ?? "none";
  const isPending = status === "pending";
  const isInactive = status === "inactive";
  const heading = isPending
    ? "Assinatura em processamento"
    : isInactive
      ? "Acesso do Clube inativo"
      : "Conteúdos bloqueados";
  const body = isPending
    ? "Recebemos seu cadastro. O acesso será liberado automaticamente quando o webhook da Hubla confirmar a assinatura."
    : isInactive
      ? "A Hubla informou que sua assinatura não está ativa. Regularize pelo checkout usando o mesmo e-mail do portal."
      : lockedText;

  return (
    <div className="rounded-2xl border border-admin-border bg-gradient-to-br from-admin-surface to-admin-surface-2 p-6 md:p-8">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-center">
        <div>
          <div className="flex items-center gap-2 mb-2">
            {isPending ? (
              <Clock className="h-5 w-5 text-amber-600" />
            ) : isInactive ? (
              <ShieldAlert className="h-5 w-5 text-red-700" />
            ) : (
              <Lock className="h-5 w-5 text-admin-ink-muted" />
            )}
            <h2 className="font-display text-2xl font-bold text-admin-ink">{heading}</h2>
          </div>
          <p className="text-sm text-admin-ink-soft font-body max-w-xl">{body}</p>
          {benefits.length > 0 && (
            <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {benefits.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-admin-ink font-body">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-admin-ink-muted">
            O redirect pós-compra não libera acesso sozinho; a confirmação vem pela Hubla.
          </p>
        </div>
        {checkoutUrl && isHublaEnabled ? (
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-orange-brand px-6 py-4 font-display text-sm uppercase tracking-wider text-offwhite hover:bg-red-brand shadow-lg"
          >
            {isInactive ? "Regularizar na Hubla" : ctaText}
            <ArrowRight className="h-4 w-4" />
          </a>
        ) : (
          <span className="rounded-lg border border-admin-border px-4 py-3 text-xs text-admin-ink-muted">
            Checkout indisponível
          </span>
        )}
      </div>
    </div>
  );
}
