import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getCurriculum,
  upsertModule,
  toggleModulePublish,
  reorderModules,
  deleteModule,
  upsertLesson,
  toggleLessonPublish,
  reorderLessons,
  deleteLesson,
  addLessonFile,
  removeLessonFile,
  createUploadUrl,
  updateClubSettings,
} from "@/lib/admin/clube-curriculum.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Upload,
  FileText,
  Link as LinkIcon,
  ImageOff,
  PlayCircle,
  Search,
  X,
} from "lucide-react";
import { VideoPlayerModal } from "@/components/portal/VideoPlayerModal";
import { VideoSourceField } from "@/components/admin/clube/VideoSourceField";

type Curriculum = Awaited<ReturnType<typeof getCurriculum>>;
type Module = Curriculum["modules"][number];
type Lesson = Curriculum["lessons"][number];
type LessonFile = Curriculum["files"][number];
type Settings = Curriculum["settings"];

export function useCurriculum() {
  const fetchData = useServerFn(getCurriculum);
  return useQuery({ queryKey: ["club-curriculum"], queryFn: () => fetchData() });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["club-curriculum"] });
}

async function uploadFile(
  createUrl: ReturnType<typeof useServerFn<typeof createUploadUrl>>,
  file: File,
  kind: "module-cover" | "lesson-thumb" | "lesson-file" | "club-cover",
) {
  const sig = await createUrl({ data: { filename: file.name, kind, content_type: file.type } });
  const res = await fetch(sig.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error("Falha no upload");
  return sig;
}

// =========================================================
// MÓDULOS
// =========================================================

export function ModulesManager({ modules, lessons }: { modules: Module[]; lessons: Lesson[] }) {
  const upsert = useServerFn(upsertModule);
  const togglePub = useServerFn(toggleModulePublish);
  const reorder = useServerFn(reorderModules);
  const del = useServerFn(deleteModule);
  const refresh = useRefresh();
  const [editing, setEditing] = useState<Module | null>(null);
  const [open, setOpen] = useState(false);

  const sorted = useMemo(() => [...modules].sort((a, b) => a.position - b.position), [modules]);
  const countLessons = (id: string) => lessons.filter((l) => l.module_id === id).length;

  const move = async (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[next];
    await reorder({ data: { items: [{ id: a.id, position: b.position }, { id: b.id, position: a.position }] } });
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold text-admin-ink">Módulos</h3>
          <p className="text-xs text-admin-ink-muted">Cursos do Clube. Cada módulo agrupa aulas.</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" /> Novo módulo
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-admin-border p-8 text-center text-sm text-admin-ink-muted">
          Nenhum módulo ainda. Crie o primeiro para começar.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sorted.map((m, idx) => (
            <div key={m.id} className="rounded-xl border border-admin-border bg-admin-bg overflow-hidden flex flex-col">
              <div className="aspect-video bg-admin-surface-2 relative">
                {m.cover_url ? (
                  <img src={m.cover_url} alt={m.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-admin-ink-muted">
                    <ImageOff className="h-6 w-6" />
                  </div>
                )}
                <div className="absolute top-2 right-2 flex gap-1">
                  <button
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="h-7 w-7 rounded bg-black/60 text-white flex items-center justify-center disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => move(idx, 1)}
                    disabled={idx === sorted.length - 1}
                    className="h-7 w-7 rounded bg-black/60 text-white flex items-center justify-center disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="p-3 flex-1 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-display font-semibold text-admin-ink leading-tight">{m.title}</h4>
                    <p className="text-[11px] text-admin-ink-muted mt-0.5">
                      {countLessons(m.id)} aula{countLessons(m.id) === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${
                      m.is_published ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {m.is_published ? "Publicado" : "Rascunho"}
                  </span>
                </div>
                {m.description && (
                  <p className="text-xs text-admin-ink-muted line-clamp-2">{m.description}</p>
                )}
                <div className="flex items-center justify-between mt-auto pt-2 border-t border-admin-border">
                  <Switch
                    checked={m.is_published}
                    onCheckedChange={async (v) => {
                      await togglePub({ data: { id: m.id, is_published: v } });
                      refresh();
                    }}
                  />
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(m);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!confirm(`Apagar "${m.title}" e todas as aulas/materiais dentro?`)) return;
                        await del({ data: { id: m.id } });
                        toast.success("Módulo removido");
                        refresh();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ModuleDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        onSubmit={async (payload) => {
          await upsert({ data: payload });
          toast.success(editing ? "Módulo atualizado" : "Módulo criado");
          setOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

function ModuleDialog({
  open,
  onOpenChange,
  editing,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Module | null;
  onSubmit: (payload: {
    id?: string;
    title: string;
    description?: string;
    cover_url?: string;
    position: number;
    is_published: boolean;
  }) => Promise<void>;
}) {
  const createUrl = useServerFn(createUploadUrl);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [position, setPosition] = useState(0);
  const [isPublished, setIsPublished] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useMemo(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setDescription(editing?.description ?? "");
      setCoverUrl(editing?.cover_url ?? "");
      setPosition(editing?.position ?? 0);
      setIsPublished(editing?.is_published ?? false);
    }
  }, [open, editing]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const sig = await uploadFile(createUrl, file, "module-cover");
      setCoverUrl(sig.canonical);
      toast.success("Capa enviada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar módulo" : "Novo módulo"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div>
            <Label>Capa</Label>
            <div className="flex gap-2">
              <Input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://..." />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                }}
              />
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" /> {uploading ? "Enviando..." : "Upload"}
              </Button>
            </div>
            {coverUrl && (
              <img src={coverUrl} alt="" className="mt-2 w-32 aspect-video object-cover rounded border border-admin-border" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Posição</Label>
              <Input type="number" min={0} value={position} onChange={(e) => setPosition(Number(e.target.value))} />
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={isPublished} onCheckedChange={setIsPublished} />
              <Label>Publicado</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() =>
                onSubmit({
                  id: editing?.id,
                  title: title.trim(),
                  description: description.trim() || undefined,
                  cover_url: coverUrl.trim() || undefined,
                  position,
                  is_published: isPublished,
                })
              }
            >
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================
// AULAS
// =========================================================

export function LessonsManager({
  modules,
  lessons,
  files,
}: {
  modules: Module[];
  lessons: Lesson[];
  files: LessonFile[];
}) {
  const upsert = useServerFn(upsertLesson);
  const togglePub = useServerFn(toggleLessonPublish);
  const reorder = useServerFn(reorderLessons);
  const del = useServerFn(deleteLesson);
  const refresh = useRefresh();
  const [editing, setEditing] = useState<Lesson | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Lesson | null>(null);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return lessons.filter((l) => {
      if (moduleFilter !== "all" && l.module_id !== moduleFilter) return false;
      if (statusFilter === "published" && !l.is_published) return false;
      if (statusFilter === "draft" && l.is_published) return false;
      if (q && !l.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lessons, moduleFilter, statusFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const m of modules) map.set(m.id, []);
    for (const l of filtered) {
      const arr = map.get(l.module_id);
      if (arr) arr.push(l);
    }
    return modules
      .sort((a, b) => a.position - b.position)
      .map((m) => ({ module: m, items: (map.get(m.id) ?? []).sort((a, b) => a.position - b.position) }))
      .filter((g) => g.items.length > 0 || moduleFilter === g.module.id);
  }, [modules, filtered, moduleFilter]);

  const move = async (modId: string, items: Lesson[], idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= items.length) return;
    const a = items[idx];
    const b = items[next];
    await reorder({
      data: {
        module_id: modId,
        items: [{ id: a.id, position: b.position }, { id: b.id, position: a.position }],
      },
    });
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-admin-ink">Aulas</h3>
          <p className="text-xs text-admin-ink-muted">Conteúdo organizado por módulo.</p>
        </div>
        <Button
          size="sm"
          disabled={modules.length === 0}
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" /> Nova aula
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-admin-ink-muted" />
          <Input
            placeholder="Buscar por título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os módulos</SelectItem>
            {modules.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="published">Publicadas</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {modules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-admin-border p-8 text-center text-sm text-admin-ink-muted">
          Crie ao menos um módulo antes de adicionar aulas.
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-admin-border p-8 text-center text-sm text-admin-ink-muted">
          Nenhuma aula com esses filtros.
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(({ module: m, items }) => (
            <div key={m.id}>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-display text-sm uppercase tracking-wider text-admin-ink-soft">
                  {m.title} <span className="text-admin-ink-muted normal-case tracking-normal">— {items.length} aula{items.length === 1 ? "" : "s"}</span>
                </h4>
              </div>
              <div className="space-y-2">
                {items.map((l, idx) => {
                  const lessonFiles = files.filter((f) => f.lesson_id === l.id);
                  return (
                    <div key={l.id} className="flex items-center gap-3 rounded-lg border border-admin-border bg-admin-bg p-2">
                      <div className="w-24 aspect-video bg-admin-surface-2 rounded overflow-hidden shrink-0">
                        {l.thumbnail_url ? (
                          <img src={l.thumbnail_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-admin-ink-muted">
                            <ImageOff className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-display font-medium text-admin-ink truncate">{l.title}</p>
                          <span
                            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                              l.is_published ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {l.is_published ? "Publicada" : "Rascunho"}
                          </span>
                        </div>
                        <p className="text-[11px] text-admin-ink-muted">
                          {lessonFiles.length} material{lessonFiles.length === 1 ? "" : "is"}
                          {l.duration_minutes ? ` · ${l.duration_minutes} min` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={l.is_published}
                          onCheckedChange={async (v) => {
                            await togglePub({ data: { id: l.id, is_published: v } });
                            refresh();
                          }}
                        />
                        <Button size="sm" variant="ghost" onClick={() => move(m.id, items, idx, -1)} disabled={idx === 0}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => move(m.id, items, idx, 1)} disabled={idx === items.length - 1}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        {l.video_url && (
                          <Button size="sm" variant="ghost" onClick={() => setPreview(l)}>
                            <PlayCircle className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(l);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (!confirm(`Apagar "${l.title}"?`)) return;
                            await del({ data: { id: l.id } });
                            toast.success("Aula removida");
                            refresh();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <LessonDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        modules={modules}
        files={files}
      />

      <VideoPlayerModal
        video={
          preview
            ? { id: preview.id, title: preview.title, description: preview.description, video_url: preview.video_url }
            : null
        }
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
      />
    </div>
  );
}

function LessonDialog({
  open,
  onOpenChange,
  editing,
  modules,
  files,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Lesson | null;
  modules: Module[];
  files: LessonFile[];
}) {
  const upsert = useServerFn(upsertLesson);
  const createUrl = useServerFn(createUploadUrl);
  const addFile = useServerFn(addLessonFile);
  const removeFile = useServerFn(removeLessonFile);
  const refresh = useRefresh();

  const [moduleId, setModuleId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [thumbUrl, setThumbUrl] = useState("");
  const [duration, setDuration] = useState<number | "">("");
  const [position, setPosition] = useState(0);
  const [isPublished, setIsPublished] = useState(false);
  const [uploading, setUploading] = useState(false);
  const thumbRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useMemo(() => {
    if (open) {
      setModuleId(editing?.module_id ?? modules[0]?.id ?? "");
      setTitle(editing?.title ?? "");
      setDescription(editing?.description ?? "");
      setVideoUrl(editing?.video_url ?? "");
      setThumbUrl(editing?.thumbnail_url ?? "");
      setDuration(editing?.duration_minutes ?? "");
      setPosition(editing?.position ?? 0);
      setIsPublished(editing?.is_published ?? false);
    }
  }, [open, editing, modules]);

  const lessonFiles = editing ? files.filter((f) => f.lesson_id === editing.id) : [];

  const handleThumb = async (file: File) => {
    setUploading(true);
    try {
      const sig = await uploadFile(createUrl, file, "lesson-thumb");
      setThumbUrl(sig.canonical);
      toast.success("Thumb enviado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!editing) {
      toast.error("Salve a aula antes de adicionar materiais");
      return;
    }
    setUploading(true);
    try {
      const sig = await uploadFile(createUrl, file, "lesson-file");
      const ext = sig.ext;
      const type = ext === "pdf" ? "pdf" : ["jpg", "jpeg", "png", "webp", "gif"].includes(ext) ? "image" : ["doc", "docx"].includes(ext) ? "doc" : "other";
      await addFile({
        data: {
          lesson_id: editing.id,
          label: file.name,
          file_url: sig.canonical,
          file_type: type as "pdf" | "image" | "doc" | "other",
          size_bytes: file.size,
          position: lessonFiles.length,
        },
      });
      toast.success("Material adicionado");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!moduleId || !title.trim()) {
      toast.error("Selecione módulo e título");
      return;
    }
    await upsert({
      data: {
        id: editing?.id,
        module_id: moduleId,
        title: title.trim(),
        description: description.trim() || undefined,
        video_url: videoUrl.trim() || undefined,
        video_source_url: videoUrl.trim() || undefined,
        thumbnail_url: thumbUrl.trim() || undefined,
        duration_minutes: duration === "" ? undefined : Number(duration),
        position,
        is_published: isPublished,
        is_featured: false,
      },
    });
    toast.success(editing ? "Aula atualizada" : "Aula criada");
    refresh();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar aula" : "Nova aula"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label>Módulo</Label>
              <Select value={moduleId} onValueChange={setModuleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {modules.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Título</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <VideoSourceField value={videoUrl} onChange={setVideoUrl} />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Duração (min)</Label>
                <Input
                  type="number"
                  min={0}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div>
                <Label>Posição</Label>
                <Input type="number" min={0} value={position} onChange={(e) => setPosition(Number(e.target.value))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isPublished} onCheckedChange={setIsPublished} />
              <Label>Publicada</Label>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label>Capa da aula</Label>
              <div className="flex gap-2">
                <Input value={thumbUrl} onChange={(e) => setThumbUrl(e.target.value)} placeholder="https://..." />
                <input
                  ref={thumbRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleThumb(f);
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => thumbRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" />
                </Button>
              </div>
              {thumbUrl && (
                <img src={thumbUrl} alt="" className="mt-2 w-full aspect-video object-cover rounded border border-admin-border" />
              )}
            </div>

            <div>
              <Label>Materiais</Label>
              {!editing ? (
                <p className="text-xs text-admin-ink-muted mt-1">Salve a aula primeiro para anexar materiais.</p>
              ) : (
                <div className="space-y-2 mt-1">
                  {lessonFiles.length === 0 && (
                    <p className="text-xs text-admin-ink-muted">Nenhum material ainda.</p>
                  )}
                  {lessonFiles.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 rounded border border-admin-border bg-admin-bg p-2 text-xs">
                      {f.file_type === "pdf" || f.file_type === "doc" ? (
                        <FileText className="h-4 w-4 text-admin-ink-muted shrink-0" />
                      ) : (
                        <LinkIcon className="h-4 w-4 text-admin-ink-muted shrink-0" />
                      )}
                      <span className="flex-1 truncate">{f.label}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await removeFile({ data: { id: f.id } });
                          refresh();
                        }}
                        className="text-red-600 hover:text-red-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1" /> {uploading ? "Enviando..." : "Adicionar material"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-admin-border">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave}>Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================
// CONFIGURAÇÕES DO CLUBE
// =========================================================

export function ClubSettingsManager({ settings }: { settings: Settings }) {
  const update = useServerFn(updateClubSettings);
  const createUrl = useServerFn(createUploadUrl);
  const refresh = useRefresh();

  const [publicTitle, setPublicTitle] = useState(settings?.public_title ?? "Clube do Imigrante");
  const [publicDescription, setPublicDescription] = useState(settings?.public_description ?? "");
  const [coverUrl, setCoverUrl] = useState(settings?.cover_url ?? "");
  const [lockedText, setLockedText] = useState(settings?.locked_screen_text ?? "");
  const [ctaText, setCtaText] = useState(settings?.cta_text ?? "Assinar Clube");
  const [benefits, setBenefits] = useState<string[]>(
    Array.isArray(settings?.benefits) ? (settings?.benefits as string[]) : [],
  );
  const [newBenefit, setNewBenefit] = useState("");
  const [uploading, setUploading] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);

  const handleCover = async (file: File) => {
    setUploading(true);
    try {
      const sig = await uploadFile(createUrl, file, "club-cover");
      setCoverUrl(sig.canonical);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    await update({
      data: {
        public_title: publicTitle,
        public_description: publicDescription,
        cover_url: coverUrl || undefined,
        locked_screen_text: lockedText,
        cta_text: ctaText,
        benefits,
      },
    });
    toast.success("Configurações salvas");
    refresh();
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h3 className="font-display text-lg font-semibold text-admin-ink">Configurações do Clube</h3>
        <p className="text-xs text-admin-ink-muted">Textos públicos e visual da página do membro.</p>
      </div>

      <div className="space-y-3 rounded-xl border border-admin-border bg-admin-bg p-4">
        <div>
          <Label>Título público</Label>
          <Input value={publicTitle} onChange={(e) => setPublicTitle(e.target.value)} />
        </div>
        <div>
          <Label>Descrição pública</Label>
          <Textarea rows={3} value={publicDescription} onChange={(e) => setPublicDescription(e.target.value)} />
        </div>
        <div>
          <Label>Capa do Clube</Label>
          <div className="flex gap-2">
            <Input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://..." />
            <input
              ref={coverRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCover(f);
              }}
            />
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => coverRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" />
            </Button>
          </div>
          {coverUrl && <img src={coverUrl} alt="" className="mt-2 w-full max-w-md aspect-[3/1] object-cover rounded border border-admin-border" />}
        </div>
        <div>
          <Label>Texto da tela bloqueada (não-membro)</Label>
          <Textarea rows={3} value={lockedText} onChange={(e) => setLockedText(e.target.value)} />
        </div>
        <div>
          <Label>Texto do botão (CTA)</Label>
          <Input value={ctaText} onChange={(e) => setCtaText(e.target.value)} />
        </div>
        <div>
          <Label>Benefícios (mostrados na tela bloqueada)</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={newBenefit}
              onChange={(e) => setNewBenefit(e.target.value)}
              placeholder="Ex: Aulas semanais ao vivo"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newBenefit.trim()) {
                  setBenefits([...benefits, newBenefit.trim()]);
                  setNewBenefit("");
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (!newBenefit.trim()) return;
                setBenefits([...benefits, newBenefit.trim()]);
                setNewBenefit("");
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="mt-2 space-y-1">
            {benefits.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="flex-1">• {b}</span>
                <button onClick={() => setBenefits(benefits.filter((_, idx) => idx !== i))} className="text-red-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end pt-2 border-t border-admin-border">
          <Button onClick={handleSave}>Salvar configurações</Button>
        </div>
      </div>
    </div>
  );
}
