import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { updateUserProfile, type UserRow } from "@/lib/admin/usuarios.functions";

export function UsuarioEditSheet({ user, open, onClose, onSaved }: {
  user: UserRow; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const update = useServerFn(updateUserProfile);
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [isClub, setIsClub] = useState(user.is_club_member);
  const [notes, setNotes] = useState(user.admin_notes ?? "");

  useEffect(() => {
    if (open) {
      setFullName(user.full_name ?? "");
      setPhone(user.phone ?? "");
      setIsClub(user.is_club_member);
      setNotes(user.admin_notes ?? "");
    }
  }, [open, user]);

  const mut = useMutation({
    mutationFn: () => update({ data: {
      id: user.id,
      full_name: fullName.trim() || undefined,
      phone: phone.trim() || null,
      is_club_member: isClub,
      admin_notes: notes.trim() || null,
    }}),
    onSuccess: () => { toast.success("Perfil atualizado"); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-admin-surface border-admin-border text-admin-ink overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display">Editar perfil</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Nome completo</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="bg-admin-bg border-admin-border" />
          </div>
          <div className="space-y-2">
            <Label>Telefone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="bg-admin-bg border-admin-border" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-admin-border p-3">
            <div>
              <div className="font-display text-sm">Membro do Clube</div>
              <div className="text-xs text-admin-ink-muted">Acesso premium e benefícios</div>
            </div>
            <Switch checked={isClub} onCheckedChange={setIsClub} />
          </div>
          <div className="space-y-2">
            <Label>Notas internas (admin)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-admin-bg border-admin-border min-h-32" placeholder="Observações da equipe sobre este cliente…" />
          </div>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="bg-admin-accent text-white">Salvar</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
