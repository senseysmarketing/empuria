import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { BentoCard } from "@/components/admin/BentoCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createFinanceAccount,
  createFinanceCategory,
  createFinanceRecurringRule,
  createFinanceTransaction,
  generateFinanceRecurringForMonth,
  getFinanceOverview,
  listFinanceMeta,
  listFinanceRecurringRules,
  listFinanceTransactions,
  toggleFinanceRecurringRule,
  updateFinanceTransactionStatus,
  type FinanceAccount,
  type FinanceCategory,
  type FinanceRecurringRule,
  type FinanceTransaction,
} from "@/lib/admin/financeiro.functions";

export const Route = createFileRoute("/_authenticated/admin/financeiro")({
  component: FinanceiroPage,
});

const STATUS_LABEL: Record<string, string> = {
  planned: "Planejado",
  pending: "Pendente",
  received: "Recebido",
  paid: "Pago",
  overdue: "Vencido",
  canceled: "Cancelado",
};

const ORIGIN_LABEL: Record<string, string> = {
  manual: "Manual",
  pdv: "PDV",
  orders: "Esteira",
};

function defaultMonth() {
  return new Date().toISOString().slice(0, 7);
}

function money(cents: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function statusClass(status: string) {
  if (status === "received" || status === "paid") return "bg-emerald-100 text-emerald-900";
  if (status === "canceled") return "bg-slate-200 text-slate-700";
  if (status === "overdue") return "bg-red-100 text-red-900";
  return "bg-amber-100 text-amber-900";
}

function FinanceiroPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(defaultMonth());
  const [tab, setTab] = useState("resumo");
  const [filters, setFilters] = useState({
    search: "",
    type: "all",
    status: "all",
    sourceModule: "all",
  });

  const fetchMeta = useServerFn(listFinanceMeta);
  const fetchOverview = useServerFn(getFinanceOverview);
  const fetchTransactions = useServerFn(listFinanceTransactions);
  const fetchRecurring = useServerFn(listFinanceRecurringRules);
  const createTx = useServerFn(createFinanceTransaction);
  const updateTxStatus = useServerFn(updateFinanceTransactionStatus);
  const createRule = useServerFn(createFinanceRecurringRule);
  const toggleRule = useServerFn(toggleFinanceRecurringRule);
  const generateRecurring = useServerFn(generateFinanceRecurringForMonth);
  const createCategory = useServerFn(createFinanceCategory);
  const createAccount = useServerFn(createFinanceAccount);

  const metaQ = useQuery({ queryKey: ["finance-meta"], queryFn: () => fetchMeta() });
  const overviewQ = useQuery({
    queryKey: ["finance-overview", month],
    queryFn: () => fetchOverview({ data: { month } }),
  });
  const transactionsQ = useQuery({
    queryKey: ["finance-transactions", month, filters],
    queryFn: () =>
      fetchTransactions({
        data: {
          month,
          search: filters.search || undefined,
          type: filters.type as "all" | "income" | "expense",
          status: filters.status as
            | "all"
            | "planned"
            | "pending"
            | "received"
            | "paid"
            | "overdue"
            | "canceled",
          sourceModule: filters.sourceModule === "all" ? undefined : filters.sourceModule,
          page: 0,
          pageSize: 60,
        },
      }),
  });
  const recurringQ = useQuery({
    queryKey: ["finance-recurring"],
    queryFn: () => fetchRecurring() as Promise<FinanceRecurringRule[]>,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["finance-overview"] });
    qc.invalidateQueries({ queryKey: ["finance-transactions"] });
    qc.invalidateQueries({ queryKey: ["finance-recurring"] });
    qc.invalidateQueries({ queryKey: ["finance-meta"] });
  };

  const statusMutation = useMutation({
    mutationFn: (data: { id: string; status: "received" | "paid" | "canceled" }) =>
      updateTxStatus({ data }),
    onSuccess: () => {
      toast.success("Lancamento atualizado");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao atualizar lancamento"),
  });

  const generateMutation = useMutation({
    mutationFn: () => generateRecurring({ data: { month } }),
    onSuccess: (result) => {
      toast.success(`${result.inserted} recorrencia(s) verificadas para o mes`);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao gerar recorrencias"),
  });

  const categories = metaQ.data?.categories ?? [];
  const accounts = metaQ.data?.accounts ?? [];
  const overview = overviewQ.data;
  const transactions = useMemo(
    () => (transactionsQ.data?.rows ?? []) as FinanceTransaction[],
    [transactionsQ.data?.rows],
  );
  const isLoading = overviewQ.isLoading || transactionsQ.isLoading || metaQ.isLoading;

  const originOptions = useMemo(() => {
    const set = new Set(transactions.map((tx) => tx.source_module));
    return Array.from(set).sort();
  }, [transactions]);
  const loadError = metaQ.error ?? overviewQ.error ?? transactionsQ.error ?? recurringQ.error;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-admin-accent/15">
            <WalletCards className="h-6 w-6 text-admin-accent" />
          </div>
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">Financeiro & Caixa</h1>
            <p className="mt-1 text-sm text-admin-ink-muted">
              Controle mensal de entradas, saidas, contas e recorrencias.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || defaultMonth())}
            className="w-40 bg-admin-surface"
          />
          <Button variant="outline" onClick={refresh} disabled={isLoading} className="gap-2">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Atualizar
          </Button>
          <NewTransactionDialog
            categories={categories}
            accounts={accounts}
            createTx={createTx}
            onDone={refresh}
          />
          <NewRecurringDialog
            categories={categories}
            accounts={accounts}
            createRule={createRule}
            onDone={refresh}
          />
          <FinanceSettingsDialog
            createCategory={createCategory}
            createAccount={createAccount}
            onDone={refresh}
          />
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="bg-admin-surface border border-admin-border">
          <TabsTrigger
            value="resumo"
            className="data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            Resumo
          </TabsTrigger>
          <TabsTrigger
            value="lancamentos"
            className="data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            Lancamentos
          </TabsTrigger>
          <TabsTrigger
            value="recorrencias"
            className="data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            Recorrencias
          </TabsTrigger>
        </TabsList>

        {loadError && (
          <BentoCard padded>
            <div className="space-y-2">
              <h2 className="font-display text-lg font-semibold text-red-800">
                Erro ao carregar financeiro
              </h2>
              <p className="text-sm text-admin-ink-muted">
                Nao foi possivel buscar os dados do caixa agora. Atualize a tela ou revise a conexao
                com o Supabase.
              </p>
              <p className="text-xs text-red-700">
                {loadError instanceof Error ? loadError.message : "Falha desconhecida"}
              </p>
            </div>
          </BentoCard>
        )}

        <TabsContent value="resumo" className="mt-0 space-y-4">
          <div className="grid grid-cols-12 gap-4">
            <MetricCard
              label="Recebido"
              value={money(overview?.totals.received ?? 0)}
              icon={ArrowUpCircle}
              tone="green"
            />
            <MetricCard
              label="A receber"
              value={money(overview?.totals.receivable ?? 0)}
              icon={CalendarClock}
              tone="amber"
            />
            <MetricCard
              label="Pago"
              value={money(overview?.totals.paid ?? 0)}
              icon={ArrowDownCircle}
              tone="red"
            />
            <MetricCard
              label="A pagar"
              value={money(overview?.totals.payable ?? 0)}
              icon={CalendarClock}
              tone="amber"
            />
            <MetricCard
              label="Saldo realizado"
              value={money(overview?.totals.realizedBalance ?? 0)}
              icon={WalletCards}
              tone="blue"
            />
            <MetricCard
              label="Saldo projetado"
              value={money(overview?.totals.projectedBalance ?? 0)}
              icon={WalletCards}
              tone="slate"
            />

            <BentoCard title="Pendencias do mes" className="col-span-12 lg:col-span-5">
              <TransactionList
                rows={overview?.pending ?? []}
                empty="Nenhuma pendencia para o mes."
              />
            </BentoCard>
            <BentoCard title="Origem dos valores" className="col-span-12 lg:col-span-4">
              <Breakdown rows={overview?.byOrigin ?? []} />
            </BentoCard>
            <BentoCard title="Despesas por categoria" className="col-span-12 lg:col-span-3">
              <Breakdown rows={overview?.expenseByCategory ?? []} expense />
            </BentoCard>
            <BentoCard title="Ultimos lancamentos" className="col-span-12">
              <TransactionTable
                rows={(overview?.recent ?? []) as FinanceTransaction[]}
                onStatus={(id, status) => statusMutation.mutate({ id, status })}
                compact
              />
            </BentoCard>
          </div>
        </TabsContent>

        <TabsContent value="lancamentos" className="mt-0 space-y-4">
          <BentoCard padded>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_150px_160px_170px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-ink-muted" />
                <Input
                  value={filters.search}
                  onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                  placeholder="Buscar por descricao"
                  className="pl-9 bg-admin-surface"
                />
              </div>
              <Select
                value={filters.type}
                onValueChange={(v) => setFilters((p) => ({ ...p, type: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos tipos</SelectItem>
                  <SelectItem value="income">Entradas</SelectItem>
                  <SelectItem value="expense">Saidas</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.status}
                onValueChange={(v) => setFilters((p) => ({ ...p, status: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos status</SelectItem>
                  {Object.entries(STATUS_LABEL).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.sourceModule}
                onValueChange={(v) => setFilters((p) => ({ ...p, sourceModule: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas origens</SelectItem>
                  {originOptions.map((origin) => (
                    <SelectItem key={origin} value={origin}>
                      {ORIGIN_LABEL[origin] ?? origin}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </BentoCard>
          <BentoCard title={`${transactionsQ.data?.count ?? 0} lancamento(s)`}>
            {transactionsQ.isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
              </div>
            ) : (
              <TransactionTable
                rows={transactions}
                onStatus={(id, status) => statusMutation.mutate({ id, status })}
              />
            )}
          </BentoCard>
        </TabsContent>

        <TabsContent value="recorrencias" className="mt-0 space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="gap-2"
            >
              {generateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Gerar mes selecionado
            </Button>
          </div>
          <BentoCard title="Regras recorrentes">
            {recurringQ.isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
              </div>
            ) : (
              <RecurringTable
                rows={recurringQ.data ?? []}
                onToggle={(id, isActive) =>
                  toggleRule({ data: { id, isActive } }).then(() => {
                    toast.success("Recorrencia atualizada");
                    refresh();
                  })
                }
              />
            )}
          </BentoCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof WalletCards;
  tone: "green" | "amber" | "red" | "blue" | "slate";
}) {
  const tones = {
    green: "text-emerald-700 bg-emerald-100",
    amber: "text-amber-800 bg-amber-100",
    red: "text-red-800 bg-red-100",
    blue: "text-blue-800 bg-blue-100",
    slate: "text-slate-700 bg-slate-100",
  };
  return (
    <BentoCard className="col-span-12 sm:col-span-6 lg:col-span-2" padded>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-admin-ink-muted">{label}</p>
          <p className="mt-2 font-display text-2xl font-bold text-admin-ink">{value}</p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </BentoCard>
  );
}

function TransactionList({ rows, empty }: { rows: FinanceTransaction[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-admin-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((tx) => (
        <li
          key={tx.id}
          className="flex items-start justify-between gap-3 border-b border-admin-border pb-3 last:border-0"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-admin-ink">{tx.description}</p>
            <p className="text-xs text-admin-ink-muted">
              {tx.due_date} · {tx.category_name ?? "Sem categoria"}
            </p>
          </div>
          <span className={tx.type === "income" ? "text-emerald-700" : "text-red-700"}>
            {money(tx.amount_cents, tx.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Breakdown({
  rows,
  expense = false,
}: {
  rows: { label: string; amount_cents: number }[];
  expense?: boolean;
}) {
  if (!rows.length) return <p className="text-sm text-admin-ink-muted">Sem dados no periodo.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center justify-between gap-3">
          <span className="truncate text-sm text-admin-ink">
            {ORIGIN_LABEL[row.label] ?? row.label}
          </span>
          <span
            className={`text-sm font-medium ${expense || row.amount_cents < 0 ? "text-red-700" : "text-emerald-700"}`}
          >
            {money(Math.abs(row.amount_cents))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TransactionTable({
  rows,
  onStatus,
  compact = false,
}: {
  rows: FinanceTransaction[];
  onStatus: (id: string, status: "received" | "paid" | "canceled") => void;
  compact?: boolean;
}) {
  if (!rows.length)
    return <p className="text-sm text-admin-ink-muted">Nenhum lancamento encontrado.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-admin-ink-muted">
          <tr className="border-b border-admin-border">
            <th className="py-3 pr-3">Descricao</th>
            <th className="py-3 pr-3">Origem</th>
            <th className="py-3 pr-3">Vencimento</th>
            <th className="py-3 pr-3">Status</th>
            <th className="py-3 pr-3 text-right">Valor</th>
            {!compact && <th className="py-3 pl-3 text-right">Acoes</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((tx) => {
            const payableStatus = tx.type === "income" ? "received" : "paid";
            const canSettle =
              !tx.is_automatic && !["received", "paid", "canceled"].includes(tx.status);
            return (
              <tr key={tx.id} className="border-b border-admin-border last:border-0">
                <td className="max-w-[260px] py-3 pr-3">
                  <p className="truncate font-medium text-admin-ink">{tx.description}</p>
                  <p className="truncate text-xs text-admin-ink-muted">
                    {tx.category_name ?? "Sem categoria"} · {tx.account_name ?? "Sem conta"}
                  </p>
                </td>
                <td className="py-3 pr-3">
                  <Badge variant="outline">
                    {ORIGIN_LABEL[tx.source_module] ?? tx.source_module}
                  </Badge>
                </td>
                <td className="py-3 pr-3 text-admin-ink-muted">{tx.due_date}</td>
                <td className="py-3 pr-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs ${statusClass(tx.status)}`}
                  >
                    {STATUS_LABEL[tx.status] ?? tx.status}
                  </span>
                </td>
                <td
                  className={`py-3 pr-3 text-right font-medium ${tx.type === "income" ? "text-emerald-700" : "text-red-700"}`}
                >
                  {tx.type === "income" ? "+" : "-"} {money(tx.amount_cents, tx.currency)}
                </td>
                {!compact && (
                  <td className="py-3 pl-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canSettle}
                        onClick={() => onStatus(tx.id, payableStatus)}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={tx.is_automatic || tx.status === "canceled"}
                        onClick={() => onStatus(tx.id, "canceled")}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecurringTable({
  rows,
  onToggle,
}: {
  rows: FinanceRecurringRule[];
  onToggle: (id: string, isActive: boolean) => void;
}) {
  if (!rows.length)
    return <p className="text-sm text-admin-ink-muted">Nenhuma recorrencia cadastrada.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-admin-ink-muted">
          <tr className="border-b border-admin-border">
            <th className="py-3 pr-3">Descricao</th>
            <th className="py-3 pr-3">Frequencia</th>
            <th className="py-3 pr-3">Dia</th>
            <th className="py-3 pr-3">Categoria</th>
            <th className="py-3 pr-3 text-right">Valor</th>
            <th className="py-3 pl-3 text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((rule) => (
            <tr key={rule.id} className="border-b border-admin-border last:border-0">
              <td className="py-3 pr-3 font-medium text-admin-ink">{rule.description}</td>
              <td className="py-3 pr-3 text-admin-ink-muted">{rule.frequency}</td>
              <td className="py-3 pr-3 text-admin-ink-muted">{rule.day_of_month}</td>
              <td className="py-3 pr-3 text-admin-ink-muted">
                {rule.category_name ?? "Sem categoria"}
              </td>
              <td
                className={`py-3 pr-3 text-right font-medium ${rule.type === "income" ? "text-emerald-700" : "text-red-700"}`}
              >
                {money(rule.amount_cents, rule.currency)}
              </td>
              <td className="py-3 pl-3 text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onToggle(rule.id, !rule.is_active)}
                >
                  {rule.is_active ? "Ativa" : "Pausada"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NewTransactionDialog({
  categories,
  accounts,
  createTx,
  onDone,
}: {
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  createTx: ReturnType<typeof useServerFn<typeof createFinanceTransaction>>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"income" | "expense">("income");
  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      createTx({
        data: {
          type,
          description: String(form.get("description") ?? ""),
          amount: Number(form.get("amount") ?? 0),
          currency: String(form.get("currency") ?? "BRL") as "BRL" | "EUR" | "USD",
          dueDate: String(form.get("dueDate") ?? ""),
          status: String(form.get("status") ?? "pending") as
            | "planned"
            | "pending"
            | "received"
            | "paid",
          categoryId: emptyToNull(form.get("categoryId")),
          accountId: emptyToNull(form.get("accountId")),
          paymentMethod: emptyToNull(form.get("paymentMethod")),
          notes: emptyToNull(form.get("notes")),
        },
      }),
    onSuccess: () => {
      toast.success("Lancamento criado");
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar lancamento"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> Novo lancamento
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo lancamento</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(new FormData(e.currentTarget));
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select value={type} onValueChange={(v) => setType(v as "income" | "expense")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Entrada</SelectItem>
                  <SelectItem value="expense">Saida</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select name="status" defaultValue="pending">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planejado</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value={type === "income" ? "received" : "paid"}>
                    {type === "income" ? "Recebido" : "Pago"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Descricao">
            <Input name="description" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor">
              <Input name="amount" type="number" min="0" step="0.01" required />
            </Field>
            <Field label="Moeda">
              <Select name="currency" defaultValue="BRL">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">BRL</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Vencimento">
            <Input
              name="dueDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </Field>
          <CategoryAccountFields categories={categories} accounts={accounts} type={type} />
          <Field label="Metodo">
            <Input name="paymentMethod" placeholder="dinheiro, cartao, pix, transferencia..." />
          </Field>
          <Field label="Observacoes">
            <Textarea name="notes" />
          </Field>
          <Button type="submit" disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? "Salvando..." : "Salvar lancamento"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewRecurringDialog({
  categories,
  accounts,
  createRule,
  onDone,
}: {
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  createRule: ReturnType<typeof useServerFn<typeof createFinanceRecurringRule>>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"income" | "expense">("expense");
  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      createRule({
        data: {
          type,
          description: String(form.get("description") ?? ""),
          amount: Number(form.get("amount") ?? 0),
          currency: String(form.get("currency") ?? "BRL") as "BRL" | "EUR" | "USD",
          categoryId: emptyToNull(form.get("categoryId")),
          accountId: emptyToNull(form.get("accountId")),
          frequency: String(form.get("frequency") ?? "monthly") as "monthly" | "weekly" | "yearly",
          dayOfMonth: Number(form.get("dayOfMonth") ?? 1),
        },
      }),
    onSuccess: () => {
      toast.success("Recorrencia criada");
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar recorrencia"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <CalendarClock className="h-4 w-4" /> Nova recorrencia
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova recorrencia</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(new FormData(e.currentTarget));
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select value={type} onValueChange={(v) => setType(v as "income" | "expense")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Entrada</SelectItem>
                  <SelectItem value="expense">Saida</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Frequencia">
              <Select name="frequency" defaultValue="monthly">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Mensal</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="yearly">Anual</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Descricao">
            <Input name="description" required />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Valor">
              <Input name="amount" type="number" min="0" step="0.01" required />
            </Field>
            <Field label="Moeda">
              <Select name="currency" defaultValue="BRL">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">BRL</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Dia">
              <Input name="dayOfMonth" type="number" min="1" max="31" defaultValue="1" />
            </Field>
          </div>
          <CategoryAccountFields categories={categories} accounts={accounts} type={type} />
          <Button type="submit" disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? "Salvando..." : "Salvar recorrencia"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FinanceSettingsDialog({
  createCategory,
  createAccount,
  onDone,
}: {
  createCategory: ReturnType<typeof useServerFn<typeof createFinanceCategory>>;
  createAccount: ReturnType<typeof useServerFn<typeof createFinanceAccount>>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const categoryMutation = useMutation({
    mutationFn: (form: FormData) =>
      createCategory({
        data: {
          name: String(form.get("name") ?? ""),
          type: String(form.get("type") ?? "both") as "income" | "expense" | "both",
        },
      }),
    onSuccess: () => {
      toast.success("Categoria criada");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar categoria"),
  });
  const accountMutation = useMutation({
    mutationFn: (form: FormData) =>
      createAccount({
        data: {
          name: String(form.get("name") ?? ""),
          type: String(form.get("type") ?? "cash") as
            | "cash"
            | "bank"
            | "card"
            | "gateway"
            | "other",
          currency: String(form.get("currency") ?? "BRL") as "BRL" | "EUR" | "USD",
        },
      }),
    onSuccess: () => {
      toast.success("Conta criada");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar conta"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Settings className="h-4 w-4" /> Configurar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Categorias e contas</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-2">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              categoryMutation.mutate(new FormData(e.currentTarget));
              e.currentTarget.reset();
            }}
          >
            <h3 className="font-display text-sm uppercase tracking-wide text-admin-ink-muted">
              Categoria
            </h3>
            <Field label="Nome">
              <Input name="name" required />
            </Field>
            <Field label="Tipo">
              <Select name="type" defaultValue="both">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Entrada</SelectItem>
                  <SelectItem value="expense">Saida</SelectItem>
                  <SelectItem value="both">Ambos</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" variant="outline" className="w-full">
              Criar categoria
            </Button>
          </form>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              accountMutation.mutate(new FormData(e.currentTarget));
              e.currentTarget.reset();
            }}
          >
            <h3 className="font-display text-sm uppercase tracking-wide text-admin-ink-muted">
              Conta ou caixa
            </h3>
            <Field label="Nome">
              <Input name="name" required />
            </Field>
            <Field label="Tipo">
              <Select name="type" defaultValue="cash">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Caixa</SelectItem>
                  <SelectItem value="bank">Banco</SelectItem>
                  <SelectItem value="card">Cartao</SelectItem>
                  <SelectItem value="gateway">Gateway</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Moeda">
              <Select name="currency" defaultValue="BRL">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">BRL</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" variant="outline" className="w-full">
              Criar conta
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoryAccountFields({
  categories,
  accounts,
  type,
}: {
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  type: "income" | "expense";
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Categoria">
        <Select name="categoryId">
          <SelectTrigger>
            <SelectValue placeholder="Selecionar" />
          </SelectTrigger>
          <SelectContent>
            {categories
              .filter((c) => c.type === type || c.type === "both")
              .map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Conta">
        <Select name="accountId">
          <SelectTrigger>
            <SelectValue placeholder="Selecionar" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function emptyToNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}
