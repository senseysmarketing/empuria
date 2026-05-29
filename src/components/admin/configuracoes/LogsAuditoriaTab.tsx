import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { BentoCard } from "@/components/admin/BentoCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listAuditLogs, listImpersonationLogs } from "@/lib/admin/audit.functions";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/admin/permissions.functions";

function formatDate(s: string) {
  const d = new Date(s);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function LogsAuditoriaTab() {
  const fetchAudit = useServerFn(listAuditLogs);
  const fetchImper = useServerFn(listImpersonationLogs);
  const [moduleFilter, setModuleFilter] = useState<string>("all");

  const auditQ = useQuery({
    queryKey: ["audit-logs", moduleFilter],
    queryFn: () => fetchAudit({ data: { module: moduleFilter === "all" ? undefined : moduleFilter, limit: 100 } }),
  });

  const imperQ = useQuery({
    queryKey: ["impersonation-logs"],
    queryFn: () => fetchImper(),
  });

  return (
    <div className="space-y-6">
      <BentoCard
        title="Auditoria"
        action={
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-[180px] bg-admin-bg border-admin-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os módulos</SelectItem>
              {ALL_MODULES.map((m) => <SelectItem key={m} value={m}>{MODULE_LABELS[m]}</SelectItem>)}
            </SelectContent>
          </Select>
        }
        padded={false}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-admin-bg text-[10px] uppercase tracking-wider text-admin-ink-muted">
              <tr>
                <th className="text-left p-3 font-display">Quando</th>
                <th className="text-left p-3 font-display">Ator</th>
                <th className="text-left p-3 font-display">Módulo</th>
                <th className="text-left p-3 font-display">Ação</th>
                <th className="text-left p-3 font-display">Entidade</th>
              </tr>
            </thead>
            <tbody>
              {(auditQ.data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-admin-border hover:bg-admin-bg/50">
                  <td className="p-3 text-admin-ink-muted text-xs whitespace-nowrap">{formatDate(r.created_at)}</td>
                  <td className="p-3">{r.actor_name ?? <span className="text-admin-ink-muted">—</span>}</td>
                  <td className="p-3 capitalize text-admin-ink-muted">{r.module}</td>
                  <td className="p-3 font-mono text-xs">{r.action}</td>
                  <td className="p-3 text-admin-ink-muted text-xs">{r.entity_type ?? "—"}</td>
                </tr>
              ))}
              {(auditQ.data ?? []).length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-admin-ink-muted text-sm">Nenhum registro</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </BentoCard>

      <BentoCard title="Impersonações" padded={false}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-admin-bg text-[10px] uppercase tracking-wider text-admin-ink-muted">
              <tr>
                <th className="text-left p-3 font-display">Quando</th>
                <th className="text-left p-3 font-display">Admin</th>
                <th className="text-left p-3 font-display">Alvo</th>
                <th className="text-left p-3 font-display">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {(imperQ.data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-admin-border hover:bg-admin-bg/50">
                  <td className="p-3 text-admin-ink-muted text-xs whitespace-nowrap">{formatDate(r.created_at)}</td>
                  <td className="p-3">{r.admin_name ?? "—"}</td>
                  <td className="p-3">{r.target_name ?? "—"}</td>
                  <td className="p-3 text-admin-ink-muted text-xs">{r.reason}</td>
                </tr>
              ))}
              {(imperQ.data ?? []).length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-admin-ink-muted text-sm">Nenhuma impersonação registrada</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </BentoCard>
    </div>
  );
}
