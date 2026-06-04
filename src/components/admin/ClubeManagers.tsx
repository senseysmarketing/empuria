import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getClubData,
  upsertContent,
  deleteContent,
  togglePublishContent,
  reorderContent,
  createPost,
  togglePinPost,
  deletePost,
} from "@/lib/admin/clube.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Pin,
  PinOff,
  Plus,
  Trash2,
  Pencil,
  Search,
  ArrowUp,
  ArrowDown,
  Eye,
  ImageOff,
  PlayCircle,
} from "lucide-react";
import { toast } from "sonner";
import { VideoPlayerModal } from "@/components/portal/VideoPlayerModal";
import { VideoSourceField } from "@/components/admin/clube/VideoSourceField";

type Content = Awaited<ReturnType<typeof getClubData>>["content"][number];
type Post = Awaited<ReturnType<typeof getClubData>>["posts"][number];

export function useClubData() {
  const fetchData = useServerFn(getClubData);
  return useQuery({ queryKey: ["club"], queryFn: () => fetchData() });
}

export function ClubeContentManager({ items }: { items: Content[] }) {
  const upsert = useServerFn(upsertContent);
  const del = useServerFn(deleteContent);
  const togglePublish = useServerFn(togglePublishContent);
  const reorder = useServerFn(reorderContent);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Content | null>(null);
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<Content | null>(null);

  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");

  const refresh = () => qc.invalidateQueries({ queryKey: ["club"] });

  const modules = useMemo(() => {
    const set = new Set(items.map((i) => i.module).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((c) => {
      if (moduleFilter !== "all" && c.module !== moduleFilter) return false;
      if (statusFilter === "published" && !c.is_published) return false;
      if (statusFilter === "draft" && c.is_published) return false;
      if (term && !c.title.toLowerCase().includes(term) && !(c.description ?? "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [items, search, moduleFilter, statusFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Content[]>();
    for (const c of filtered) {
      const k = c.module || "Geral";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    for (const [, arr] of map) arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [filtered]);

  const onDelete = async (id: string) => {
    if (!confirm("Excluir conteúdo?")) return;
    await del({ data: { id } });
    toast.success("Excluído");
    refresh();
  };

  const onTogglePublish = async (c: Content) => {
    await togglePublish({ data: { id: c.id, is_published: !c.is_published } });
    toast.success(!c.is_published ? "Publicado" : "Despublicado");
    refresh();
  };

  const move = async (moduleKey: string, index: number, dir: -1 | 1) => {
    const list = items
      .filter((i) => (i.module || "Geral") === moduleKey)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const reordered = [...list];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const payload = reordered.map((c, i) => ({ id: c.id, position: i }));
    await reorder({ data: { items: payload } });
    refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-admin-ink-muted" />
            <Input
              placeholder="Buscar por título ou descrição..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="h-9 rounded-md border border-admin-border bg-admin-bg px-2 text-sm text-admin-ink"
          >
            <option value="all">Todos os módulos</option>
            {modules.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-9 rounded-md border border-admin-border bg-admin-bg px-2 text-sm text-admin-ink"
          >
            <option value="all">Todos os status</option>
            <option value="published">Publicados</option>
            <option value="draft">Rascunhos</option>
          </select>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }} className="bg-admin-accent hover:bg-admin-accent/90">
          <Plus className="h-4 w-4" /> Nova aula
        </Button>
      </div>

      {grouped.length === 0 && (
        <p className="text-admin-ink-muted text-sm py-8 text-center">Nenhuma aula encontrada com esses filtros.</p>
      )}

      <div className="space-y-6">
        {grouped.map(([moduleName, list]) => (
          <div key={moduleName} className="space-y-3">
            <div className="flex items-center gap-3">
              <h3 className="font-display text-sm uppercase tracking-widest text-admin-accent">{moduleName}</h3>
              <span className="text-xs text-admin-ink-muted">{list.length} {list.length === 1 ? "aula" : "aulas"}</span>
              <div className="flex-1 h-px bg-admin-border" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {list.map((c, idx) => {
                const moduleList = items
                  .filter((i) => (i.module || "Geral") === moduleName)
                  .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
                const realIdx = moduleList.findIndex((m) => m.id === c.id);
                return (
                  <div key={c.id} className="bg-admin-surface border border-admin-border rounded-2xl overflow-hidden shadow-[var(--shadow-admin)] flex flex-col">
                    <div className="relative aspect-video bg-admin-bg border-b border-admin-border">
                      {c.thumbnail_url ? (
                        <img src={c.thumbnail_url} alt={c.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-admin-ink-muted">
                          <ImageOff className="h-8 w-8 opacity-40" />
                        </div>
                      )}
                      {c.video_url && (
                        <button
                          type="button"
                          onClick={() => setPreviewing(c)}
                          className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/40 transition-colors group"
                        >
                          <PlayCircle className="h-12 w-12 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      )}
                      <span className={`absolute top-2 right-2 text-[10px] uppercase px-2 py-0.5 rounded ${c.is_published ? "bg-emerald-500 text-white" : "bg-slate-700 text-white"}`}>
                        {c.is_published ? "Publicado" : "Rascunho"}
                      </span>
                    </div>
                    <div className="p-4 flex-1 flex flex-col">
                      <h3 className="font-display text-base text-admin-ink line-clamp-2">{c.title}</h3>
                      {c.description && <p className="text-xs text-admin-ink-muted mt-1 line-clamp-2">{c.description}</p>}
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-admin-border">
                        <div className="flex items-center gap-2">
                          <Switch checked={!!c.is_published} onCheckedChange={() => onTogglePublish(c)} />
                          <span className="text-[11px] text-admin-ink-muted">Publicar</span>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <Button size="icon" variant="ghost" disabled={realIdx <= 0} onClick={() => move(moduleName, realIdx, -1)} title="Mover para cima">
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" disabled={realIdx < 0 || realIdx >= moduleList.length - 1} onClick={() => move(moduleName, realIdx, 1)} title="Mover para baixo">
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setPreviewing(c)} title="Pré-visualizar">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }} title="Editar">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => onDelete(c.id)} className="text-admin-danger" title="Excluir">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <ContentDialog key={editing?.id ?? "new"} open={open} onOpenChange={setOpen} editing={editing} upsert={upsert} onSaved={refresh} modules={modules} onPreview={setPreviewing} />

      <VideoPlayerModal
        video={previewing ? { id: previewing.id, title: previewing.title, description: previewing.description, video_url: previewing.video_url } : null}
        open={!!previewing}
        onOpenChange={(v) => !v && setPreviewing(null)}
      />
    </div>
  );
}

function ContentDialog({
  open, onOpenChange, editing, upsert, onSaved, modules, onPreview,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Content | null;
  upsert: ReturnType<typeof useServerFn<typeof upsertContent>>;
  onSaved: () => void;
  modules: string[];
  onPreview: (c: Content) => void;
}) {
  const [form, setForm] = useState(() => ({
    title: editing?.title ?? "",
    description: editing?.description ?? "",
    module: editing?.module ?? "Geral",
    video_url: editing?.video_url ?? "",
    thumbnail_url: editing?.thumbnail_url ?? "",
    position: editing?.position ?? 0,
    is_published: editing?.is_published ?? false,
  }));

  const validUrl = (s: string) => {
    if (!s) return true;
    try { new URL(s); return true; } catch { return false; }
  };

  const titleErr = form.title.trim().length < 2;
  const videoErr = !!form.video_url && !validUrl(form.video_url);
  const thumbErr = !!form.thumbnail_url && !validUrl(form.thumbnail_url);
  const canSave = !titleErr && !videoErr && !thumbErr && form.module.trim().length > 0;

  const submit = async () => {
    if (!canSave) return;
    try {
      await upsert({ data: { id: editing?.id, ...form, video_source_url: form.video_url } });
      toast.success("Salvo");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const preview = () => {
    onPreview({
      id: editing?.id ?? "preview",
      title: form.title || "Sem título",
      description: form.description || null,
      video_url: form.video_url || null,
      thumbnail_url: form.thumbnail_url || null,
      module: form.module,
      position: form.position,
      is_published: form.is_published,
      created_at: editing?.created_at ?? new Date().toISOString(),
      updated_at: editing?.updated_at ?? new Date().toISOString(),
      created_by: editing?.created_by ?? null,
    } as Content);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{editing ? "Editar aula" : "Nova aula"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label>Título</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              {titleErr && <p className="text-xs text-admin-danger mt-1">Informe pelo menos 2 caracteres.</p>}
            </div>
            <div>
              <Label>Módulo</Label>
              <Input
                value={form.module}
                onChange={(e) => setForm({ ...form, module: e.target.value })}
                list="modules-datalist"
              />
              <datalist id="modules-datalist">
                {modules.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>Descrição</Label>
                <span className="text-[10px] text-admin-ink-muted">{form.description.length}/2000</span>
              </div>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value.slice(0, 2000) })}
                rows={4}
              />
            </div>
            <VideoSourceField
              value={form.video_url}
              onChange={(v) => setForm({ ...form, video_url: v })}
              error={videoErr}
            />
            <div>
              <Label>URL da capa (thumbnail)</Label>
              <Input value={form.thumbnail_url} onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })} placeholder="https://..." />
              {thumbErr && <p className="text-xs text-admin-danger mt-1">URL inválida.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Ordem</Label>
                <Input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: parseInt(e.target.value || "0") })} />
              </div>
              <div className="flex items-end gap-2">
                <Switch checked={form.is_published} onCheckedChange={(v) => setForm({ ...form, is_published: v })} />
                <span className="text-sm">Publicar</span>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <Label>Pré-visualização da capa</Label>
              <div className="aspect-video bg-admin-bg border border-admin-border rounded-lg overflow-hidden flex items-center justify-center mt-1">
                {form.thumbnail_url && validUrl(form.thumbnail_url) ? (
                  <img src={form.thumbnail_url} alt="capa" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-admin-ink-muted text-xs flex flex-col items-center gap-2">
                    <ImageOff className="h-8 w-8 opacity-50" />
                    <span>Sem capa</span>
                  </div>
                )}
              </div>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={preview} disabled={!form.video_url || !validUrl(form.video_url)}>
              <Eye className="h-4 w-4" /> Pré-visualizar aula
            </Button>
          </div>
        </div>
        <div className="flex gap-2 pt-2 border-t border-admin-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">Cancelar</Button>
          <Button onClick={submit} disabled={!canSave} className="flex-1 bg-admin-accent hover:bg-admin-accent/90">Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ClubeWallManager({ posts }: { posts: Post[] }) {
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
    toast.success("Comunicado publicado");
    setBody("");
    setPinned(false);
    refresh();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <BentoCard title="Novo comunicado" className="lg:col-span-1">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="Escreva um comunicado para os membros do Clube..." />
        <div className="flex items-center justify-between mt-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={pinned} onCheckedChange={setPinned} /> Fixar no topo
          </label>
          <Button onClick={submit} size="sm" className="bg-admin-accent hover:bg-admin-accent/90" disabled={body.trim().length < 2}>
            Publicar
          </Button>
        </div>
      </BentoCard>

      <div className="lg:col-span-2 space-y-3">
        {posts.length === 0 && <p className="text-admin-ink-muted text-sm">Nenhum comunicado publicado ainda.</p>}
        {posts.map((p) => (
          <div
            key={p.id}
            className={`bg-admin-surface border rounded-2xl p-4 shadow-[var(--shadow-admin)] ${p.is_pinned ? "border-admin-accent/40 ring-1 ring-admin-accent/20" : "border-admin-border"}`}
          >
            <div className="flex justify-between items-start gap-2 mb-2">
              <div className="text-xs text-admin-ink-muted">
                <span className="font-display text-admin-ink">{p.author_name ?? "Equipe"}</span> · {new Date(p.created_at).toLocaleString("pt-BR")}
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => { pin({ data: { id: p.id, pin: !p.is_pinned } }).then(refresh); }} title={p.is_pinned ? "Desafixar" : "Fixar no topo"}>
                  {p.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm("Excluir comunicado?")) del({ data: { id: p.id } }).then(refresh); }} title="Excluir">
                  <Trash2 className="h-3.5 w-3.5 text-admin-danger" />
                </Button>
              </div>
            </div>
            {p.is_pinned && (
              <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-admin-accent mb-1 font-display">
                <Pin className="h-3 w-3" /> Fixado no topo
              </div>
            )}
            <p className="text-sm text-admin-ink-soft whitespace-pre-wrap">{p.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
