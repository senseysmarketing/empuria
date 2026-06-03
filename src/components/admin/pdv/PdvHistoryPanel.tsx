import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Eye, Loader2, Lock, RotateCcw, Search, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  listPdvCashiers,
  listPdvSalesHistory,
  getPdvSale,
  voidPdvSale,
  type PdvAuditRecord,
  type PdvProfileSummary,
  type PdvSaleItemRecord,
  type PdvSaleRecord,
  type PdvStockMovementRecord,
} from "@/lib/admin/pdv-sales.functions";
import { cn } from "@/lib/utils";

type Period = "hoje" | "ontem" | "7d" | "mes" | "custom" | "todos";
type Payment = "todos" | "dinheiro" | "cartao" | "pix";
type Status = "todos" | "concluida" | "cancelada";
type PdvSaleDetail = {
  sale: PdvSaleRecord | null;
  items: PdvSaleItemRecord[];
  customer: PdvProfileSummary | null;
  cashier: PdvProfileSummary | null;
  voided_by_profile: PdvProfileSummary | null;
  stock_movements: PdvStockMovementRecord[];
  audit_events: PdvAuditRecord[];
};

const PAGE_SIZE = 25;

function money(cents: number, currency: "EUR" | "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format((cents ?? 0) / 100);
}

function dateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function paymentLabel(value: string) {
  if (value === "cartao") return "Cartao";
  if (value === "pix") return "Pix";
  return "Dinheiro";
}

function statusBadge(status: string) {
  if (status === "cancelada") {
    return (
      <Badge className="border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/10">
        Anulada
      </Badge>
    );
  }
  return (
    <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/10">
      Concluida
    </Badge>
  );
}

