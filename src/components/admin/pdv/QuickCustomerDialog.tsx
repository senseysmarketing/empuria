import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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
import { toast } from "sonner";
import { createCustomerQuick } from "@/lib/admin/pdv-sales.functions";
import type { PdvCustomer } from "./CustomerSearchPanel";

export function QuickCustomerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (c: PdvCustomer) => void;
}) {
  const create = useServerFn(createCustomerQuick);
  const [form, setForm] = useState({ fullName: "", phone: "", email: "" });
  const [saving, setSaving] = useState(false);

  const reset = () => setForm({ fullName: "", phone: "", email: "" });

  const save = async () => {
    if (!form.fullName.trim() || !form.email.trim() || !form.phone.trim()) {
      toast.error("Preencha nome, e-mail e telefone");
      return;
    }
    setSaving(true);
    try {
      const res = await create({ data: form });
      const reused = !res.created || (res.full_name && res.full_name.trim() !== form.fullName.trim());
      if (reused) {
        toast.info(`Cliente ja cadastrado como "${res.full_name}". Reutilizando perfil existente para nao alterar o historico.`);
      } else {
        toast.success("Cliente cadastrado. Oriente o primeiro acesso pelo login.");
      }
      reset();
      onOpenChange(false);
      onCreated({
        id: res.id,
        full_name: res.full_name,
        phone: res.phone,
        avatar_url: null,
        is_club_member: false,
        is_blocked: false,
      });
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
          <DialogTitle className="font-display text-2xl">Cadastrar cliente</DialogTitle>
          <DialogDescription>
            Cadastro rapido para iniciar a venda, sem definir senha.
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
            <Label>Telefone</Label>
            <PhoneInput
              variant="admin"
              value={form.phone}
              onChange={(e164) => setForm({ ...form, phone: e164 ?? "" })}
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
          <p className="rounded-lg border border-yellow-brand/30 bg-yellow-brand/10 p-3 text-xs text-admin-ink-muted">
            Nenhuma senha sera criada pela equipe. O cliente usara Primeiro acesso no login para
            cadastrar a senha.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving} className="bg-admin-accent text-white">
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
