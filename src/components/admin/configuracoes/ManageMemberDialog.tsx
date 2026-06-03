import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  KeyRound,
  Mail,
  ShieldOff,
  ShieldCheck,
  Loader2,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import {
  updateUserProfile,
  setUserBlocked,
  forcePasswordReset,
  changeUserEmail,
} from "@/lib/admin/usuarios.functions";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { MemberCardData } from "./MemberCard";

export function ManageMemberDialog({
  member,
  open,
  onOpenChange,
}: {
  member: MemberCardData | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const updateFn = useServerFn(updateUserProfile);
  const blockFn = useServerFn(setUserBlocked);
  const resetFn = useServerFn(forcePasswordReset);
  const emailFn = useServerFn(changeUserEmail);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailEditing, setEmailEditing] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

  useEffect(() => {
    if (open && member) {
      setFullName(member.full_name ?? "");
      setPhone(member.phone ?? "");
      setNewEmail(member.email ?? "");
      setEmailEditing(false);
    }
  }, [open, member]);

  if (!member) return null;

  const isSelf = me?.userId === member.id;
  const isBlocked = Boolean(member.is_blocked);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["staff-permissions"] });

  const saveProfile = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          id: member.id,
          full_name: fullName.trim() || undefined,
          phone: phone.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Dados atualizados");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeEmail = useMutation({
    mutationFn: () =>
      emailFn({ data: { id: member.id, new_email: newEmail.trim() } }),
    onSuccess: () => {
      toast.success("E-mail alterado");
      setEmailEditing(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetPassword = useMutation({
    mutationFn: () => resetFn({ data: { id: member.id } }),
    onSuccess: (res) => {
      if (res?.url) {
        navigator.clipboard?.writeText(res.url).catch(() => {});
        toast.success("Link de redefinição copiado", {
          description: "Compartilhe com o usuário.",
          action: {
            label: "Copiar novamente",
            onClick: () => navigator.clipboard?.writeText(res.url),
          },
        });
      } else {
        toast.success("Link gerado");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleBlocked = useMutation({
    mutationFn: () =>
      blockFn({ data: { id: member.id, blocked: !isBlocked } }),
    onSuccess: () => {
      toast.success(isBlocked ? "Usuário reativado" : "Usuário inativado");
      setConfirmBlock(false);
      invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-admin-surface border-admin-border text-admin-ink max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              Gerenciar usuário
              {isBlocked && (
                <Badge variant="destructive" className="text-[10px]">
                  Inativo
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Edite dados básicos e ações administrativas deste membro.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Dados básicos */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nome completo</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="bg-admin-bg border-admin-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Telefone</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="bg-admin-bg border-admin-border"
                  placeholder="(11) 99999-9999"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <div>
                  <Badge variant="outline" className="text-xs">
                    {member.role === "admin" ? "Admin" : "Staff"}
                  </Badge>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => saveProfile.mutate()}
                  disabled={saveProfile.isPending}
                  className="bg-admin-accent text-white hover:bg-admin-accent/90"
                >
                  {saveProfile.isPending && (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  )}
                  Salvar dados
                </Button>
              </div>
            </div>

            <Separator className="bg-admin-border" />

            {/* E-mail */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> E-mail
              </Label>
              <div className="flex gap-2">
                <Input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  disabled={!emailEditing}
                  className="bg-admin-bg border-admin-border"
                />
                {emailEditing ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => changeEmail.mutate()}
                      disabled={
                        changeEmail.isPending ||
                        !newEmail.trim() ||
                        newEmail.trim() === member.email
                      }
                      className="bg-admin-accent text-white hover:bg-admin-accent/90"
                    >
                      {changeEmail.isPending && (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      )}
                      Confirmar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEmailEditing(false);
                        setNewEmail(member.email ?? "");
                      }}
                    >
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEmailEditing(true)}
                  >
                    Alterar
                  </Button>
                )}
              </div>
              <p className="text-xs text-admin-ink-muted">
                A alteração é imediata e confirma o novo e-mail automaticamente.
              </p>
            </div>

            <Separator className="bg-admin-border" />

            {/* Segurança */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" /> Segurança
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resetPassword.mutate()}
                disabled={resetPassword.isPending}
                className="w-full justify-start"
              >
                {resetPassword.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4 mr-1.5" />
                )}
                Gerar link de redefinição de senha
              </Button>
              <p className="text-xs text-admin-ink-muted">
                O link é copiado para a área de transferência. Envie ao usuário
                por canal seguro.
              </p>
            </div>

            <Separator className="bg-admin-border" />

            {/* Status */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                {isBlocked ? (
                  <ShieldCheck className="h-3.5 w-3.5" />
                ) : (
                  <ShieldOff className="h-3.5 w-3.5" />
                )}
                Status da conta
              </Label>
              <Button
                variant={isBlocked ? "outline" : "destructive"}
                size="sm"
                onClick={() => setConfirmBlock(true)}
                disabled={isSelf}
                className="w-full"
              >
                {isBlocked ? "Reativar usuário" : "Inativar usuário"}
              </Button>
              {isSelf && (
                <p className="text-xs text-admin-ink-muted">
                  Você não pode inativar a si mesmo.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmBlock} onOpenChange={setConfirmBlock}>
        <AlertDialogContent className="bg-admin-surface border-admin-border text-admin-ink">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isBlocked ? "Reativar usuário?" : "Inativar usuário?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isBlocked
                ? `${member.full_name ?? "Este usuário"} voltará a ter acesso ao sistema.`
                : `${member.full_name ?? "Este usuário"} perderá acesso ao sistema imediatamente. Sessões ativas serão encerradas.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                toggleBlocked.mutate();
              }}
              disabled={toggleBlocked.isPending}
              className={
                isBlocked
                  ? "bg-admin-accent text-white hover:bg-admin-accent/90"
                  : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              }
            >
              {toggleBlocked.isPending && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              {isBlocked ? "Reativar" : "Inativar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
