import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { BentoCard } from "@/components/admin/BentoCard";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getMyAccount, updateMyProfile, updateMyEmail, updateMyPassword } from "@/lib/admin/account.functions";

export function PerfilContaTab() {
  const fetchAcc = useServerFn(getMyAccount);
  const updateProfile = useServerFn(updateMyProfile);
  const updateEmail = useServerFn(updateMyEmail);
  const updatePassword = useServerFn(updateMyPassword);

  const accQ = useQuery({ queryKey: ["my-account"], queryFn: () => fetchAcc() });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    if (accQ.data) {
      setFullName(accQ.data.profile?.full_name ?? "");
      setPhone(accQ.data.profile?.phone ?? "");
      setAvatarUrl(accQ.data.profile?.avatar_url ?? "");
      setNewEmail(accQ.data.email ?? "");
    }
  }, [accQ.data]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await updateProfile({ data: { full_name: fullName.trim(), phone: phone.trim() || null, avatar_url: avatarUrl.trim() || null } });
      toast.success("Perfil atualizado");
      accQ.refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSavingProfile(false); }
  };

  const saveEmail = async () => {
    if (!newEmail || newEmail === accQ.data?.email) return;
    setSavingEmail(true);
    try {
      await updateEmail({ data: { new_email: newEmail.trim() } });
      toast.success("E-mail atualizado");
      accQ.refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSavingEmail(false); }
  };

  const savePwd = async () => {
    if (pwd.length < 8) return toast.error("Senha precisa de 8+ caracteres");
    if (pwd !== pwd2) return toast.error("As senhas não conferem");
    setSavingPwd(true);
    try {
      await updatePassword({ data: { new_password: pwd } });
      toast.success("Senha alterada");
      setPwd(""); setPwd2("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSavingPwd(false); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <BentoCard title="Perfil">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome completo</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="bg-admin-bg border-admin-border" />
          </div>
          <div className="space-y-1.5">
            <Label>Telefone</Label>
            <PhoneInput variant="admin" value={phone} onChange={(e164) => setPhone(e164 ?? "")} />
          </div>
          <div className="space-y-1.5">
            <Label>Avatar (URL)</Label>
            <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} className="bg-admin-bg border-admin-border" placeholder="https://…" />
          </div>
          <Button onClick={saveProfile} disabled={savingProfile} className="bg-admin-accent text-white">Salvar perfil</Button>
        </div>
      </BentoCard>

      <BentoCard title="E-mail de acesso">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="bg-admin-bg border-admin-border" />
          </div>
          <p className="text-xs text-admin-ink-muted">A troca é imediata e confirmada automaticamente.</p>
          <Button onClick={saveEmail} disabled={savingEmail || newEmail === accQ.data?.email} variant="outline">Alterar e-mail</Button>
        </div>
      </BentoCard>

      <BentoCard title="Senha" className="lg:col-span-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Nova senha</Label>
            <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} className="bg-admin-bg border-admin-border" />
          </div>
          <div className="space-y-1.5">
            <Label>Confirme a nova senha</Label>
            <Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} className="bg-admin-bg border-admin-border" />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={savePwd} disabled={savingPwd || !pwd} className="bg-admin-accent text-white">Alterar senha</Button>
        </div>
      </BentoCard>
    </div>
  );
}
