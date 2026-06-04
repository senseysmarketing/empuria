import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { getClubContent } from "@/lib/portal/clube.functions";
import { markLessonOpened, toggleLessonCompleted } from "@/lib/portal/clube-progress.functions";
import { toggleLessonFavorite } from "@/lib/portal/clube-social.functions";
import { claimCertificate, listMyCertificates } from "@/lib/portal/clube-certificates.functions";
import { ClubHero } from "@/components/portal/ClubHero";
import { ClubPlayer, type PlayerLesson, type SidebarLesson } from "@/components/portal/ClubPlayer";
import { LessonCard } from "@/components/portal/LessonCard";
import { LessonComments } from "@/components/portal/LessonComments";
import { GridSkeleton } from "@/components/portal/PortalSkeleton";
import {
  ArrowRight,
  Award,
  Clock,
  ExternalLink,
  Heart,
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

type RouteLesson = {
  id: string;
  module_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  duration_minutes: number | null;
  position: number;
  is_featured: boolean;
  is_coming_soon: boolean;
  published_at: string | null;
  opened_at: string | null;
  completed_at: string | null;
  video_url: string | null;
  video_provider: string | null;
  video_file_id: string | null;
  video_embed_url: string | null;
  video_source_url: string | null;
  files: { id: string; label: string; file_url: string; file_type: string }[];
};

function ClubePage() {
  const fetchContent = useServerFn(getClubContent);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["club-content"],
    queryFn: () => fetchContent(),
  });
  const fetchCerts = useServerFn(listMyCertificates);
  const { data: certsData } = useQuery({
    queryKey: ["club-certificates"],
    queryFn: () => fetchCerts(),
    enabled: !!data?.isMember,
  });

  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const markOpened = useServerFn(markLessonOpened);
  const toggleCompleted = useServerFn(toggleLessonCompleted);
  const toggleFav = useServerFn(toggleLessonFavorite);
  const claimCert = useServerFn(claimCertificate);

  const openMutation = useMutation({
    mutationFn: (lessonId: string) => markOpened({ data: { lessonId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["club-content"] }),
  });
  const completeMutation = useMutation({
    mutationFn: (lessonId: string) => toggleCompleted({ data: { lessonId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["club-content"] }),
  });
  const favMutation = useMutation({
    mutationFn: (lessonId: string) => toggleFav({ data: { lessonId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["club-content"] }),
  });
  const claimMutation = useMutation({
    mutationFn: (vars: { scope: "module" | "club"; moduleId: string | null }) =>
      claimCert({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["club-certificates"] });
      qc.invalidateQueries({ queryKey: ["club-content"] });
    },
  });

  const playerRef = useRef<HTMLDivElement | null>(null);
  const modulesRef = useRef<HTMLDivElement | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const orderedLessons = useMemo(() => {
    if (!data) return [] as { lesson: RouteLesson; moduleId: string; moduleTitle: string }[];
    const out: { lesson: RouteLesson; moduleId: string; moduleTitle: string }[] = [];
    for (const m of data.modules) {
      for (const l of m.lessons) {
        out.push({ lesson: l as unknown as RouteLesson, moduleId: m.id, moduleTitle: m.title });
      }
    }
    return out;
  }, [data]);

  const favoriteIds = useMemo(
    () => new Set(data?.favoriteLessonIds ?? []),
    [data]
  );

  const featured = orderedLessons.find((o) => o.lesson.is_featured && !o.lesson.is_coming_soon);
  const firstPlayable = orderedLessons.find((o) => !o.lesson.is_coming_soon);
  const lastOpenedId = data?.lastOpenedLessonId ?? null;
  const fallbackId =
    (lastOpenedId && orderedLessons.find((o) => o.lesson.id === lastOpenedId)?.lesson.id) ||
    featured?.lesson.id ||
    firstPlayable?.lesson.id ||
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
    const entry = orderedLessons.find((o) => o.lesson.id === id);
    if (!entry || entry.lesson.is_coming_soon) return;
    navigate({ search: { aula: id }, replace: true });
    openMutation.mutate(id);
    requestAnimationFrame(() => {
      playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const currentIndex = selectedEntry
    ? orderedLessons.findIndex((o) => o.lesson.id === selectedEntry.lesson.id)
    : -1;
  const nextEntry =
    currentIndex >= 0
      ? orderedLessons
          .slice(currentIndex + 1)
          .find((o) => !o.lesson.is_coming_soon) ?? null
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

  const playerLesson =
    (selectedEntry?.lesson as PlayerLesson | undefined) ??
    (continueEntry?.lesson as PlayerLesson | undefined) ??
    null;
  const playerLessonRaw = selectedEntry?.lesson ?? continueEntry?.lesson ?? null;
  const playerCompleted = !!playerLessonRaw?.completed_at;

  // Sidebar do player: aulas do módulo atual
  const playerModuleId = selectedEntry?.moduleId ?? continueEntry?.moduleId ?? null;
  const sidebarLessons: SidebarLesson[] = useMemo(() => {
    if (!playerModuleId || !data) return [];
    const m = data.modules.find((mm) => mm.id === playerModuleId);
    if (!m) return [];
    return m.lessons.map((l) => {
      const lesson = l as unknown as RouteLesson;
      return {
        id: lesson.id,
        title: lesson.title,
        duration_minutes: lesson.duration_minutes,
        is_coming_soon: lesson.is_coming_soon,
        completed: !!lesson.completed_at,
      };
    });
  }, [playerModuleId, data]);

  // Busca: aplaina e filtra
  const searchActive = searchTerm.trim().length > 0;
  const searchResults = useMemo(() => {
    if (!searchActive) return [];
    const t = searchTerm.trim().toLowerCase();
    return orderedLessons.filter((o) =>
      `${o.lesson.title} ${o.lesson.description ?? ""}`.toLowerCase().includes(t)
    );
  }, [searchActive, searchTerm, orderedLessons]);

  // Favoritos
  const favoriteEntries = useMemo(
    () => orderedLessons.filter((o) => favoriteIds.has(o.lesson.id)),
    [orderedLessons, favoriteIds]
  );

  // Progresso por módulo (para botão de emitir certificado)
  const moduleProgress = useMemo(() => {
    if (!data) return new Map<string, { total: number; done: number }>();
    const map = new Map<string, { total: number; done: number }>();
    for (const m of data.modules) {
      const lessons = m.lessons.filter((l) => !(l as unknown as RouteLesson).is_coming_soon);
      const done = lessons.filter(
        (l) => !!(l as unknown as RouteLesson).completed_at
      ).length;
      map.set(m.id, { total: lessons.length, done });
    }
    return map;
  }, [data]);

  const allDone = useMemo(() => {
    const playable = orderedLessons.filter((o) => !o.lesson.is_coming_soon);
    return playable.length > 0 && playable.every((o) => !!o.lesson.completed_at);
  }, [orderedLessons]);

  const certificates = certsData?.certificates ?? [];
  const hasClubCert = certificates.some((c) => c.scope === "club");
  const moduleCertIds = new Set(
    certificates.filter((c) => c.scope === "module").map((c) => c.module_id)
  );

  return (
    <div className="space-y-10">
      <ClubHero
        title={title}
        subtitle={subtitle}
        coverUrl={coverUrl}
        isMember={!!data?.isMember}
        hasSelected={!!selectedEntry || !!lastOpenedId}
        onContinue={continueEntry ? onContinue : undefined}
        onBrowseModules={onBrowseModules}
        whatsappUrl={data?.hubla.whatsappGroupUrl ?? null}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
      />

      {/* COMUNICADOS */}
      {data?.isMember && data.posts.length > 0 && !searchActive && (
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

      {/* RESULTADOS DA BUSCA */}
      {data?.isMember && searchActive && (
        <section>
          <h2 className="font-display text-sm uppercase tracking-[0.25em] text-admin-ink-soft mb-3">
            Resultados para "{searchTerm}" ({searchResults.length})
          </h2>
          {searchResults.length === 0 ? (
            <p className="text-sm text-admin-ink-muted">Nenhuma aula encontrada.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {searchResults.map((o) => (
                <div key={o.lesson.id} className="contents">
                  <LessonCard
                    lesson={o.lesson as never}
                    moduleTitle={o.moduleTitle}
                    comingSoon={o.lesson.is_coming_soon}
                    active={selectedEntry?.lesson.id === o.lesson.id}
                    completed={!!o.lesson.completed_at}
                    favorited={favoriteIds.has(o.lesson.id)}
                    onToggleFavorite={() => favMutation.mutate(o.lesson.id)}
                    onSelect={() => selectLesson(o.lesson.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* PLAYER INLINE */}
      {data?.isMember && !searchActive && (
        <section ref={playerRef} className="scroll-mt-24 space-y-6">
          <ClubPlayer
            lesson={playerLesson}
            moduleTitle={
              selectedEntry?.moduleTitle ?? continueEntry?.moduleTitle ?? null
            }
            watermark={data?.memberName ?? null}
            isCompleted={playerCompleted}
            onMarkComplete={
              playerLessonRaw
                ? () => completeMutation.mutate(playerLessonRaw.id)
                : undefined
            }
            onNext={nextEntry ? () => selectLesson(nextEntry.lesson.id) : undefined}
            nextTitle={nextEntry?.lesson.title ?? null}
            sidebarLessons={sidebarLessons}
            onSelectSidebar={selectLesson}
          />
          {playerLessonRaw && <LessonComments lessonId={playerLessonRaw.id} />}
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
        !searchActive && (
          <div ref={modulesRef} className="space-y-12 scroll-mt-24">
            {/* CONTINUE / COMECE POR AQUI */}
            {data.isMember && continueEntry && (
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-yellow-brand" />
                  <h2 className="font-display text-sm uppercase tracking-[0.25em] text-admin-ink-soft">
                    {lastOpenedId && lastOpenedId === continueEntry.lesson.id
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
                    completed={!!continueEntry.lesson.completed_at}
                    favorited={favoriteIds.has(continueEntry.lesson.id)}
                    onToggleFavorite={() => favMutation.mutate(continueEntry.lesson.id)}
                    onSelect={() => selectLesson(continueEntry.lesson.id)}
                  />
                </div>
              </section>
            )}

            {/* MEUS FAVORITOS */}
            {data.isMember && favoriteEntries.length > 0 && (
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <Heart className="h-4 w-4 text-orange-brand fill-orange-brand" />
                  <h2 className="font-display text-sm uppercase tracking-[0.25em] text-admin-ink-soft">
                    Meus favoritos
                  </h2>
                </div>
                <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-2 px-2">
                  {favoriteEntries.map((o) => (
                    <LessonCard
                      key={o.lesson.id}
                      lesson={o.lesson as never}
                      moduleTitle={o.moduleTitle}
                      comingSoon={o.lesson.is_coming_soon}
                      active={selectedEntry?.lesson.id === o.lesson.id}
                      completed={!!o.lesson.completed_at}
                      favorited
                      onToggleFavorite={() => favMutation.mutate(o.lesson.id)}
                      onSelect={() => selectLesson(o.lesson.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {data.modules.map((m) => {
              const prog = moduleProgress.get(m.id);
              const moduleDone = prog && prog.total > 0 && prog.done === prog.total;
              const hasCert = moduleCertIds.has(m.id);
              return (
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
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] uppercase tracking-widest font-display text-admin-ink-muted">
                        {m.lessons.length} aula{m.lessons.length === 1 ? "" : "s"}
                        {prog && prog.total > 0 ? ` · ${prog.done}/${prog.total}` : ""}
                      </span>
                      {data.isMember && moduleDone && !hasCert && (
                        <button
                          onClick={() =>
                            claimMutation.mutate({ scope: "module", moduleId: m.id })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-brand/40 bg-yellow-brand/10 px-3 py-1.5 text-[11px] font-display uppercase tracking-wider text-yellow-brand hover:bg-yellow-brand/20"
                        >
                          <Award className="h-3.5 w-3.5" /> Emitir certificado
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-2 px-2">
                    {m.lessons.map((l) => {
                      const lesson = l as unknown as RouteLesson;
                      return (
                        <LessonCard
                          key={lesson.id}
                          lesson={lesson as never}
                          moduleTitle={m.title}
                          locked={!data.isMember}
                          comingSoon={lesson.is_coming_soon}
                          active={selectedEntry?.lesson.id === lesson.id}
                          completed={!!lesson.completed_at}
                          favorited={favoriteIds.has(lesson.id)}
                          onToggleFavorite={
                            data.isMember
                              ? () => favMutation.mutate(lesson.id)
                              : undefined
                          }
                          onSelect={() => selectLesson(lesson.id)}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {/* MINHAS CONQUISTAS */}
            {data.isMember && (
              <section className="rounded-3xl border border-admin-border bg-admin-surface p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Award className="h-4 w-4 text-yellow-brand" />
                  <h2 className="font-display text-sm uppercase tracking-[0.25em] text-admin-ink-soft">
                    Minhas conquistas
                  </h2>
                </div>
                {certificates.length === 0 ? (
                  <p className="text-sm text-admin-ink-muted">
                    Conclua todas as aulas de um módulo ou do Clube inteiro para emitir
                    seu certificado.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {certificates.map((c) => {
                      const moduleTitle =
                        c.scope === "module"
                          ? data.modules.find((m) => m.id === c.module_id)?.title ?? "Módulo"
                          : "Clube do Imigrante";
                      return (
                        <Link
                          key={c.id}
                          to="/portal/clube/certificado/$code"
                          params={{ code: c.code }}
                          target="_blank"
                          className="rounded-xl border border-yellow-brand/40 bg-yellow-brand/5 p-4 hover:bg-yellow-brand/10 transition"
                        >
                          <div className="flex items-center gap-2 text-yellow-brand">
                            <Award className="h-4 w-4" />
                            <span className="text-[10px] uppercase tracking-widest font-display">
                              {c.scope === "club" ? "Clube completo" : "Módulo"}
                            </span>
                          </div>
                          <p className="mt-2 font-display text-sm font-bold text-admin-ink">
                            {moduleTitle}
                          </p>
                          <p className="text-[11px] text-admin-ink-muted mt-1">
                            {new Date(c.issued_at).toLocaleDateString("pt-BR")} · {c.code}
                          </p>
                          <span className="mt-3 inline-flex items-center gap-1 text-[11px] text-admin-accent">
                            Ver certificado <ExternalLink className="h-3 w-3" />
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}

                {allDone && !hasClubCert && (
                  <div className="mt-4">
                    <button
                      onClick={() =>
                        claimMutation.mutate({ scope: "club", moduleId: null })
                      }
                      className="inline-flex items-center gap-2 rounded-xl bg-orange-brand px-5 py-2.5 text-xs font-display uppercase tracking-wider text-white hover:bg-orange-brand/90 shadow-lg"
                    >
                      <Award className="h-4 w-4" /> Emitir certificado do Clube
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>
        )
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
