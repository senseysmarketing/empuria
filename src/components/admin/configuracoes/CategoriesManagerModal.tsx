import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import { listCategories, createCategory, updateCategory, deleteCategory } from "@/lib/admin/categories.functions";
import { EmojiPickerField } from "@/components/admin/EmojiPickerField";

type Category = Awaited<ReturnType<typeof listCategories>>[number];

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const emptyForm = { name: "", emoji: "", position: 0, is_active: true };

export function CategoriesManagerModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const fetchList = useServerFn(listCategories);
  const create = useServerFn(createCategory);
  const update = useServerFn(updateCategory);
  const remove = useServerFn(deleteCategory);
  const qc = useQueryClient();

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["pdv-categories"],
    queryFn: () => fetchList(),
    enabled: open,
  });

  const [newForm, setNewForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);
  const [saving, setSaving] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pdv-categories"] });
    qc.invalidateQueries({ queryKey: ["pdv-itens"] });
  };

  const handleCreate = async () => {
    const name = newForm.name.trim();
    if (!name) return;
    const slug = slugify(name);
    if (categories.some((c) => c.slug === slug)) {
      toast.error("Já existe uma categoria com este nome.");
      return;
    }
    setSaving(true);
    try {
      await create({
        data: {
          name,
          slug,
          emoji: newForm.emoji.trim() || null,
          position: newForm.position,
          is_active: newForm.is_active,
        },
      });
      toast.success("Categoria criada");
      setNewForm({ ...emptyForm, position: categories.length + 1 });
      invalidate();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSaving(false); }
  };

  const startEdit = (c: Category) => {
    setEditingId(c.id);
    setEditForm({ name: c.name, emoji: c.emoji ?? "", position: c.position, is_active: c.is_active });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const name = editForm.name.trim();
    if (!name) return;
    const slug = slugify(name);
    if (categories.some((c) => c.slug === slug && c.id !== editingId)) {
      toast.error("Já existe uma categoria com este nome.");
      return;
    }
    setSaving(true);
    try {
      await update({
        data: {
          id: editingId,
          name,
          slug,
          emoji: editForm.emoji.trim() || null,
          position: editForm.position,
          is_active: editForm.is_active,
        },
      });
      toast.success("Categoria atualizada");
      setEditingId(null);
      invalidate();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSaving(false); }
  };

  const toggleActive = async (c: Category, v: boolean) => {
    try {
      await update({ data: { id: c.id, is_active: v } });
      invalidate();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await remove({ data: { id: confirmDelete.id } });
      toast.success("Categoria removida");
      setConfirmDelete(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-admin-surface border-admin-border text-admin-ink">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Gerenciar Categorias</DialogTitle>
            <DialogDescription>Crie, edite ou exclua categorias de itens do PDV.</DialogDescription>
          </DialogHeader>

          {/* Create */}
          <div className="rounded-xl border border-admin-border bg-admin-bg/50 p-4 space-y-3">
            <h4 className="text-sm font-display text-admin-ink-muted">Nova categoria</h4>
            <div className="grid grid-cols-[60px_1fr_80px_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Emoji</Label>
                <Input value={newForm.emoji} onChange={(e) => setNewForm({ ...newForm, emoji: e.target.value })} className="bg-admin-surface border-admin-border text-center" maxLength={4} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nome</Label>
                <Input value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} className="bg-admin-surface border-admin-border" placeholder="Ex: Sobremesas" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ordem</Label>
                <Input type="number" value={newForm.position} onChange={(e) => setNewForm({ ...newForm, position: parseInt(e.target.value || "0", 10) })} className="bg-admin-surface border-admin-border" />
              </div>
              <Button onClick={handleCreate} disabled={saving || !newForm.name.trim()} className="bg-admin-accent text-white">
                <Plus className="h-4 w-4" /> Criar
              </Button>
            </div>
          </div>

          {/* List */}
          <div className="space-y-2">
            {isLoading ? (
              <p className="text-sm text-admin-ink-muted text-center py-6">Carregando…</p>
            ) : categories.length === 0 ? (
              <p className="text-sm text-admin-ink-muted text-center py-6">Nenhuma categoria.</p>
            ) : (
              categories.map((c) =>
                editingId === c.id ? (
                  <div key={c.id} className="grid grid-cols-[60px_1fr_80px_auto] gap-2 items-end p-3 rounded-lg border border-admin-accent bg-admin-bg/50">
                    <Input value={editForm.emoji} onChange={(e) => setEditForm({ ...editForm, emoji: e.target.value })} className="bg-admin-surface border-admin-border text-center" maxLength={4} />
                    <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="bg-admin-surface border-admin-border" />
                    <Input type="number" value={editForm.position} onChange={(e) => setEditForm({ ...editForm, position: parseInt(e.target.value || "0", 10) })} className="bg-admin-surface border-admin-border" />
                    <div className="flex gap-1">
                      <Button size="sm" onClick={saveEdit} disabled={saving} className="bg-admin-accent text-white"><Check className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}><X className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ) : (
                  <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border border-admin-border hover:bg-admin-bg/30">
                    <span className="text-xl w-8 text-center">{c.emoji ?? "—"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-admin-ink truncate">{c.name}</div>
                      <div className="text-[11px] text-admin-ink-muted">{c.slug}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{c.item_count} {c.item_count === 1 ? "item" : "itens"}</Badge>
                    <span className="text-[10px] text-admin-ink-muted tabular-nums w-6 text-right">#{c.position}</span>
                    <Switch checked={c.is_active} onCheckedChange={(v) => toggleActive(c, v)} />
                    <Button variant="ghost" size="sm" onClick={() => startEdit(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(c)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                  </div>
                ),
              )
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir categoria?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.item_count
                ? `Esta categoria possui ${confirmDelete.item_count} item(ns). Você precisa mover ou apagar os itens antes de excluí-la.`
                : `A categoria "${confirmDelete?.name}" será removida permanentemente. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={!!confirmDelete?.item_count}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
