import { useState, useEffect, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2, AlertTriangle, Search, ArrowUpDown, ShoppingCart, Store } from "lucide-react";
import { BentoCard } from "@/components/admin/BentoCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  getReportsHistorico,
  type ReportFilters,
  type HistoricoFilters,
} from "@/lib/admin/reports.functions";

function money(cents: number, currency = "EUR") {
  return new Intl.NumberFormat(currency === "EUR" ? "de-DE" : "pt-BR", {
    style: "currency",
    currency,
  }).format((cents ?? 0) / 100);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  paid: "Pago",
  pending: "Pendente",
  cancelled: "Cancelado",
  voided: "Anulado",
};

const STATUS_TONE: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-800 border-emerald-200",
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
  voided: "bg-zinc-200 text-zinc-700 border-zinc-300",
};

export function HistoricoTab({ filters }: { filters: ReportFilters }) {
  const fetchFn = useServerFn(getReportsHistorico);

  const [source, setSource] = useState<"all" | "esteira" | "pdv">("all");
  const [status, setStatus] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [source, status, search, sortBy, sortDir, pageSize, filters.period, filters.from, filters.to]);

  const queryInput: HistoricoFilters = useMemo(
    () => ({
      ...filters,
      source,
      status: status === "all" ? undefined : status,
      search: search || undefined,
      sortBy,
      sortDir,
      page,
      pageSize,
    }),
    [filters, source, status, search, sortBy, sortDir, page, pageSize],
  );

  const q = useQuery({
    queryKey: ["reports-historico", queryInput],
    queryFn: () => fetchFn({ data: queryInput }),
    placeholderData: keepPreviousData,
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const start = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const end = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  const toggleSort = (col: "date" | "amount") => {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  return (
    <div className="space-y-4">
      <BentoCard padded>
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
          <div className="relative md:flex-1 md:min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-admin-ink-muted" />
            <Input
              placeholder="Buscar por referência, cliente, email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 bg-admin-bg"
            />
          </div>
          <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
            <SelectTrigger className="bg-admin-bg w-full md:w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas origens</SelectItem>
              <SelectItem value="esteira">Esteira</SelectItem>
              <SelectItem value="pdv">PDV</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="bg-admin-bg w-full md:w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              <SelectItem value="paid">Pago</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
              <SelectItem value="voided">Anulado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="bg-admin-bg w-full md:w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[20, 50, 100, 200].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} por pág.
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </BentoCard>

      <BentoCard padded>
        {q.isLoading && !data ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
          </div>
        ) : q.error ? (
          <div className="flex items-start gap-3 text-red-800">
            <AlertTriangle className="h-5 w-5 mt-0.5" />
            <p className="text-sm">
              {q.error instanceof Error ? q.error.message : "Erro ao carregar histórico"}
            </p>
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-admin-ink-muted">
            Nenhum pedido encontrado no período/filtros selecionados.
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between text-xs text-admin-ink-muted">
              <span>
                Mostrando <strong>{start}</strong>–<strong>{end}</strong> de{" "}
                <strong>{data.total}</strong> pedidos
              </span>
              <span>
                Total no período: <strong className="text-admin-ink">{money(data.totalAmount)}</strong>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-admin-border text-left text-xs uppercase text-admin-ink-muted">
                    <th className="py-2 pr-4">
                      <button
                        onClick={() => toggleSort("date")}
                        className="inline-flex items-center gap-1 hover:text-admin-ink"
                      >
                        Data <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="py-2 pr-4">Origem</th>
                    <th className="py-2 pr-4">Referência</th>
                    <th className="py-2 pr-4">Cliente</th>
                    <th className="py-2 pr-4">Descrição</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Método</th>
                    <th className="py-2 pr-4 text-right">
                      <button
                        onClick={() => toggleSort("amount")}
                        className="inline-flex items-center gap-1 hover:text-admin-ink"
                      >
                        Valor <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr
                      key={`${r.source}-${r.id}`}
                      className="border-b border-admin-border/60 hover:bg-admin-bg/40"
                    >
                      <td className="py-2 pr-4 tabular-nums whitespace-nowrap">
                        {fmtDate(r.created_at)}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant="outline"
                          className={
                            r.source === "pdv"
                              ? "border-blue-200 bg-blue-50 text-blue-800"
                              : "border-orange-200 bg-orange-50 text-orange-800"
                          }
                        >
                          {r.source === "pdv" ? (
                            <Store className="h-3 w-3 mr-1" />
                          ) : (
                            <ShoppingCart className="h-3 w-3 mr-1" />
                          )}
                          {r.source === "pdv" ? "PDV" : "Esteira"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{r.ref}</td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-col">
                          <span className="text-admin-ink">{r.customer_name ?? "—"}</span>
                          {r.customer_email && (
                            <span className="text-xs text-admin-ink-muted">{r.customer_email}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-admin-ink-muted max-w-[260px] truncate">
                        {r.description}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant="outline"
                          className={STATUS_TONE[r.status] ?? "bg-zinc-100"}
                        >
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-xs text-admin-ink-muted uppercase">
                        {r.payment_method ?? "—"}
                      </td>
                      <td className="py-2 pr-4 text-right font-display tabular-nums">
                        {money(r.total_cents, r.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs text-admin-ink-muted">
                Página {data.page} de {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page <= 1 || q.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page >= totalPages || q.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          </>
        )}
      </BentoCard>
    </div>
  );
}
