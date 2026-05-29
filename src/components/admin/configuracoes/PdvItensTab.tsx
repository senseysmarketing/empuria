import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listPdvItems, createPdvItem, updatePdvItem, deletePdvItem } from "@/lib/admin/pdv-itens.functions";

type Item = Awaited<ReturnType<typeof listPdvItems>>[number];

const CATEGORIES = ["bebida", "comida", "barbearia", "outro"] as const;
type Category = (typeof CATEGORIES)[number];

const emptyForm = {
  name: "",
  slug: "",
  price_cents: 0,
  category: "bebida" as Category,
  emoji: "",
  is_active: true,
  position: 0,
};

export function PdvItensTab() {
  const fetchList = useServerFn(listPdvItems);
  const create = useServerFn(createPdvItem);
  const update = useServerFn(updatePdvItem);
  const remove = useServerFn(deletePdvItem);
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["pdv-itens"],
    queryFn: () => fetchList(),
  });

  const [editing, setEditing] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm, position: items.length }); setOpen(true); };
  const openEdit = (item: Item) => {
    setEditing(item);
    setForm({
      name: item.name,
      slug: item.slug,
      price_cents: item.price_cents,
      category: item.category as Category,
      emoji: item.emoji ?? "",
      is_active: item.is_active,
      position: item.position,
    });
    setOpen(true);
  };

  const toggleActive = async (item: Item, v: boolean) => {
    try {
      await update({ data: { id: item.id, is_active: v } });
      qc.invalidateQueries({ queryKey: ["pdv-itens"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase(),
        price_cents: Math.round(form.price_cents),
        category: form.category,
        emoji: form.emoji.trim() || null,
        is_active: form.is_active,
        position: form.position,
      };
      if (editing) await update({ data: { id: editing.id, ...payload } });
      else await create({ data: payload });
      toast.success(editing ? "Item atualizado" : "Item criado");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["pdv-itens"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSaving(false); }
  };

  const del = async (item: Item) => {
    if (!confirm(`Remover "${item.name}"?`)) return;
    try {
      await remove({ data: { id: item.id } });
      toast.success("Item removido");
      qc.invalidateQueries({ queryKey: ["pdv-itens"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  };

  return (
    <BentoCard padded={false}>
      <div className="p-5 border-b border-admin-border flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg text-admin-ink">Itens do PDV</h3>
          <p className="text-xs text-admin-ink-muted mt-1">{items.length} itens cadastrados</p>
        </div>
        <Button onClick={openCreate} className="bg-admin-accent text-white"><Plus className="h-4 w-4" /> Novo item</Button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-admin-ink-muted text-sm">Carregando…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-admin-bg text-[10px] uppercase tracking-wider text-admin-ink-muted">
              <tr>
                <th className="text-left p-3 font-display">#</th>
                <th className="text-left p-3 font-display">Item</th>
                <th className="text-left p-3 font-display">Categoria</th>
                <th className="text-right p-3 font-display">Preço</th>
                <th className="text-center p-3 font-display">Ativo</th>
                <th className="text-right p-3 font-display">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-admin-border hover:bg-admin-bg/50">
                  <td className="p-3 text-admin-ink-muted tabular-nums">{it.position}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {it.emoji && <span className="text-lg">{it.emoji}</span>}
                      <div>
                        <div className="font-medium text-admin-ink">{it.name}</div>
                        <div className="text-[11px] text-admin-ink-muted">{it.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-admin-ink-muted capitalize">{it.category}</td>
                  <td className="p-3 text-right tabular-nums">€ {(it.price_cents / 100).toFixed(2)}</td>
                  <td className="p-3 text-center">
                    <Switch checked={it.is_active} onCheckedChange={(v) => toggleActive(it, v)} />
                  </td>
                  <td className="p-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(it)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => del(it)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-admin-ink-muted text-sm">Nenhum item ainda</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="bg-admin-surface border-admin-border text-admin-ink overflow-y-auto">
          <SheetHeader><SheetTitle className="font-display">{editing ? "Editar item" : "Novo item"}</SheetTitle></SheetHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-[60px_1fr] gap-3">
              <div className="space-y-1.5">
                <Label>Emoji</Label>
                <Input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} className="bg-admin-bg border-admin-border text-center" maxLength={4} />
              </div>
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-admin-bg border-admin-border" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Slug (identificador)</Label>
              <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="bg-admin-bg border-admin-border" placeholder="ex: vinho-tinto" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Preço (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={(form.price_cents / 100).toFixed(2)}
                  onChange={(e) => setForm({ ...form, price_cents: Math.round(parseFloat(e.target.value || "0") * 100) })}
                  className="bg-admin-bg border-admin-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as Category })}>
                  <SelectTrigger className="bg-admin-bg border-admin-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ordem</Label>
                <Input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: parseInt(e.target.value || "0", 10) })} className="bg-admin-bg border-admin-border" />
              </div>
              <div className="flex items-end justify-between rounded-lg border border-admin-border p-3">
                <Label>Ativo</Label>
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              </div>
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving || !form.name.trim() || !form.slug.trim()} className="bg-admin-accent text-white">Salvar</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </BentoCard>
  );
}
