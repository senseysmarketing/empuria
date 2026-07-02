import { useEffect, useMemo, useState } from "react";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  MODULE_LABELS,
  setStaffPermission,
  type ModuleKey,
} from "@/lib/admin/permissions.functions";
import {
  PERMISSION_GROUPS,
  PROFILE_LABELS,
  PROFILE_DESCRIPTIONS,
  PROFILE_MODULES,
  LOCKED_BASE_MODULES,
  detectProfile,
  type ProfileKey,
} from "@/lib/admin/permission-profiles";
import { cn } from "@/lib/utils";
import type { MemberCardData } from "./MemberCard";

const PROFILE_ORDER: ProfileKey[] = [
  "recepcao_pdv",
  "comercial",
  "operacao",
  "financeiro",
  "gestor",
  "personalizado",
];

export function EditMemberPermissionsDialog({
  member,
  open,
  onOpenChange,
}: {
  member: MemberCardData | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const setPerm = useServerFn(setStaffPermission);
  const qc = useQueryClient();
  const isAdmin = member?.role === "admin";

  const [selected, setSelected] = useState<Set<ModuleKey>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (member && open) {
      const base = new Set(member.allowed_modules as ModuleKey[]);
      for (const m of LOCKED_BASE_MODULES) base.add(m);
      setSelected(base);
    }
  }, [member, open]);

  const currentProfile = useMemo(
    () => detectProfile(Array.from(selected)),
    [selected],
  );

  const originalModules = useMemo(
    () => new Set((member?.allowed_modules ?? []) as ModuleKey[]),
    [member],
  );

  const toggle = (module: ModuleKey, value: boolean) => {
    if (LOCKED_BASE_MODULES.includes(module) && !value) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (value) next.add(module);
      else next.delete(module);
      return next;
    });
  };

  const applyProfile = (key: ProfileKey) => {
    if (key === "personalizado") return;
    const next = new Set<ModuleKey>(PROFILE_MODULES[key]);
    for (const m of LOCKED_BASE_MODULES) next.add(m);
    setSelected(next);
  };

  const defaultAccordionOpen = useMemo(
    () => PERMISSION_GROUPS.filter((g) => g.defaultOpen).map((g) => g.key),
    [],
  );

  const save = async () => {
    if (!member) return;
    const toEnable: ModuleKey[] = [];
    const toDisable: ModuleKey[] = [];
    for (const m of selected) if (!originalModules.has(m)) toEnable.push(m);
    for (const m of originalModules) if (!selected.has(m)) toDisable.push(m);

    if (toEnable.length === 0 && toDisable.length === 0) {
      toast.info("Nenhuma alteração para salvar.");
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      await Promise.all([
        ...toEnable.map((module_key) =>
          setPerm({ data: { user_id: member.id, module_key, is_allowed: true } }),
        ),
        ...toDisable.map((module_key) =>
          setPerm({ data: { user_id: member.id, module_key, is_allowed: false } }),
        ),
      ]);
      toast.success("Permissões atualizadas");
      qc.invalidateQueries({ queryKey: ["staff-permissions"] });
      qc.invalidateQueries({ queryKey: ["my-module-access"] });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  if (!member) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-admin-surface border-admin-border text-admin-ink max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            {isAdmin && <ShieldCheck className="h-5 w-5 text-admin-accent" />}
            {member.full_name ?? "Sem nome"}
          </DialogTitle>
          <DialogDescription>
            {isAdmin
              ? "Admins recebem acesso total automaticamente — nada para configurar."
              : "Escolha um perfil pronto ou ajuste manualmente por seção."}
          </DialogDescription>
        </DialogHeader>

        {isAdmin ? (
          <div className="rounded-lg border border-admin-accent/30 bg-admin-accent/5 p-4 text-sm">
            Este membro é <b>Admin</b>. Todos os módulos do sistema ficam liberados
            automaticamente, sem necessidade de toggles. Para limitar acessos, remova a
            função de Admin via gerenciamento de usuários.
          </div>
        ) : (
          <div className="space-y-6 py-2">
            <section>
              <div className="text-xs uppercase tracking-wider text-admin-ink-muted mb-2">
                Perfil de acesso
              </div>
              <div className="flex flex-wrap gap-2">
                {PROFILE_ORDER.map((p) => {
                  const active = currentProfile === p;
                  const isCustom = p === "personalizado";
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => !isCustom && applyProfile(p)}
                      disabled={isCustom}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs border transition-colors",
                        active
                          ? "bg-admin-accent text-white border-admin-accent"
                          : "bg-admin-bg border-admin-border text-admin-ink hover:border-admin-accent/50",
                        isCustom && "italic opacity-80 cursor-default",
                      )}
                      title={PROFILE_DESCRIPTIONS[p]}
                    >
                      {PROFILE_LABELS[p]}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-admin-ink-muted mt-2">
                {PROFILE_DESCRIPTIONS[currentProfile]}
              </p>
            </section>

            <section className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-admin-ink-muted">
                Permissões por seção
              </div>
              <Accordion type="multiple" defaultValue={defaultAccordionOpen} className="space-y-2">
                {PERMISSION_GROUPS.map((group) => {
                  const enabledCount = group.modules.filter((m) => selected.has(m)).length;
                  return (
                    <AccordionItem
                      key={group.key}
                      value={group.key}
                      className={cn(
                        "rounded-xl border px-4",
                        group.tone === "sensitive"
                          ? "border-yellow-brand/40 bg-yellow-brand/5"
                          : "border-admin-border bg-admin-bg/40",
                      )}
                    >
                      <AccordionTrigger className="hover:no-underline py-3">
                        <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                          <div className="text-left">
                            <div className="font-display text-sm text-admin-ink flex items-center gap-2">
                              {group.label}
                              {group.tone === "sensitive" && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] border-yellow-brand/50 text-yellow-brand"
                                >
                                  Sensível
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-admin-ink-muted mt-0.5 font-normal">
                              {group.description}
                            </div>
                          </div>
                          <span className="text-[11px] text-admin-ink-muted tabular-nums shrink-0">
                            {enabledCount}/{group.modules.length}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 pb-3">
                          {group.modules.map((m) => {
                            const locked = LOCKED_BASE_MODULES.includes(m);
                            const checked = selected.has(m);
                            return (
                              <div
                                key={m}
                                className="flex items-center justify-between rounded-md border border-admin-border bg-admin-surface px-3 py-2"
                              >
                                <div className="flex items-center gap-2 text-sm text-admin-ink">
                                  {locked && (
                                    <Lock className="h-3.5 w-3.5 text-admin-ink-muted" />
                                  )}
                                  {MODULE_LABELS[m]}
                                  {locked && (
                                    <span className="text-[10px] text-admin-ink-muted">
                                      (sempre liberado)
                                    </span>
                                  )}
                                </div>
                                <Switch
                                  checked={checked}
                                  disabled={locked}
                                  onCheckedChange={(v) => toggle(m, v)}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isAdmin ? "Fechar" : "Cancelar"}
          </Button>
          {!isAdmin && (
            <Button
              onClick={save}
              disabled={saving}
              className="bg-admin-accent text-white hover:bg-admin-accent/90"
            >
              {saving ? "Salvando…" : "Salvar alterações"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