export function PdvHistoryPanel() {
  const listHistory = useServerFn(listPdvSalesHistory);
  const fetchCashiers = useServerFn(listPdvCashiers);
  const fetchSale = useServerFn(getPdvSale);
  const voidSale = useServerFn(voidPdvSale);
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<Period>("7d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<Payment>("todos");
  const [status, setStatus] = useState<Status>("todos");
  const [cashierId, setCashierId] = useState("todos");
  const [page, setPage] = useState(1);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [voidTargetId, setVoidTargetId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const filters = useMemo(
    () => ({
      search,
      period,
      dateFrom: period === "custom" ? dateFrom || null : null,
      dateTo: period === "custom" ? dateTo || null : null,
      paymentMethod,
      status,
      cashierId: cashierId === "todos" ? null : cashierId,
      page,
      pageSize: PAGE_SIZE,
    }),
    [cashierId, dateFrom, dateTo, page, paymentMethod, period, search, status],
  );

  const historyQ = useQuery({
    queryKey: ["pdv-sales-history", filters],
    queryFn: () => listHistory({ data: filters }),
  });

  const cashiersQ = useQuery({
    queryKey: ["pdv-cashiers"],
    queryFn: () => fetchCashiers(),
  });

  const detailQ = useQuery({
    queryKey: ["pdv-sale-detail", selectedSaleId],
    queryFn: () => fetchSale({ data: { saleId: selectedSaleId! } }),
    enabled: Boolean(selectedSaleId),
  });

  const voidMut = useMutation({
    mutationFn: () => voidSale({ data: { saleId: voidTargetId!, reason: voidReason } }),
    onSuccess: () => {
      toast.success("Venda anulada e estoque revertido.");
      setVoidTargetId(null);
      setVoidReason("");
      qc.invalidateQueries({ queryKey: ["pdv-sales-history"] });
      qc.invalidateQueries({ queryKey: ["pdv-sale-detail"] });
      qc.invalidateQueries({ queryKey: ["pdv-catalog"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao anular venda"),
  });

  const data = historyQ.data;
  const detail = detailQ.data as PdvSaleDetail | undefined;
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isAdmin = Boolean(data?.isAdmin);
  const fromLabel = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const toLabel = Math.min(page * PAGE_SIZE, total);
  const selectedSale = rows.find((sale) => sale.id === selectedSaleId);
  const voidTarget = rows.find((sale) => sale.id === voidTargetId) ?? selectedSale;

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-admin-border bg-admin-surface p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_150px_150px_150px_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-ink-muted" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPage();
              }}
              placeholder="Buscar codigo, cliente, telefone, operador..."
              className="h-11 border-admin-border bg-admin-bg pl-9"
            />
          </div>

          <Select
            value={period}
            onValueChange={(value: Period) => {
              setPeriod(value);
              resetPage();
            }}
          >
            <SelectTrigger className="h-11 border-admin-border bg-admin-bg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="ontem">Ontem</SelectItem>
              <SelectItem value="7d">Ultimos 7 dias</SelectItem>
              <SelectItem value="mes">Este mes</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={paymentMethod}
            onValueChange={(value: Payment) => {
              setPaymentMethod(value);
              resetPage();
            }}
          >
            <SelectTrigger className="h-11 border-admin-border bg-admin-bg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Pagamento</SelectItem>
              <SelectItem value="dinheiro">Dinheiro</SelectItem>
              <SelectItem value="cartao">Cartao</SelectItem>
              <SelectItem value="pix">Pix</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={status}
            onValueChange={(value: Status) => {
              setStatus(value);
              resetPage();
            }}
          >
            <SelectTrigger className="h-11 border-admin-border bg-admin-bg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Status</SelectItem>
              <SelectItem value="concluida">Concluida</SelectItem>
              <SelectItem value="cancelada">Anulada</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={cashierId}
            onValueChange={(value) => {
              setCashierId(value);
              resetPage();
            }}
          >
            <SelectTrigger className="h-11 border-admin-border bg-admin-bg">
              <SelectValue placeholder="Operador" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos operadores</SelectItem>
              {(cashiersQ.data ?? []).map((cashier) => (
                <SelectItem key={cashier.id} value={cashier.id}>
                  {cashier.full_name ?? "Sem nome"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {period === "custom" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-admin-ink-muted">Data inicial</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  resetPage();
                }}
                className="border-admin-border bg-admin-bg"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-admin-ink-muted">Data final</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  resetPage();
                }}
                className="border-admin-border bg-admin-bg"
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-admin-border bg-admin-surface shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-admin-border p-4">
          <div>
            <h2 className="font-display text-lg text-admin-ink">Historico de vendas</h2>
            <p className="text-xs text-admin-ink-muted">
              Consulta operacional, conferencia de caixa e auditoria de anulacoes.
            </p>
          </div>
          {historyQ.isFetching && <Loader2 className="h-5 w-5 animate-spin text-admin-accent" />}
        </div>

        {historyQ.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full bg-admin-bg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <CalendarClock className="h-10 w-10 text-admin-ink-muted" />
            <p className="font-medium text-admin-ink">Nenhuma venda encontrada</p>
            <p className="max-w-md text-sm text-admin-ink-muted">
              Ajuste os filtros ou volte para a aba Venda para registrar uma nova venda no caixa.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-admin-border hover:bg-transparent">
                <TableHead>Codigo</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Operador</TableHead>
                <TableHead className="text-center">Itens</TableHead>
                <TableHead className="text-right">Total EUR</TableHead>
                <TableHead className="text-right">Total R$</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((sale) => (
                <TableRow key={sale.id} className="border-admin-border">
                  <TableCell className="font-mono text-xs text-admin-accent">
                    {sale.sale_code}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {dateTime(sale.closed_at)}
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[180px] truncate font-medium">
                      {sale.customer?.full_name ?? "Cliente sem nome"}
                    </div>
                    <div className="max-w-[180px] truncate text-xs text-admin-ink-muted">
                      {sale.customer?.phone ?? "-"}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate">
                    {sale.cashier?.full_name ?? "Operador"}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">{sale.item_count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(sale.total_eur_cents, "EUR")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(sale.total_brl_cents, "BRL")}
                  </TableCell>
                  <TableCell>{paymentLabel(sale.payment_method)}</TableCell>
                  <TableCell>{statusBadge(sale.status)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-admin-border"
                        onClick={() => setSelectedSaleId(sale.id)}
                      >
                        <Eye className="h-3.5 w-3.5" /> Detalhes
                      </Button>
                      {isAdmin ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-red-500/30 text-red-400 hover:bg-red-500/10"
                          disabled={sale.status === "cancelada"}
                          onClick={() => setVoidTargetId(sale.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Anular
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-admin-border text-admin-ink-muted"
                          disabled
                          title="Apenas administradores podem anular vendas."
                        >
                          <Lock className="h-3.5 w-3.5" /> Anular
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-3 border-t border-admin-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-admin-ink-muted">
            Mostrando {fromLabel}-{toLabel} de {total} vendas
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="border-admin-border"
              disabled={page <= 1 || historyQ.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              className="border-admin-border"
              disabled={page >= totalPages || historyQ.isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              Proxima
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={Boolean(selectedSaleId)}
        onOpenChange={(open) => !open && setSelectedSaleId(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto border-admin-border bg-admin-surface text-admin-ink">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              Venda {detail?.sale?.sale_code ?? selectedSale?.sale_code ?? ""}
            </DialogTitle>
            <DialogDescription>
              Detalhes completos da venda, itens, estoque e auditoria.
            </DialogDescription>
          </DialogHeader>

          {detailQ.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 bg-admin-bg" />
              <Skeleton className="h-48 bg-admin-bg" />
            </div>
          ) : detail?.sale ? (
            <SaleDetailsContent
              detail={detail}
              isAdmin={isAdmin}
              onVoid={() => setVoidTargetId(detail.sale!.id)}
            />
          ) : (
            <p className="text-sm text-admin-ink-muted">Nao foi possivel carregar esta venda.</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(voidTargetId)} onOpenChange={(open) => !open && setVoidTargetId(null)}>
        <DialogContent className="max-w-lg border-admin-border bg-admin-surface text-admin-ink">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-2xl">
              <ShieldAlert className="h-5 w-5 text-red-400" /> Anular venda
            </DialogTitle>
            <DialogDescription>
              Esta acao nao apaga o registro. A venda sera marcada como anulada, o estoque sera
              revertido e a auditoria sera registrada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-admin-border bg-admin-bg p-3 text-sm">
              <div className="font-mono text-admin-accent">{voidTarget?.sale_code ?? ""}</div>
              <div className="text-admin-ink-muted">
                {voidTarget?.customer?.full_name ?? detail?.customer?.full_name ?? "Cliente"}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Motivo da anulacao</Label>
              <Textarea
                value={voidReason}
                onChange={(event) => setVoidReason(event.target.value)}
                placeholder="Ex.: venda registrada em duplicidade, erro de item ou correcao de caixa."
                className="min-h-28 border-admin-border bg-admin-bg"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setVoidTargetId(null)}>
                Cancelar
              </Button>
              <Button
                className="bg-red-500 text-white hover:bg-red-600"
                disabled={voidReason.trim().length < 5 || voidMut.isPending}
                onClick={() => voidMut.mutate()}
              >
                {voidMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Anular venda
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaleDetailsContent({
  detail,
  isAdmin,
  onVoid,
}: {
  detail: PdvSaleDetail;
  isAdmin: boolean;
  onVoid: () => void;
}) {
  const sale = detail.sale!;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <DetailTile
          label="Cliente"
          value={detail.customer?.full_name ?? "Sem nome"}
          sub={detail.customer?.phone}
        />
        <DetailTile label="Operador" value={detail.cashier?.full_name ?? "Operador"} />
        <DetailTile
          label="Pagamento"
          value={paymentLabel(sale.payment_method)}
          sub={dateTime(sale.closed_at)}
        />
        <DetailTile label="Status" value={sale.status === "cancelada" ? "Anulada" : "Concluida"} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <DetailTile label="Subtotal EUR" value={money(sale.subtotal_eur_cents, "EUR")} />
        <DetailTile label="Desconto EUR" value={money(sale.discount_eur_cents, "EUR")} />
        <DetailTile label="Total EUR" value={money(sale.total_eur_cents, "EUR")} accent />
        <DetailTile label="Total R$" value={money(sale.total_brl_cents, "BRL")} accent />
      </div>

      {sale.status === "cancelada" && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">
          <div className="font-medium text-red-300">Venda anulada</div>
          <div className="text-admin-ink-muted">
            {dateTime(sale.voided_at)} por {detail.voided_by_profile?.full_name ?? "admin"}
          </div>
          {sale.void_reason && <div className="mt-2 text-admin-ink">{sale.void_reason}</div>}
        </div>
      )}

      <section className="space-y-2">
        <h3 className="font-display text-sm uppercase tracking-wider text-admin-ink-muted">
          Itens
        </h3>
        <div className="rounded-lg border border-admin-border">
          <Table>
            <TableHeader>
              <TableRow className="border-admin-border hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead className="text-center">Qtd</TableHead>
                <TableHead className="text-right">Unit EUR</TableHead>
                <TableHead className="text-right">Unit R$</TableHead>
                <TableHead className="text-right">Total EUR</TableHead>
                <TableHead className="text-right">Total R$</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.items.map((item) => (
                <TableRow key={item.id} className="border-admin-border">
                  <TableCell>
                    <span className="mr-2">{item.product_emoji_snapshot ?? ""}</span>
                    {item.product_name_snapshot}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">{item.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(item.unit_price_eur_cents, "EUR")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(item.unit_price_brl_cents, "BRL")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(item.total_eur_cents, "EUR")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(item.total_brl_cents, "BRL")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {sale.notes && (
        <section className="rounded-lg border border-admin-border bg-admin-bg p-3 text-sm">
          <div className="mb-1 font-display text-xs uppercase tracking-wider text-admin-ink-muted">
            Notas
          </div>
          {sale.notes}
        </section>
      )}

      <section className="grid gap-3 lg:grid-cols-2">
        <AuditBox title="Estoque" empty="Nenhuma movimentacao de estoque vinculada.">
          {detail.stock_movements.map((movement) => (
            <TimelineLine
              key={movement.id}
              title={`${movement.type} de ${movement.quantity} unidade(s)`}
              subtitle={`${movement.previous_stock} -> ${movement.new_stock}`}
              date={movement.created_at}
              muted={movement.reason}
            />
          ))}
        </AuditBox>

        <AuditBox title="Auditoria" empty="Nenhum evento de auditoria encontrado.">
          {detail.audit_events.map((event) => (
            <TimelineLine
              key={event.id}
              title={event.action}
              subtitle={event.module}
              date={event.created_at}
            />
          ))}
        </AuditBox>
      </section>

      <div className="flex justify-end">
        {isAdmin ? (
          <Button
            variant="outline"
            disabled={sale.status === "cancelada"}
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            onClick={onVoid}
          >
            <RotateCcw className="h-4 w-4" /> Anular venda
          </Button>
        ) : (
          <Button variant="outline" disabled className="border-admin-border text-admin-ink-muted">
            <Lock className="h-4 w-4" /> Anulacao restrita a admins
          </Button>
        )}
      </div>
    </div>
  );
}

function DetailTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string | null;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-admin-border bg-admin-bg p-3">
      <div className="text-[10px] uppercase tracking-wider text-admin-ink-muted">{label}</div>
      <div className={cn("mt-1 truncate font-display text-base", accent && "text-admin-accent")}>
        {value}
      </div>
      {sub && <div className="mt-1 truncate text-xs text-admin-ink-muted">{sub}</div>}
    </div>
  );
}

function AuditBox({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode[];
}) {
  return (
    <div className="rounded-lg border border-admin-border bg-admin-bg p-3">
      <h3 className="mb-3 font-display text-sm uppercase tracking-wider text-admin-ink-muted">
        {title}
      </h3>
      {children.length ? (
        <div className="space-y-3">{children}</div>
      ) : (
        <p className="text-sm text-admin-ink-muted">{empty}</p>
      )}
    </div>
  );
}

function TimelineLine({
  title,
  subtitle,
  date,
  muted,
}: {
  title: string;
  subtitle?: string | null;
  date: string;
  muted?: string | null;
}) {
  return (
    <div className="border-l border-admin-border pl-3">
      <div className="text-sm font-medium text-admin-ink">{title}</div>
      {subtitle && <div className="text-xs text-admin-ink-muted">{subtitle}</div>}
      {muted && <div className="text-xs text-admin-ink-muted">{muted}</div>}
      <div className="mt-1 text-[11px] text-admin-ink-muted">{dateTime(date)}</div>
    </div>
  );
}
