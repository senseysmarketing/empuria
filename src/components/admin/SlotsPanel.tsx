import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listSlots,
  listServicesAdmin,
  createSlot,
  toggleSlot,
  deleteSlot,
} from "@/lib/admin/slots.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Power } from "lucide-react";
import { toast } from "sonner";

export function SlotsPanel() {
  const fetchSlots = useServerFn(listSlots);
  const fetchServices = useServerFn(listServicesAdmin);
  const create = useServerFn(createSlot);
  const toggle = useServerFn(toggleSlot);
  const remove = useServerFn(deleteSlot);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");

  const { data: services = [] } = useQuery({ queryKey: ["admin-services"], queryFn: () => fetchServices() });
  const { data: slots = [] } = useQuery({
    queryKey: ["admin-slots", filter],
    queryFn: () => fetchSlots({ data: filter === "all" ? {} : { serviceId: filter } }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-slots"] });
  const slotServices = services.filter((s) => s.requires_slot);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-56 bg-admin-surface"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os serviços</SelectItem>
            {slotServices.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <NewSlotDialog services={slotServices} onCreated={refresh} create={create} />
      </div>

      <BentoCard padded={false}>
        {slots.length === 0 ? (
          <p className="p-6 text-admin-ink-muted">Nenhuma vaga cadastrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-admin-surface-2 text-xs uppercase tracking-wider text-admin-ink-muted">
                <tr>
                  <th className="text-left px-4 py-3">Serviço</th>
                  <th className="text-left px-4 py-3">Início</th>
                  <th className="text-left px-4 py-3">Fim</th>
                  <th className="text-right px-4 py-3">Vagas</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((s) => (
                  <tr key={s.id} className="border-t border-admin-border">
                    <td className="px-4 py-3">{(s as { services?: { title?: string } }).services?.title ?? "—"}</td>
                    <td className="px-4 py-3 text-admin-ink-soft">{new Date(s.starts_at).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3 text-admin-ink-soft">{new Date(s.ends_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{s.booked} / {s.capacity}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs uppercase tracking-wider font-display px-2 py-1 rounded ${s.is_active ? "bg-emerald-100 text-emerald-900" : "bg-slate-200 text-slate-600"}`}>
                        {s.is_active ? "Ativa" : "Inativa"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={async () => { await toggle({ data: { id: s.id, is_active: !s.is_active } }); refresh(); }}>
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={async () => { if (confirm("Excluir esta vaga?")) { await remove({ data: { id: s.id } }); refresh(); } }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </BentoCard>
    </div>
  );
}

export function NewSlotDialog({
  services,
  onCreated,
  create,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: {
  services: { id: string; title: string }[];
  onCreated: () => void;
  create: ReturnType<typeof useServerFn<typeof createSlot>>;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  trigger?: React.ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [form, setForm] = useState({ service_id: "", date: "", start: "10:00", end: "12:00", capacity: 4 });

  const submit = async () => {
    try {
      if (!form.service_id || !form.date) throw new Error("Preencha serviço e data");
      const starts_at = new Date(`${form.date}T${form.start}:00`).toISOString();
      const ends_at = new Date(`${form.date}T${form.end}:00`).toISOString();
      if (new Date(starts_at).getTime() <= Date.now()) throw new Error("Não é possível criar vaga em data/hora passada");
      if (new Date(ends_at).getTime() <= new Date(starts_at).getTime()) throw new Error("O fim deve ser maior que o início");
      await create({ data: { service_id: form.service_id, starts_at, ends_at, capacity: form.capacity } });
      toast.success("Vaga criada");
      setOpen(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button className="bg-admin-accent hover:bg-admin-accent/90"><Plus className="h-4 w-4" /> Nova vaga</Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader><DialogTitle>Nova vaga</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Serviço</Label>
            <Select value={form.service_id} onValueChange={(v) => setForm({ ...form, service_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Data</Label><Input type="date" min={todayIso} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Início</Label><Input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
            <div><Label>Fim</Label><Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
          </div>
          <div><Label>Capacidade</Label><Input type="number" min={1} max={50} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: parseInt(e.target.value || "1") })} /></div>
          <Button onClick={submit} className="w-full bg-admin-accent hover:bg-admin-accent/90">Criar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
