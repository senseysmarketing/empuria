import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getClubData,
  toggleMembership,
  upsertContent,
  deleteContent,
  createPost,
  togglePinPost,
  deletePost,
} from "@/lib/admin/clube.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pin, PinOff, Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/clube")({
  component: ClubePage,
});

type Content = Awaited<ReturnType<typeof getClubData>>["content"][number];

function ClubePage() {
  const fetchData = useServerFn(getClubData);
  const toggle = useServerFn(toggleMembership);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["club"], queryFn: () => fetchData() });

  const onToggleMember = async (id: string, isMember: boolean) => {
    try {
      await toggle({ data: { id, is_member: isMember } });
      toast.success(isMember ? "Membro ativado" : "Membro desativado");
      qc.invalidateQueries({ queryKey: ["club"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const memberCount = data?.members.filter((m) => m.is_club_member).length ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl font-bold tracking-tight">Clube do Imigrante</h1>
        <p className="text-admin-ink-muted text-sm mt-1">
          {memberCount} membros ativos · {data?.content.length ?? 0} conteúdos · {data?.posts.length ?? 0} posts
        </p>
      </header>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Membros</TabsTrigger>
          <TabsTrigger value="content">Conteúdo</TabsTrigger>
          <TabsTrigger value="wall">Mural</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <BentoCard padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-admin-surface-2 text-xs uppercase tracking-wider text-admin-ink-muted">
                  <tr>
                    <th className="text-left px-4 py-3">Nome</th>
                    <th className="text-left px-4 py-3">Telefone</th>
                    <th className="text-left px-4 py-3">Desde</th>
                    <th className="text-right px-4 py-3">Membro ativo</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.members ?? []).map((m) => (
                    <tr key={m.id} className="border-t border-admin-border">
                      <td className="px-4 py-3">{m.full_name ?? "Sem nome"}</td>
                      <td className="px-4 py-3 text-admin-ink-muted">{m.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-admin-ink-muted text-xs">{new Date(m.created_at).toLocaleDateString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right">
                        <Switch checked={!!m.is_club_member} onCheckedChange={(v) => onToggleMember(m.id, v)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </BentoCard>
        </TabsContent>

        <TabsContent value="content" className="mt-4">
          <ContentManager items={data?.content ?? []} />
        </TabsContent>

        <TabsContent value="wall" className="mt-4">
          <WallManager posts={data?.posts ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ContentManager({ items }: { items: Content[] }) {
  const upsert = useServerFn(upsertContent);
  const del = useServerFn(deleteContent);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Content | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["club"] });

  const onDelete = async (id: string) => {
    if (!confirm("Excluir conteúdo?")) return;
    await del({ data: { id } });
    toast.success("Excluído");
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setOpen(true); }} className="bg-admin-accent hover:bg-admin-accent/90">
          <Plus className="h-4 w-4" /> Novo conteúdo
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.length === 0 && <p className="text-admin-ink-muted col-span-full">Nenhum conteúdo ainda.</p>}
        {items.map((c) => (
          <div key={c.id} className="bg-admin-surface border border-admin-border rounded-2xl p-4 shadow-[var(--shadow-admin)]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-admin-accent">{c.module}</div>
                <h3 className="font-display text-lg text-admin-ink truncate">{c.title}</h3>
              </div>
              <span className={`text-[10px] uppercase px-2 py-0.5 rounded ${c.is_published ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-600"}`}>
                {c.is_published ? "Publicado" : "Rascunho"}
              </span>
            </div>
            {c.description && <p className="text-xs text-admin-ink-muted mt-2 line-clamp-3">{c.description}</p>}
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}>
                <Pencil className="h-3 w-3" /> Editar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(c.id)} className="text-admin-danger">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <ContentDialog open={open} onOpenChange={setOpen} editing={editing} upsert={upsert} onSaved={refresh} />
    </div>
  );
}

function ContentDialog({
  open, onOpenChange, editing, upsert, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Content | null;
  upsert: ReturnType<typeof useServerFn<typeof upsertContent>>;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => ({
    title: editing?.title ?? "",
    description: editing?.description ?? "",
    module: editing?.module ?? "Geral",
    video_url: editing?.video_url ?? "",
    position: editing?.position ?? 0,
    is_published: editing?.is_published ?? false,
  }));

  // Reset when editing changes
  useState(() => {
    setForm({
      title: editing?.title ?? "",
      description: editing?.description ?? "",
      module: editing?.module ?? "Geral",
      video_url: editing?.video_url ?? "",
      position: editing?.position ?? 0,
      is_published: editing?.is_published ?? false,
    });
  });

  const submit = async () => {
    try {
      await upsert({ data: { id: editing?.id, ...form } });
      toast.success("Salvo");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Editar conteúdo" : "Novo conteúdo"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Título</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><Label>Módulo</Label><Input value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })} /></div>
          <div><Label>Descrição</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
          <div><Label>URL do vídeo</Label><Input value={form.video_url} onChange={(e) => setForm({ ...form, video_url: e.target.value })} placeholder="https://..." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Ordem</Label><Input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: parseInt(e.target.value || "0") })} /></div>
            <div className="flex items-end gap-2"><Switch checked={form.is_published} onCheckedChange={(v) => setForm({ ...form, is_published: v })} /><span className="text-sm">Publicar</span></div>
          </div>
          <Button onClick={submit} className="w-full bg-admin-accent hover:bg-admin-accent/90">Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WallManager({ posts }: { posts: Awaited<ReturnType<typeof getClubData>>["posts"] }) {
  const create = useServerFn(createPost);
  const pin = useServerFn(togglePinPost);
  const del = useServerFn(deletePost);
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["club"] });

  const submit = async () => {
    if (body.trim().length < 2) return;
    await create({ data: { body: body.trim(), is_pinned: pinned } });
    toast.success("Publicado");
    setBody("");
    setPinned(false);
    refresh();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <BentoCard title="Novo post" className="lg:col-span-1">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="Comunicado para a comunidade..." />
        <div className="flex items-center justify-between mt-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={pinned} onCheckedChange={setPinned} /> Fixar no topo
          </label>
          <Button onClick={submit} size="sm" className="bg-admin-accent hover:bg-admin-accent/90">Publicar</Button>
        </div>
      </BentoCard>

      <div className="lg:col-span-2 space-y-3">
        {posts.length === 0 && <p className="text-admin-ink-muted">Nenhum post no mural.</p>}
        {posts.map((p) => (
          <div key={p.id} className="bg-admin-surface border border-admin-border rounded-2xl p-4 shadow-[var(--shadow-admin)]">
            <div className="flex justify-between items-start gap-2 mb-2">
              <div className="text-xs text-admin-ink-muted">
                <span className="font-display text-admin-ink">{p.author_name ?? "Equipe"}</span> · {new Date(p.created_at).toLocaleString("pt-BR")}
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => { pin({ data: { id: p.id, pin: !p.is_pinned } }).then(refresh); }}>
                  {p.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm("Excluir?")) del({ data: { id: p.id } }).then(refresh); }}>
                  <Trash2 className="h-3.5 w-3.5 text-admin-danger" />
                </Button>
              </div>
            </div>
            {p.is_pinned && <div className="text-[10px] uppercase tracking-wider text-admin-accent mb-1">Fixado</div>}
            <p className="text-sm text-admin-ink-soft whitespace-pre-wrap">{p.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
