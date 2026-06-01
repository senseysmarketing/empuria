import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { createCalendarTask } from "@/lib/admin/calendar-tasks.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

type Priority = "baixa" | "media" | "alta" | "urgente";

export function TaskDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useServerFn(createCalendarTask);
  const qc = useQueryClient();

  const [form, setForm] = useState<{
    title: string;
    description: string;
    priority: Priority;
    date: string;
    time: string;
  }>({
    title: "",
    description: "",
    priority: "media",
    date: "",
    time: "",
  });

  const todayIso = new Date().toISOString().slice(0, 10);

  const submit = async () => {
    try {
      if (!form.title.trim()) throw new Error("Informe o título");
      let due_at: string | undefined;
      if (form.date) {
        const time = form.time || "09:00";
        due_at = new Date(`${form.date}T${time}:00`).toISOString();
      }
      await create({
        data: {
          title: form.title.trim(),
          description: form.description || undefined,
          priority: form.priority,
          due_at,
        },
      });
      toast.success("Tarefa criada");
      qc.invalidateQueries({ queryKey: ["calendar-tasks"] });
      onOpenChange(false);
      setForm({ title: "", description: "", priority: "media", date: "", time: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova tarefa</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Título</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Ligar para cliente X" />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <Label>Prioridade</Label>
              <Select value={form.priority} onValueChange={(v: Priority) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-1">
              <Label>Prazo</Label>
              <Input type="date" min={todayIso} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="col-span-1">
              <Label>Hora</Label>
              <Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </div>
          </div>
          <Button onClick={submit} className="w-full bg-admin-accent hover:bg-admin-accent/90">Criar tarefa</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
