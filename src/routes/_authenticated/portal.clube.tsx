import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { getClubContent } from "@/lib/portal/clube.functions";
import { ClubHero } from "@/components/portal/ClubHero";
import { ClubPlayer, type PlayerLesson } from "@/components/portal/ClubPlayer";
import { LessonCard } from "@/components/portal/LessonCard";
import { GridSkeleton } from "@/components/portal/PortalSkeleton";
import {
  ArrowRight,
  Clock,
  Lock,
  Megaphone,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

const searchSchema = z.object({
  aula: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/portal/clube")({
  validateSearch: (s) => searchSchema.parse(s),
  component: ClubePage,
});

const LS_LAST = "clube:last-lesson";
const LS_COMPLETED = "clube:completed";

function readCompleted(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(LS_COMPLETED);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function ClubePage() {
  const fetchContent = useServerFn(getClubContent);
  const { data, isLoading } = useQuery({
    queryKey: ["club-content"],
    queryFn: () => fetchContent(),
  });
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setCompleted(readCompleted());
  }, []);

  const playerRef = useRef<HTMLDivElement | null>(null);
  const modulesRef = useRef<HTMLDivElement | null>(null);

  // Flat ordered list (módulo.position, aula.position) — used for "próxima aula" and lookups
  const orderedLessons = useMemo(() => {
    if (!data) return [] as { lesson: PlayerLesson & { duration_minutes: number | null; is_featured: boolean; published_at: string | null; thumbnail_url: string | null }; moduleId: string; moduleTitle: string }[];
    const out: { lesson: PlayerLesson & { duration_minutes: number | null; is_featured: boolean; published_at: string | null; thumbnail_url: string | null }; moduleId: string; moduleTitle: string }[] = [];
    for (const m of data.modules) {
      for (const l of m.lessons) {
        out.push({ lesson: l as never, moduleId: m.id, moduleTitle: m.title });
      }
    }
    return out;
  }, [data]);

  // Selected lesson from URL, falling back to localStorage last, featured, or first
  const lastFromLs =
    typeof window !== "undefined" ? window.localStorage.getItem(LS_LAST) : null;
  const featured = orderedLessons.find((o) => o.lesson.is_featured);
  const fallbackId =
    (lastFromLs && orderedLessons.find((o) => o.lesson.id === lastFromLs)?.lesson.id) ||
    featured?.lesson.id ||
    orderedLessons[0]?.lesson.id ||
    null;

  const selectedId = search.aula ?? null;
  const selectedEntry =
    (selectedId && orderedLessons.find((o) => o.lesson.id === selectedId)) || null;

  const settings = data?.settings;
  const title = settings?.public_title ?? "Clube do Imigrante";
  const subtitle =
    settings?.public_description ??
    "Sua jornada para viver melhor na Espanha — conteúdos exclusivos para membros.";
  const ctaText = settings?.cta_text ?? "Assinar Clube";
  const lockedText =
    settings?.locked_screen_text ??
    "Assine o Clube pela Hubla usando o mesmo e-mail cadastrado no Instituto Empuria.";
  const benefits = useMemo<string[]>(() => {
    const b = settings?.benefits;
    return Array.isArray(b) ? (b as string[]) : [];
  }, [settings]);
  const coverUrl = settings?.cover_url ?? null;

  const selectLesson = (id: string) => {
    navigate({ search: { aula: id }, replace: true });
    try {
      window.localStorage.setItem(LS_LAST, id);
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => {
      playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const toggleCompleted = (id: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(LS_COMPLETED, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Próxima aula (linear, na ordem)
  const currentIndex = selectedEntry
    ? orderedLessons.findIndex((o) => o.lesson.id === selectedEntry.lesson.id)
    : -1;
  const nextEntry =
    currentIndex >= 0 && currentIndex < orderedLessons.length - 1
      ? orderedLessons[currentIndex + 1]
      : null;

  const continueId = selectedId ?? fallbackId;
  const continueEntry = continueId
    ? orderedLessons.find((o) => o.lesson.id === continueId) ?? null
    : null;

  const onContinue = () => {
    if (!continueEntry) return;
    selectLesson(continueEntry.lesson.id);
  };
  const onBrowseModules = () => {
    modulesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-10">
      <ClubHero
        title={title}
        subtitle={subtitle}
        coverUrl={coverUrl}
        isMember={!!data?.isMember}
        hasSelected={!!selectedEntry || !!lastFromLs}
        onContinue={continueEntry ? onContinue : undefined}
        onBrowseModules={onBrowseModules}
        whatsappUrl={data?.hubla.whatsappGroupUrl ?? null}
      />

      {/* COMUNICADOS */}
      {data?.isMember && data.posts.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="h-4 w-4 text-admin-accent" />
            <h2 className="font-display text-sm uppercase tracking-[0.25em] text-admin-ink-soft">
              Comunicados
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.posts.slice(0, 3).map((p) => (
              <div
                key={p.id}
                className={`rounded-xl border p-4 ${
                  p.is_pinned
                    ? "border-admin-accent/40 bg-admin-accent-soft"
                    : "border-admin-border bg-admin-surface-2"
                }`}
              >
                {p.is_pinned && (
                  <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-admin-accent font-display mb-1">
                    <Sparkles className="h-3 w-3" /> Fixado
                  </div>
                )}
                <p className="text-sm text-admin-ink font-body line-clamp-4 whitespace-pre-wrap">
                  {p.body}
                </p>
                <p className="mt-2 text-[11px] text-admin-ink-muted">
                  {p.author_name} ·{" "}
                  {new Date(p.created_at).toLocaleDateString("pt-BR")}
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

      {/* PLAYER INLINE — só para membros */}
      {data?.isMember && (
        <section ref={playerRef} className="scroll-mt-24">
          <ClubPlayer
            lesson={(selectedEntry?.lesson as PlayerLesson) ?? (continueEntry?.lesson as PlayerLesson) ?? null}
            moduleTitle={
              selectedEntry?.moduleTitle ?? continueEntry?.moduleTitle ?? null
            }
            watermark={data?.memberName ?? null}
            isCompleted={
              !!(selectedEntry?.lesson.id ?? continueEntry?.lesson.id) &&
              completed.has(
                (selectedEntry?.lesson.id ?? continueEntry?.lesson.id) as string,
              )
            }
            onMarkComplete={
              selectedEntry || continueEntry
                ? () =>
                    toggleCompleted(
                      (selectedEntry?.lesson.id ?? continueEntry?.lesson.id) as string,
                    )
                : undefined
            }
            onNext={nextEntry ? () => selectLesson(nextEntry.lesson.id) : undefined}
            nextTitle={nextEntry?.lesson.title ?? null}
          />
        </section>
      )}

      {/* CONTEÚDO */}
      {isLoading ? (
        <GridSkeleton />
      ) : !data || data.modules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-admin-border p-12 text-center">
          <p className="font-display text-admin-ink-soft">
            Conteúdo chegando em breve.
          </p>
        </div>
      ) : (
        <div ref={modulesRef} className="space-y-12 scroll-mt-24">
          {/* CONTINUE / COMECE POR AQUI */}
          {data.isMember && continueEntry && (
            <section>
              <div className="mb-4 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-yellow-brand" />
                <h2 className="font-display text-sm uppercase tracking-[0.25em] text-admin-ink-soft">
                  {lastFromLs && lastFromLs === continueEntry.lesson.id
                    ? "Continue assistindo"
                    : "Comece por aqui"}
                </h2>
              </div>
              <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-2 px-2">
                <LessonCard
                  size="lg"
                  lesson={continueEntry.lesson as never}
                  moduleTitle={continueEntry.moduleTitle}
                  active={selectedEntry?.lesson.id === continueEntry.lesson.id}
                  completed={completed.has(continueEntry.lesson.id)}
                  onSelect={() => selectLesson(continueEntry.lesson.id)}
                />
              </div>
            </section>
          )}

          {data.modules.map((m) => (
            <section key={m.id}>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-display text-2xl font-bold text-admin-ink">
                    {m.title}
                  </h2>
                  {m.description && (
                    <p className="mt-1 text-sm text-admin-ink-muted max-w-2xl font-body">
                      {m.description}
                    </p>
                  )}
                </div>
                <span className="text-[11px] uppercase tracking-widest font-display text-admin-ink-muted">
                  {m.lessons.length} aula{m.lessons.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-2 px-2">
                {m.lessons.map((l) => (
                  <LessonCard
                    key={l.id}
                    lesson={l as never}
                    moduleTitle={m.title}
                    locked={!data.isMember}
                    active={selectedEntry?.lesson.id === l.id}
                    completed={completed.has(l.id)}
                    onSelect={() => selectLesson(l.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
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
      : "Conteúdo exclusivo para membros";
  const body = isPending
    ? "Recebemos seu cadastro. O acesso será liberado automaticamente quando o webhook da Hubla confirmar a assinatura."
    : isInactive
      ? "A Hubla informou que sua assinatura não está ativa. Regularize pelo checkout usando o mesmo e-mail do portal."
      : lockedText;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-yellow-brand/20 p-8 md:p-10 text-offwhite isolate">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.22 0.07 38) 0%, oklch(0.16 0.05 32) 70%)",
        }}
      />
      <div
        className="absolute -bottom-32 -left-24 -z-10 h-[420px] w-[420px] rounded-full blur-3xl opacity-25"
        style={{ background: "radial-gradient(circle, oklch(0.58 0.18 45), transparent 70%)" }}
      />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-8 items-center">
        <div>
          <div className="flex items-center gap-2 mb-3">
            {isPending ? (
              <Clock className="h-5 w-5 text-yellow-brand" />
            ) : isInactive ? (
              <ShieldAlert className="h-5 w-5 text-red-300" />
            ) : (
              <Lock className="h-5 w-5 text-yellow-brand" />
            )}
            <h2 className="font-display text-2xl md:text-3xl font-bold">{heading}</h2>
          </div>
          <p className="text-sm md:text-base text-offwhite/75 font-body max-w-xl">{body}</p>
          {benefits.length > 0 && (
            <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {benefits.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-offwhite/85 font-body">
                  <Sparkles className="h-4 w-4 text-yellow-brand mt-0.5 shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-offwhite/50">
            O redirect pós-compra não libera acesso sozinho; a confirmação vem pela Hubla.
          </p>
        </div>
        {checkoutUrl && isHublaEnabled ? (
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-orange-brand px-6 py-4 font-display text-sm uppercase tracking-wider text-offwhite hover:bg-orange-brand/90 shadow-2xl"
          >
            {isInactive ? "Regularizar na Hubla" : ctaText}
            <ArrowRight className="h-4 w-4" />
          </a>
        ) : (
          <span className="rounded-lg border border-white/15 px-4 py-3 text-xs text-offwhite/60">
            Checkout indisponível
          </span>
        )}
      </div>
    </div>
  );
}
