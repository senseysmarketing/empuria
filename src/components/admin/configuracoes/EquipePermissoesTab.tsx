import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BentoCard } from "@/components/admin/BentoCard";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  ALL_MODULES,
  MODULE_LABELS,
  listStaffWithPermissions,
  setStaffPermission,
  type ModuleKey,
} from "@/lib/admin/permissions.functions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { NewStaffDialog } from "./NewStaffDialog";

export function EquipePermissoesTab() {
  const fetchList = useServerFn(listStaffWithPermissions);
  const setPerm = useServerFn(setStaffPermission);
  const qc = useQueryClient();
  const { isAdmin } = useCurrentUser();
  const [openNew, setOpenNew] = useState(false);


  const { data: users = [], isLoading } = useQuery({
    queryKey: ["staff-permissions"],
    queryFn: () => fetchList(),
  });

  const toggle = async (userId: string, moduleKey: ModuleKey, value: boolean) => {
    try {
      await setPerm({ data: { user_id: userId, module_key: moduleKey, is_allowed: value } });
      qc.invalidateQueries({ queryKey: ["staff-permissions"] });
      qc.invalidateQueries({ queryKey: ["my-module-access"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <BentoCard padded={false}>
      <div className="p-5 border-b border-admin-border">
        <h3 className="font-display text-lg text-admin-ink">Permissões por módulo</h3>
        <p className="text-xs text-admin-ink-muted mt-1">
          Admins têm acesso total automaticamente. Use os toggles para liberar telas específicas para cada staff.
        </p>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-admin-ink-muted text-sm">Carregando…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-admin-bg text-[10px] uppercase tracking-wider text-admin-ink-muted">
              <tr>
                <th className="text-left p-3 font-display sticky left-0 bg-admin-bg z-10">Usuário</th>
                {ALL_MODULES.map((m) => (
                  <th key={m} className="p-3 text-center font-display whitespace-nowrap">{MODULE_LABELS[m]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isAdmin = u.role === "admin";
                const allowed = new Set(u.allowed_modules);
                return (
                  <tr key={u.id} className="border-t border-admin-border hover:bg-admin-bg/50">
                    <td className="p-3 sticky left-0 bg-admin-surface z-10 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-admin-ink">{u.full_name ?? "Sem nome"}</span>
                        {isAdmin && (
                          <Badge variant="outline" className="text-[9px] gap-1">
                            <ShieldCheck className="h-3 w-3" /> Admin
                          </Badge>
                        )}
                      </div>
                    </td>
                    {ALL_MODULES.map((m) => (
                      <td key={m} className="p-3 text-center">
                        <Switch
                          checked={isAdmin || allowed.has(m)}
                          disabled={isAdmin}
                          onCheckedChange={(v) => toggle(u.id, m, v)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </BentoCard>
  );
}
