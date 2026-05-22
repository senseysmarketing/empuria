import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listEventsAdmin, upsertEvent, deleteEvent } from "@/lib/admin/events.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TicketScannerDialog } from "@/components/admin/TicketScannerDialog";
import { Plus, Trash2, Pencil, ExternalLink, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/eventos")({
  component: EventsPage,
});

type Tier = {
  id?: string;
  name: string;
  price_cents: number;
  capacity: number | null;
  benefits: string[];
  position: number;
  is_active: boolean;
};

type FormState = {
  id?: string;
  slug: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  location_address: string;
  cover_url: string;
  sales_mode: "simples" | "categorias";
  is_published: boolean;
  tiers: Tier[];
};

const emptyForm = (): FormState => ({
  slug: "",
  title: "",
  description: "",
  starts_at: "",
  ends_at: "",
  location_address: "",
  cover_url: "",
  sales_mode: "simples",
  is_published: false,
  tiers: [{ name: "Padrão", price_cents: 0, capacity: null, benefits: [], position: 0, is_active: true }],
});

function EventsPage() {
  const fetchList = useServerFn(listEventsAdmin);
  const save = useServerFn(upsertEvent);
  const del = useServerFn(deleteEvent);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const { data } = useQuery({ queryKey: ["admin-events"], queryFn: () => fetchList() });

  const openNew = () => { setForm(emptyForm()); setOpen(true); };
  const openEdit = (eventId: string) => {
    const ev = data?.events.find((e) => e.id === eventId);
    const tiers = (data?.tiers ?? []).filter((t) => t.event_id === eventId).sort((a, b) => a.position - b.position);
    if (!ev) return;
    setForm({
      id: ev.id, slug: ev.slug, title: ev.title,
      description: ev.description ?? "",
      starts_at: ev.starts_at.slice(0, 16),
      ends_at: ev.ends_at ? ev.ends_at.slice(0, 16) : "",
      location_address: ev.location_address ?? "",
      cover_url: ev.cover_url ?? "",
      sales_mode: ev.sales_mode as "simples" | "categorias",
      is_published: ev.is_published,
      tiers: tiers.map((t) => ({
        id: t.id, name: t.name, price_cents: t.price_cents,
        capacity: t.capacity, benefits: (t.benefits as string[]) ?? [],
        position: t.position, is_active: t.is_active,
      })),
    });
    setOpen(true);
  };

  const submit = async () => {
    try {
      await save({
        data: {
          ...form,
          starts_at: new Date(form.starts_at).toISOString(),
          ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        },
      });
      toast.success("Evento salvo");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Excluir evento e todos os ingressos?")) return;
    try {
      await del({ data: { id } });
      toast.success("Excluído");
      qc.invalidateQueries({ queryKey: ["admin-events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const updateTier = (i: number, patch: Partial<Tier>) => {
    setForm({ ...form, tiers: form.tiers.map((t, idx) => idx === i ? { ...t, ...patch } : t) });
  };
  const addTier = () => setForm({ ...form, tiers: [...form.tiers, { name: "", price_cents: 0, capacity: null, benefits: [], position: form.tiers.length, is_active: true }] });
  const removeTier = (i: number) => setForm({ ...form, tiers: form.tiers.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-admin-ink">Eventos</h1>
          <p className="text-sm text-admin-ink-muted">Gestão de eventos, vendas e check-in</p>
        </div>
        <div className="flex gap-2">
          <TicketScannerDialog events={(data?.events ?? []).filter((e) => e.is_published)} />
          <Button onClick={openNew} className="bg-admin-accent text-white">
            <Plus className="h-4 w-4 mr-1" /> Novo evento
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-4">
        {(data?.events ?? []).map((ev) => {
          const tiers = (data?.tiers ?? []).filter((t) => t.event_id === ev.id);
          const sold = tiers.reduce((acc, t) => acc + t.sold, 0);
          const cap = tiers.reduce((acc, t) => acc + (t.capacity ?? 0), 0);
          const revenue = tiers.reduce((acc, t) => acc + t.sold * t.price_cents, 0);
          return (
            <BentoCard key={ev.id} className="col-span-12 md:col-span-6 lg:col-span-4" padded>
              {ev.cover_url && (
                <img src={ev.cover_url} alt={ev.title} className="w-full h-32 object-cover rounded-lg mb-3" />
              )}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-display text-base text-admin-ink truncate">{ev.title}</h3>
                  <p className="text-xs text-admin-ink-muted">
                    {new Date(ev.starts_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <span className={`text-[10px] uppercase px-2 py-0.5 rounded font-display ${ev.is_published ? "bg-green-600/20 text-green-700" : "bg-muted text-admin-ink-muted"}`}>
                  {ev.is_published ? "Publicado" : "Rascunho"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><div className="text-admin-ink-muted">Vendidos</div><div className="font-display text-admin-ink">{sold}{cap ? `/${cap}` : ""}</div></div>
                <div><div className="text-admin-ink-muted">Categorias</div><div className="font-display text-admin-ink">{tiers.length}</div></div>
                <div><div className="text-admin-ink-muted">Receita</div><div className="font-display text-admin-ink">€{(revenue / 100).toFixed(0)}</div></div>
              </div>
              <div className="mt-3 flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => openEdit(ev.id)}><Pencil className="h-3 w-3" /></Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/evento/${ev.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /></a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => onDelete(ev.id)} className="text-red-brand">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </BentoCard>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-admin-surface text-admin-ink border-admin-border max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{form.id ? "Editar" : "Novo"} evento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Título</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, slug: form.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })} /></div>
              <div><Label>Slug</Label><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></div>
            </div>
            <div><Label>Descrição</Label><Textarea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Início</Label><Input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></div>
              <div><Label>Fim (opcional)</Label><Input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></div>
            </div>
            <div><Label>Endereço</Label><Input value={form.location_address} onChange={(e) => setForm({ ...form, location_address: e.target.value })} placeholder="Gran Vía 32, Madrid" /></div>
            <div><Label>URL da capa (imagem)</Label><Input value={form.cover_url} onChange={(e) => setForm({ ...form, cover_url: e.target.value })} placeholder="https://..." /></div>
            <div className="flex gap-4 items-center">
              <div className="flex items-center gap-2"><Switch checked={form.sales_mode === "categorias"} onCheckedChange={(v) => setForm({ ...form, sales_mode: v ? "categorias" : "simples" })} /><Label>Múltiplas categorias</Label></div>
              <div className="flex items-center gap-2"><Switch checked={form.is_published} onCheckedChange={(v) => setForm({ ...form, is_published: v })} /><Label>Publicado</Label></div>
            </div>

            <div className="border-t border-admin-border pt-3">
              <div className="flex justify-between items-center mb-2">
                <Label className="font-display uppercase tracking-wider text-xs">Categorias de ingresso</Label>
                {form.sales_mode === "categorias" && (
                  <Button size="sm" variant="outline" onClick={addTier}><Plus className="h-3 w-3 mr-1" /> Categoria</Button>
                )}
              </div>
              <div className="space-y-2">
                {form.tiers.map((t, i) => (
                  <div key={i} className="border border-admin-border rounded-lg p-3 space-y-2 bg-admin-surface-2">
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-4"><Label className="text-[10px]">Nome</Label><Input value={t.name} onChange={(e) => updateTier(i, { name: e.target.value })} /></div>
                      <div className="col-span-3"><Label className="text-[10px]">Preço (€)</Label><Input type="number" step="0.01" value={(t.price_cents / 100).toString()} onChange={(e) => updateTier(i, { price_cents: Math.round(parseFloat(e.target.value || "0") * 100) })} /></div>
                      <div className="col-span-3"><Label className="text-[10px]">Capacidade</Label><Input type="number" value={t.capacity ?? ""} onChange={(e) => updateTier(i, { capacity: e.target.value ? parseInt(e.target.value) : null })} placeholder="∞" /></div>
                      <div className="col-span-2 flex items-end">
                        {form.tiers.length > 1 && (
                          <Button size="sm" variant="ghost" onClick={() => removeTier(i)} className="text-red-brand"><X className="h-3 w-3" /></Button>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label className="text-[10px]">Benefícios (separados por vírgula)</Label>
                      <Input value={t.benefits.join(", ")} onChange={(e) => updateTier(i, { benefits: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <Button onClick={submit} className="w-full bg-admin-accent text-white">Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
