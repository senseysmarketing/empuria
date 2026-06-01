import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAppointment } from "@/lib/admin/agenda.functions";
import { listServicesAdmin } from "@/lib/admin/slots.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export function AppointmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useServerFn(createAppointment);
  const fetchServices = useServerFn(listServicesAdmin);
  const qc = useQueryClient();
  const { data: services = [] } = useQuery({
    queryKey: ["admin-services"],
    queryFn: () => fetchServices(),
    enabled: open,
  });

  const [form, setForm] = useState({
    service_id: "",
    user_id: "",
    date: "",
    start: "10:00",
    end: "11:00",
    notes: "",
  });

  const todayIso = new Date().toISOString().slice(0, 10);

  const submit = async () => {
    try {
      if (!form.service_id) throw new Error("Selecione um serviço");
      if (!form.user_id) throw new Error("Informe o ID do cliente/membro");
      if (!form.date) throw new Error("Selecione a data");
      const starts_at = new Date(`${form.date}T${form.start}:00`).toISOString();
      const ends_at = new Date(`${form.date}T${form.end}:00`).toISOString();
      await create({
        data: {
          service_id: form.service_id,
          user_id: form.user_id,
          starts_at,
          ends_at,
          notes: form.notes || undefined,
        },
      });
      toast.success("Compromisso criado");
      qc.invalidateQueries({ queryKey: ["agenda"] });
      onOpenChange(false);
      setForm({ ...form, notes: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo compromisso</DialogTitle></DialogHeader>
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
          <div>
            <Label>ID do cliente/membro (UUID)</Label>
            <Input
              placeholder="uuid do perfil"
              value={form.user_id}
              onChange={(e) => setForm({ ...form, user_id: e.target.value })}
            />
            <p className="text-[11px] text-admin-ink-muted mt-1">Copie o UUID em /admin/usuarios</p>
          </div>
          <div><Label>Data</Label><Input type="date" min={todayIso} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Início</Label><Input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
            <div><Label>Fim</Label><Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <Button onClick={submit} className="w-full bg-admin-accent hover:bg-admin-accent/90">Criar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
