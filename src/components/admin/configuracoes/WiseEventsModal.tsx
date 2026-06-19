import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listWiseEvents, type WiseEventRow } from "@/lib/admin/wise-events.functions";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  auto_matched: "bg-emerald-100 text-emerald-800 border-emerald-200",
  pdv_matched: "bg-emerald-100 text-emerald-800 border-emerald-200",
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  pdv_pending: "bg-amber-100 text-amber-800 border-amber-200",
  underpaid: "bg-orange-100 text-orange-800 border-orange-200",
  overpaid: "bg-orange-100 text-orange-800 border-orange-200",
  ignored: "bg-slate-100 text-slate-700 border-slate-200",
};

const STATUS_LABEL: Record<string, string> = {
  auto_matched: "Casado",
  pdv_matched: "PDV casado",
  pending: "Sem match",
  pdv_pending: "PDV sem match",
  underpaid: "Valor menor",
  overpaid: "Valor maior",
  ignored: "Ignorado",
};

function fmtAmount(cents: number | null, currency: string | null) {
  if (cents === null) return "—";
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: currency ?? "EUR",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function WiseEventsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetchEvents = useServerFn(listWiseEvents);
  const q = useQuery({
    queryKey: ["wise-events"],
    queryFn: () => fetchEvents(),
    enabled: open,
    refetchInterval: open ? 30000 : false,
  });

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const events = q.data ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return events.filter((e) => {
      if (statusFilter !== "all" && (e.match_status ?? "") !== statusFilter) return false;
      if (s) {
        const hay = `${e.reference ?? ""} ${e.event_type} ${e.event_id ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [events, statusFilter, search]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of events) {
      const k = e.match_status ?? "pending";
      map[k] = (map[k] ?? 0) + 1;
    }
    return map;
  }, [events]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden border-admin-border bg-admin-surface text-admin-ink sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            Eventos Wise recebidos
            <Badge variant="outline">{events.length}</Badge>
          </DialogTitle>
          <DialogDescription className="text-admin-ink-muted">
            Últimos 100 eventos enviados pela Wise para o webhook. Eventos sem referência reconhecida (pending) são normais quando o pagamento entra por fora do site.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48 h-9">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos ({events.length})</SelectItem>
              {Object.keys(STATUS_LABEL).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]} ({counts[s] ?? 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por referência ou tipo..."
            className="h-9 max-w-xs"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="ml-auto"
          >
            {q.isFetching ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            Atualizar
          </Button>
        </div>

        <div className="overflow-y-auto max-h-[60vh] border border-admin-border rounded-lg">
          {q.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-admin-ink-muted">
              {events.length === 0
                ? "Nenhum evento Wise recebido ainda."
                : "Nenhum evento corresponde aos filtros."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-admin-surface-2 text-xs uppercase text-admin-ink-muted sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 w-8"></th>
                  <th className="text-left px-3 py-2">Quando</th>
                  <th className="text-left px-3 py-2">Tipo</th>
                  <th className="text-left px-3 py-2">Referência</th>
                  <th className="text-right px-3 py-2">Valor</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Match</th>
                  <th className="text-center px-3 py-2">Assinatura</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const status = e.match_status ?? "pending";
                  const isOpen = expanded === e.id;
                  return (
                    <>
                      <tr
                        key={e.id}
                        className="border-t border-admin-border hover:bg-admin-surface-2/50 cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : e.id)}
                      >
                        <td className="px-3 py-2">
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-admin-ink-muted" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-admin-ink-muted" />
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmtDate(e.created_at)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{e.event_type}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {e.reference ?? <span className="text-admin-ink-muted">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtAmount(e.amount_cents, e.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge
                            variant="outline"
                            className={cn("font-normal", STATUS_STYLES[status] ?? STATUS_STYLES.pending)}
                          >
                            {STATUS_LABEL[status] ?? status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {e.matched_order_code ? (
                            <span className="font-mono text-emerald-700">{e.matched_order_code}</span>
                          ) : e.matched_pdv_reference ? (
                            <span className="font-mono text-emerald-700">{e.matched_pdv_reference}</span>
                          ) : (
                            <span className="text-admin-ink-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {e.signature_valid ? (
                            <ShieldCheck className="h-4 w-4 text-emerald-600 inline" />
                          ) : (
                            <ShieldAlert className="h-4 w-4 text-amber-500 inline" />
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${e.id}-d`} className="bg-admin-bg/50">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
                              <div><span className="text-admin-ink-muted">Event ID:</span> <span className="font-mono">{e.event_id ?? "—"}</span></div>
                              <div><span className="text-admin-ink-muted">Estado:</span> {e.state ?? "—"}</div>
                              <div><span className="text-admin-ink-muted">Processado em:</span> {e.processed_at ? fmtDate(e.processed_at) : "—"}</div>
                              <div><span className="text-admin-ink-muted">Notas:</span> {e.notes ?? "—"}</div>
                            </div>
                            <pre className="text-[11px] bg-admin-surface-2 border border-admin-border rounded p-2 overflow-x-auto max-h-64">
{JSON.stringify(e.payload, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="text-[11px] text-admin-ink-muted leading-relaxed">
          <strong>Casado</strong> / <strong>PDV casado</strong>: pagamento reconhecido e baixa efetuada automaticamente.{" "}
          <strong>Sem match</strong>: evento recebido sem referência do site (ex.: depósito direto na conta Wise).{" "}
          <strong>Valor menor/maior</strong>: referência casou mas o valor divergiu — revisão manual.{" "}
          <strong>Assinatura</strong>: verde = chave pública configurada e verificada; âmbar = chave pública ainda não configurada.
        </div>
      </DialogContent>
    </Dialog>
  );
}
