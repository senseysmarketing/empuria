import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Loader2, Phone, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  listPhoneMigrationCandidates,
  applyPhoneMigration,
  type PhoneCandidate,
} from "@/lib/admin/phone-migration.functions";

export const Route = createFileRoute("/_authenticated/admin/telefones-migracao")({
  component: PhoneMigrationPage,
});

const TABLE_LABEL: Record<PhoneCandidate["table"], string> = {
  profiles: "Usuários",
  leads: "Leads",
  crm_conversations: "Conversas CRM",
  crm_inbox_messages: "Inbox CRM",
  club_subscriptions: "Clube/Hubla",
};

function StatusBadge({ status }: { status: PhoneCandidate["status"] }) {
  if (status === "ok")
    return (
      <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> Seguro
      </Badge>
    );
  if (status === "needs_review")
    return (
      <Badge variant="default" className="gap-1 bg-amber-600 hover:bg-amber-600">
        <AlertTriangle className="h-3 w-3" /> Revisar
      </Badge>
    );
  return (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" /> Inválido
    </Badge>
  );
}

function PhoneMigrationPage() {
  const list = useServerFn(listPhoneMigrationCandidates);
  const apply = useServerFn(applyPhoneMigration);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["phone-migration"],
    queryFn: () => list(),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const candidates = data?.candidates ?? [];
  const counts = data?.counts ?? {};

  const eligible = useMemo(
    () => candidates.filter((c) => c.status !== "invalid" && c.suggested),
    [candidates],
  );

  const keyOf = (c: PhoneCandidate) => `${c.table}:${c.id}`;

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = (status?: PhoneCandidate["status"]) => {
    const subset = status ? eligible.filter((c) => c.status === status) : eligible;
    setSelected(new Set(subset.map(keyOf)));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const items = eligible
        .filter((c) => selected.has(keyOf(c)) && c.suggested)
        .map((c) => ({
          table: c.table,
          id: c.id,
          e164: c.suggested!,
          country: c.country,
        }));
      if (items.length === 0) throw new Error("Selecione ao menos um registro.");
      return apply({ data: { items } });
    },
    onSuccess: (res) => {
      toast.success(`${res.updated} telefone(s) normalizados.`);
      if (res.errors.length) toast.error(`${res.errors.length} erro(s). Veja o console.`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["phone-migration"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao aplicar"),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-display">
            <Phone className="h-6 w-6" /> Migração de Telefones
          </h1>
          <p className="text-sm text-muted-foreground">
            Revise e normalize números antigos para o padrão internacional E.164.
          </p>
        </div>
        <Button
          onClick={() => mutation.mutate()}
          disabled={selected.size === 0 || mutation.isPending}
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Aplicar {selected.size} selecionado(s)
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-emerald-50 p-4 dark:bg-emerald-950/30">
          <div className="text-sm text-muted-foreground">Seguros (auto)</div>
          <div className="text-2xl font-bold">{counts.ok ?? 0}</div>
        </div>
        <div className="rounded-lg border bg-amber-50 p-4 dark:bg-amber-950/30">
          <div className="text-sm text-muted-foreground">Precisam revisão</div>
          <div className="text-2xl font-bold">{counts.needs_review ?? 0}</div>
        </div>
        <div className="rounded-lg border bg-rose-50 p-4 dark:bg-rose-950/30">
          <div className="text-sm text-muted-foreground">Inválidos</div>
          <div className="text-2xl font-bold">{counts.invalid ?? 0}</div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => selectAll("ok")}>
          Selecionar todos seguros
        </Button>
        <Button variant="outline" size="sm" onClick={() => selectAll()}>
          Selecionar todos elegíveis
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
          Limpar
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600 mb-2" />
          Todos os telefones já estão em E.164. Nada a migrar.
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3 w-10"></th>
                <th className="p-3">Origem</th>
                <th className="p-3">Identificação</th>
                <th className="p-3">Atual</th>
                <th className="p-3">Sugerido (E.164)</th>
                <th className="p-3">País</th>
                <th className="p-3">Status</th>
                <th className="p-3">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const key = keyOf(c);
                const disabled = c.status === "invalid" || !c.suggested;
                return (
                  <tr key={key} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <Checkbox
                        checked={selected.has(key)}
                        disabled={disabled}
                        onCheckedChange={() => toggle(key)}
                      />
                    </td>
                    <td className="p-3">{TABLE_LABEL[c.table]}</td>
                    <td className="p-3 truncate max-w-[200px]">{c.label ?? c.id.slice(0, 8)}</td>
                    <td className="p-3 font-mono text-xs">{c.current}</td>
                    <td className="p-3 font-mono text-xs">{c.suggested ?? "—"}</td>
                    <td className="p-3">{c.country ?? "—"}</td>
                    <td className="p-3"><StatusBadge status={c.status} /></td>
                    <td className="p-3 text-xs text-muted-foreground">{c.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
