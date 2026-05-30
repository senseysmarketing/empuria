import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Tags, Boxes } from "lucide-react";
import { toast } from "sonner";
import { listPdvItems, createPdvItem, updatePdvItem, deletePdvItem } from "@/lib/admin/pdv-itens.functions";
import { listCategories } from "@/lib/admin/categories.functions";
import { CategoriesManagerModal } from "./CategoriesManagerModal";
import { StockMovementsDialog } from "./StockMovementsDialog";

type Item = Awaited<ReturnType<typeof listPdvItems>>[number];

const emptyForm = {
  name: "",
  slug: "",
  price_cents: 0,
  price_eur_cents: 0,
  price_brl_cents: 0,
  category_id: "",
  emoji: "",
  is_active: true,
  position: 0,
  item_type: "produto" as "produto" | "servico",
  track_stock: false,
  stock_min_quantity: 0,
};

export function PdvItensTab() {
  const fetchList = useServerFn(listPdvItems);
  const fetchCategories = useServerFn(listCategories);
  const create = useServerFn(createPdvItem);
  const update = useServerFn(updatePdvItem);
  const remove = useServerFn(deletePdvItem);
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["pdv-itens"],
    queryFn: () => fetchList(),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["pdv-categories"],
    queryFn: () => fetchCategories(),
  });

  const [editing, setEditing] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<{ id: string; name: string; stock_quantity: number } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, position: items.length, category_id: categories[0]?.id ?? "" });
    setOpen(true);
  };
  const openEdit = (item: Item) => {
    const it = item as Item & { item_type?: string; price_eur_cents?: number; price_brl_cents?: number; track_stock?: boolean; stock_min_quantity?: number };
    setEditing(item);
    setForm({
      name: item.name,
      slug: item.slug,
      price_cents: it.price_eur_cents ?? item.price_cents,
      price_eur_cents: it.price_eur_cents ?? item.price_cents,
      price_brl_cents: it.price_brl_cents ?? 0,
      category_id: item.category_id ?? "",
      emoji: item.emoji ?? "",
      is_active: item.is_active,
      position: item.position,
      item_type: (it.item_type === "servico" ? "servico" : "produto"),
      track_stock: !!it.track_stock,
      stock_min_quantity: it.stock_min_quantity ?? 0,
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
    if (!form.category_id) { toast.error("Selecione uma categoria"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase(),
        price_cents: Math.round(form.price_eur_cents),
        price_eur_cents: Math.round(form.price_eur_cents),
        price_brl_cents: Math.round(form.price_brl_cents),
        category_id: form.category_id,
        emoji: form.emoji.trim() || null,
        is_active: form.is_active,
        position: form.position,
        item_type: form.item_type,
        track_stock: form.item_type === "produto" ? form.track_stock : false,
        stock_min_quantity: form.stock_min_quantity,
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
      <div className="p-5 border-b border-admin-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg text-admin-ink">Itens do PDV</h3>
          <p className="text-xs text-admin-ink-muted mt-1">{items.length} itens cadastrados</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCategoriesOpen(true)} className="border-admin-border">
            <Tags className="h-4 w-4" /> Gerenciar Categorias
          </Button>
          <Button onClick={openCreate} className="bg-admin-accent text-white">
            <Plus className="h-4 w-4" /> Novo item
          </Button>
        </div>
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
                <th className="text-left p-3 font-display">Tipo</th>
                <th className="text-left p-3 font-display">Categoria</th>
                <th className="text-right p-3 font-display">€ / R$</th>
                <th className="text-right p-3 font-display">Estoque</th>
                <th className="text-center p-3 font-display">Ativo</th>
                <th className="text-right p-3 font-display">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((raw) => {
                const it = raw as Item & { item_type?: string; price_eur_cents?: number; price_brl_cents?: number; track_stock?: boolean; stock_quantity?: number; stock_min_quantity?: number };
                const cat = (raw as Item & { product_categories?: { name: string; emoji: string | null } | null }).product_categories;
                const eur = it.price_eur_cents ?? it.price_cents;
                const brl = it.price_brl_cents ?? 0;
                const isService = it.item_type === "servico";
                const tracks = !!it.track_stock;
                const stock = it.stock_quantity ?? 0;
                const min = it.stock_min_quantity ?? 0;
                const low = tracks && stock <= min;
                return (
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
                    <td className="p-3">
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${isService ? "bg-blue-500/10 text-blue-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                        {isService ? "Serviço" : "Produto"}
                      </span>
                    </td>
                    <td className="p-3 text-admin-ink-muted">
                      {cat ? `${cat.emoji ?? ""} ${cat.name}`.trim() : <span className="italic opacity-60">—</span>}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      <div>€ {(eur / 100).toFixed(2)}</div>
                      <div className="text-[11px] text-admin-ink-muted">R$ {(brl / 100).toFixed(2)}</div>
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {isService || !tracks ? (
                        <span className="text-admin-ink-muted italic">—</span>
                      ) : (
                        <span className={low ? "text-red-500 font-medium" : ""}>{stock}{low && " ⚠"}</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <Switch checked={it.is_active} onCheckedChange={(v) => toggleActive(it, v)} />
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex gap-1">
                        {tracks && !isService && (
                          <Button variant="ghost" size="sm" title="Movimentações" onClick={() => setStockProduct({ id: it.id, name: it.name, stock_quantity: stock })}>
                            <Boxes className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => openEdit(it)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => del(it)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-admin-ink-muted text-sm">Nenhum item ainda</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-admin-surface border-admin-border text-admin-ink">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">{editing ? "Editar item" : "Novo item"}</DialogTitle>
            <DialogDescription>Preencha os dados do item do PDV.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
                <Label>Tipo</Label>
                <Select value={form.item_type} onValueChange={(v) => setForm({ ...form, item_type: v as "produto" | "servico" })}>
                  <SelectTrigger className="bg-admin-bg border-admin-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="produto">Produto</SelectItem>
                    <SelectItem value="servico">Serviço</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                  <SelectTrigger className="bg-admin-bg border-admin-border"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {categories.filter((c) => c.is_active || c.id === form.category_id).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ""}{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Preço em € (Euro)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={(form.price_eur_cents / 100).toFixed(2)}
                  onChange={(e) => setForm({ ...form, price_eur_cents: Math.round(parseFloat(e.target.value || "0") * 100) })}
                  className="bg-admin-bg border-admin-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Preço em R$ (Real)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={(form.price_brl_cents / 100).toFixed(2)}
                  onChange={(e) => setForm({ ...form, price_brl_cents: Math.round(parseFloat(e.target.value || "0") * 100) })}
                  className="bg-admin-bg border-admin-border"
                />
              </div>
            </div>

            {form.item_type === "produto" && (
              <div className="rounded-lg border border-admin-border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Controlar estoque</Label>
                    <p className="text-[11px] text-admin-ink-muted mt-0.5">Quando ativo, vendas dão baixa automática.</p>
                  </div>
                  <Switch checked={form.track_stock} onCheckedChange={(v) => setForm({ ...form, track_stock: v })} />
                </div>
                {form.track_stock && (
                  <div className="space-y-1.5">
                    <Label>Estoque mínimo (alerta)</Label>
                    <Input type="number" min={0} value={form.stock_min_quantity} onChange={(e) => setForm({ ...form, stock_min_quantity: parseInt(e.target.value || "0", 10) })} className="bg-admin-bg border-admin-border" />
                  </div>
                )}
              </div>
            )}

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
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving || !form.name.trim() || !form.slug.trim() || !form.category_id} className="bg-admin-accent text-white">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CategoriesManagerModal open={categoriesOpen} onOpenChange={setCategoriesOpen} />
      <StockMovementsDialog
        open={!!stockProduct}
        onOpenChange={(v) => { if (!v) setStockProduct(null); }}
        product={stockProduct}
      />
    </BentoCard>
  );
}
