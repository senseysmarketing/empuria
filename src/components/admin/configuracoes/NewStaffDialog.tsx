import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { createStaffMember } from "@/lib/admin/permissions.functions";

type Role = "staff" | "admin";

export function NewStaffDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useServerFn(createStaffMember);
  const qc = useQueryClient();
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", role: "staff" as Role });
  const [saving, setSaving] = useState(false);

  const reset = () => setForm({ fullName: "", email: "", phone: "", role: "staff" });

  const save = async () => {
    if (!form.fullName.trim() || !form.email.trim()) {
      toast.error("Preencha nome e e-mail");
      return;
    }
    setSaving(true);
    try {
      const res = await create({
        data: {
          full_name: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          role: form.role,
        },
      });
      toast.success(
        res.created
          ? "Membro criado. Oriente o primeiro acesso pelo login."
          : "Permissão de equipe concedida ao usuário existente.",
      );
      qc.invalidateQueries({ queryKey: ["staff-permissions"] });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-admin-surface border-admin-border text-admin-ink">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Novo membro da equipe</DialogTitle>
          <DialogDescription>
            Crie um usuário staff ou admin. Nenhuma senha é definida aqui.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Nome completo</Label>
            <Input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="bg-admin-bg border-admin-border"
            />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="bg-admin-bg border-admin-border"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Telefone (opcional)</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="bg-admin-bg border-admin-border"
            />
          </div>
          <div className="space-y-2">
            <Label>Função</Label>
            <RadioGroup
              value={form.role}
              onValueChange={(v) => setForm({ ...form, role: v as Role })}
              className="grid grid-cols-1 gap-2"
            >
              <label className="flex items-start gap-3 rounded-lg border border-admin-border bg-admin-bg p-3 cursor-pointer hover:border-admin-accent/60">
                <RadioGroupItem value="staff" className="mt-0.5" />
                <div>
                  <div className="font-medium text-admin-ink">Staff</div>
                  <div className="text-xs text-admin-ink-muted">
                    Acesso à área /admin. Permissões por módulo definidas na tabela abaixo.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-admin-border bg-admin-bg p-3 cursor-pointer hover:border-admin-accent/60">
                <RadioGroupItem value="admin" className="mt-0.5" />
                <div>
                  <div className="font-medium text-admin-ink">Admin</div>
                  <div className="text-xs text-admin-ink-muted">
                    Acesso total a todos os módulos, sem necessidade de toggles.
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>
          <p className="rounded-lg border border-yellow-brand/30 bg-yellow-brand/10 p-3 text-xs text-admin-ink-muted">
            Nenhuma senha será definida pela equipe. O membro deverá usar <b>Primeiro acesso</b> no
            login para cadastrar a senha. Staff é direcionado para /admin automaticamente.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving} className="bg-admin-accent text-white">
            {saving ? "Criando…" : "Criar membro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
