import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Crown, BookOpen, Megaphone, ExternalLink, Users, FolderTree, FileVideo } from "lucide-react";
import { ClubeContentManager, ClubeWallManager, useClubData } from "@/components/admin/ClubeManagers";

export function ClubeAdminTab() {
  const club = useClubData();
  const [tab, setTab] = useState<"conteudo" | "comunicados">("conteudo");

  const content = club.data?.content ?? [];
  const posts = club.data?.posts ?? [];
  const members = club.data?.members ?? [];

  const stats = useMemo(() => {
    const published = content.filter((c) => c.is_published).length;
    const modules = new Set(content.map((c) => c.module)).size;
    const activeMembers = members.filter((m) => m.is_club_member).length;
    return { published, modules, posts: posts.length, activeMembers };
  }, [content, posts, members]);

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
                Gerencie aulas, módulos e comunicados do Clube. A assinatura continua sendo controlada pela Hubla.
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
          <StatTile icon={<FileVideo className="h-4 w-4" />} label="Aulas publicadas" value={stats.published} />
          <StatTile icon={<FolderTree className="h-4 w-4" />} label="Módulos ativos" value={stats.modules} />
          <StatTile icon={<Megaphone className="h-4 w-4" />} label="Comunicados" value={stats.posts} />
          <StatTile icon={<Users className="h-4 w-4" />} label="Assinantes ativos" value={stats.activeMembers} accent />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="bg-admin-surface border border-admin-border h-auto gap-1 p-1">
          <TabsTrigger
            value="conteudo"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <BookOpen className="h-4 w-4" /> Aulas & Conteúdo
          </TabsTrigger>
          <TabsTrigger
            value="comunicados"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <Megaphone className="h-4 w-4" /> Comunicados
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conteudo" className="mt-6">
          {club.isLoading ? (
            <p className="text-sm text-admin-ink-muted">Carregando…</p>
          ) : (
            <ClubeContentManager items={content} />
          )}
        </TabsContent>
        <TabsContent value="comunicados" className="mt-6">
          {club.isLoading ? (
            <p className="text-sm text-admin-ink-muted">Carregando…</p>
          ) : (
            <ClubeWallManager posts={posts} />
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
        accent
          ? "bg-admin-accent-soft border-admin-accent/30"
          : "bg-admin-bg border-admin-border"
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
