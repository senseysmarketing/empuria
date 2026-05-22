import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DoorOpen } from "lucide-react";
import { registerArrival } from "@/lib/admin/cockpit.functions";
import { toast } from "sonner";

export function ArrivalDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [saving, setSaving] = useState(false);
  const register = useServerFn(registerArrival);
  const qc = useQueryClient();

  const submit = async () => {
    if (name.trim().length < 2) return;
    setSaving(true);
    try {
      await register({ data: { visitor_name: name.trim(), purpose: purpose.trim() || undefined } });
      toast.success("Chegada registrada");
      setName("");
      setPurpose("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["cockpit"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-admin-accent hover:bg-admin-accent/90">
          <DoorOpen className="h-4 w-4" /> Registrar chegada
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quem chegou ao instituto?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do visitante" />
          </div>
          <div>
            <Label>Motivo da visita</Label>
            <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Bate-papo gratuito, retirada de voucher, etc." rows={2} />
          </div>
          <Button onClick={submit} disabled={saving} className="w-full bg-admin-accent hover:bg-admin-accent/90">
            {saving ? "Salvando..." : "Registrar chegada"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
