import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Crown, BookOpen, Megaphone, ExternalLink, Users, FolderTree, FileVideo, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { ClubeWallManager, useClubData } from "@/components/admin/ClubeManagers";
import {
  useCurriculum,
  ModulesManager,
  LessonsManager,
  ClubSettingsManager,
} from "@/components/admin/ClubeCurriculumManagers";
import { ClubeModerationManager } from "@/components/admin/ClubeModerationManager";

export function ClubeAdminTab() {
  const club = useClubData();
  const curriculum = useCurriculum();
  const [tab, setTab] = useState<"modulos" | "aulas" | "comunicados" | "moderacao" | "config">("modulos");

  const posts = club.data?.posts ?? [];
  const members = club.data?.members ?? [];
  const modules = curriculum.data?.modules ?? [];
  const lessons = curriculum.data?.lessons ?? [];
  const files = curriculum.data?.files ?? [];
  const settings = curriculum.data?.settings ?? null;

  const stats = useMemo(() => {
    const publishedLessons = lessons.filter((l) => l.is_published).length;
    const activeModules = modules.filter((m) => m.is_published).length;
    const activeMembers = members.filter((m) => m.is_club_member).length;
    return { publishedLessons, activeModules, posts: posts.length, activeMembers };
  }, [lessons, modules, posts, members]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-admin-border bg-admin-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-admin-accent-soft text-admin-accent flex items-center justify-center">
              <Crown className="h-6 w-6" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold text-admin-ink">Clube do Imigrante</h2>
              <p className="text-sm text-admin-ink-muted mt-0.5">
                Gerencie módulos, aulas, materiais, comunicados e a vitrine do Clube. A assinatura segue controlada pela Hubla.
              </p>
            </div>
          </div>
          <a
            href="/portal/clube"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-admin-bg px-4 py-2 text-xs font-display uppercase tracking-wider text-admin-ink-soft hover:text-admin-ink"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Ver portal como membro
          </a>
        </div>

        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile icon={<FileVideo className="h-4 w-4" />} label="Aulas publicadas" value={stats.publishedLessons} />
          <StatTile icon={<FolderTree className="h-4 w-4" />} label="Módulos ativos" value={stats.activeModules} />
          <StatTile icon={<Megaphone className="h-4 w-4" />} label="Comunicados" value={stats.posts} />
          <StatTile icon={<Users className="h-4 w-4" />} label="Assinantes ativos" value={stats.activeMembers} accent />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="bg-admin-surface border border-admin-border h-auto gap-1 p-1 flex-wrap">
          <TabsTrigger value="modulos" className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white">
            <FolderTree className="h-4 w-4" /> Módulos
          </TabsTrigger>
          <TabsTrigger value="aulas" className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white">
            <BookOpen className="h-4 w-4" /> Aulas
          </TabsTrigger>
          <TabsTrigger value="comunicados" className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white">
            <Megaphone className="h-4 w-4" /> Comunicados
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white">
            <SettingsIcon className="h-4 w-4" /> Configurações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="modulos" className="mt-6">
          {curriculum.isLoading ? (
            <p className="text-sm text-admin-ink-muted">Carregando…</p>
          ) : (
            <ModulesManager modules={modules} lessons={lessons} />
          )}
        </TabsContent>
        <TabsContent value="aulas" className="mt-6">
          {curriculum.isLoading ? (
            <p className="text-sm text-admin-ink-muted">Carregando…</p>
          ) : (
            <LessonsManager modules={modules} lessons={lessons} files={files} />
          )}
        </TabsContent>
        <TabsContent value="comunicados" className="mt-6">
          {club.isLoading ? (
            <p className="text-sm text-admin-ink-muted">Carregando…</p>
          ) : (
            <ClubeWallManager posts={posts} />
          )}
        </TabsContent>
        <TabsContent value="config" className="mt-6">
          {curriculum.isLoading ? (
            <p className="text-sm text-admin-ink-muted">Carregando…</p>
          ) : (
            <ClubSettingsManager settings={settings} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent ? "bg-admin-accent-soft border-admin-accent/30" : "bg-admin-bg border-admin-border"
      }`}
    >
      <div className="flex items-center gap-2 text-admin-ink-muted">
        {icon}
        <span className="text-[10px] uppercase tracking-widest font-display">{label}</span>
      </div>
      <div className="font-display text-3xl font-bold text-admin-ink tabular-nums mt-1">{value}</div>
    </div>
  );
}
