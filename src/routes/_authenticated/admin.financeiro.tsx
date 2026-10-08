import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { RestrictedAreaCard } from "@/components/admin/RestrictedAreaCard";
import { useCurrentUser } from "@/hooks/use-current-user";
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
import { NewOrderWizard } from "@/components/admin/esteira/NewOrderWizard";
import { FinanceAccountCombobox } from "@/components/admin/financeiro/FinanceAccountCombobox";
import { SettleTransactionPopover } from "@/components/admin/financeiro/SettleTransactionPopover";
import { FinanceTeamPanel } from "@/components/admin/financeiro/FinanceTeamPanel";
import { FinanceMonthClosePanel } from "@/components/admin/financeiro/FinanceMonthClosePanel";
import { financeOriginLabel } from "@/lib/finance/origins";
import { getFinanceDashboard } from "@/lib/admin/finance-close.functions";
import {
  createFinanceAccount,
  createFinanceCategory,
  createFinanceRecurringRule,
  createFinanceTransaction,
  endFinanceRecurringRule,
  listFinanceMeta,
  listFinanceSettings,
  listFinanceRecurringRules,
  listFinanceTransactions,
  settleFinanceTransaction,
  toggleFinanceRecurringRule,
  updateFinanceRecurringRule,
  deleteFinancePendingTransaction,
  reverseFinanceSettlement,
  manageFinanceAccount,
  manageFinanceCategory,
  type FinanceAccount,
  type FinanceCategory,
  type FinanceRecurringRule,
  type FinanceTransaction,
} from "@/lib/admin/financeiro.functions";

export const Route = createFileRoute("/_authenticated/admin/financeiro")({
  component: FinanceiroPage,
});

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  received: "Recebido",
  paid: "Pago",
  canceled: "Cancelado",
};

function defaultMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
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
  return "bg-amber-100 text-amber-900";
}

function FinanceiroPage() {
  const { isLoading, isAdmin } = useCurrentUser();

  if (isLoading) return null;
  if (!isAdmin) {
    return (
      <RestrictedAreaCard message="Financeiro/Caixa é uma área exclusiva de administradores." />
    );
  }

  return <FinanceiroContent />;
}

function FinanceiroContent() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(defaultMonth());
  const [tab, setTab] = useState("resumo");
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    type: "all",
    status: "all",
    sourceModule: "all",
  });
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  const fetchMeta = useServerFn(listFinanceMeta);
  const fetchTransactions = useServerFn(listFinanceTransactions);
  const fetchRecurring = useServerFn(listFinanceRecurringRules);
  const createTx = useServerFn(createFinanceTransaction);
  const deletePending = useServerFn(deleteFinancePendingTransaction);
  const reverseSettlement = useServerFn(reverseFinanceSettlement);
  const settleTx = useServerFn(settleFinanceTransaction);
  const createRule = useServerFn(createFinanceRecurringRule);
  const updateRule = useServerFn(updateFinanceRecurringRule);
  const endRule = useServerFn(endFinanceRecurringRule);
  const toggleRule = useServerFn(toggleFinanceRecurringRule);
  const createCategory = useServerFn(createFinanceCategory);
  const createAccount = useServerFn(createFinanceAccount);
  const fetchSettings = useServerFn(listFinanceSettings);
  const manageAccount = useServerFn(manageFinanceAccount);
  const manageCategory = useServerFn(manageFinanceCategory);
  const fetchDashboard = useServerFn(getFinanceDashboard);

  const metaQ = useQuery({
    queryKey: ["finance-meta"],
    queryFn: () => fetchMeta(),
    enabled: tab !== "resumo" || newOpen,
    staleTime: 5 * 60_000,
  });
  const settingsQ = useQuery({
    queryKey: ["finance-settings"],
    queryFn: () => fetchSettings(),
    enabled: settingsOpen,
    staleTime: 5 * 60_000,
  });
  const dashboardQ = useQuery({
    queryKey: ["finance-dashboard", month],
    queryFn: () => fetchDashboard({ data: { month } }),
    enabled: tab === "resumo",
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const transactionsQ = useQuery({
    queryKey: [
      "finance-transactions",
      month,
      debouncedSearch,
      filters.type,
      filters.status,
      filters.sourceModule,
    ],
    queryFn: () =>
      fetchTransactions({
        data: {
          month,
          search: debouncedSearch || undefined,
          type: filters.type as "all" | "income" | "expense",
          status: filters.status as "all" | "pending" | "received" | "paid" | "canceled",
          sourceModule: filters.sourceModule === "all" ? undefined : filters.sourceModule,
          page: 0,
          pageSize: 60,
        },
      }),
    enabled: tab === "lancamentos",
    placeholderData: keepPreviousData,
  });
  const recurringQ = useQuery({
    queryKey: ["finance-recurring"],
    queryFn: () => fetchRecurring() as Promise<FinanceRecurringRule[]>,
    enabled: tab === "recorrencias",
  });

  const refresh = () => {
    for (const key of [
      "finance-transactions",
      "finance-recurring",
      "finance-dashboard",
      "finance-team",
    ]) {
      qc.invalidateQueries({ queryKey: [key], refetchType: "active" });
    }
  };
  const refreshConfiguration = () => {
    refresh();
    qc.invalidateQueries({ queryKey: ["finance-meta"], refetchType: "active" });
    qc.invalidateQueries({ queryKey: ["finance-settings"], refetchType: "active" });
  };

  const deleteMutation = useMutation({
    mutationFn: (data: { id: string; reason: string | null }) => deletePending({ data }),
    onSuccess: () => {
      toast.success("Pendência excluída");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao excluir pendência"),
  });
  const reverseMutation = useMutation({
    mutationFn: (data: { id: string; reason: string }) => reverseSettlement({ data }),
    onSuccess: () => {
      toast.success("Baixa estornada");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao estornar baixa"),
  });

  const categories = metaQ.data?.categories ?? [];
  const accounts = metaQ.data?.accounts ?? [];
  const transactions = useMemo(
    () => (transactionsQ.data?.rows ?? []) as FinanceTransaction[],
    [transactionsQ.data?.rows],
  );
  const isLoading =
    tab === "resumo"
      ? dashboardQ.isLoading
      : tab === "lancamentos"
        ? transactionsQ.isLoading
        : false;

  const originOptions = useMemo(() => {
    const set = new Set(transactions.map((tx) => tx.source_module));
    return Array.from(set).sort();
  }, [transactions]);
  const loadError =
    dashboardQ.error ??
    (tab !== "resumo" ? metaQ.error : null) ??
    (tab === "lancamentos" ? transactionsQ.error : null) ??
    (tab === "recorrencias" ? recurringQ.error : null) ??
    settingsQ.error;

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
          <Button
            variant="outline"
            onClick={refreshConfiguration}
            disabled={isLoading}
            className="gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Atualizar
          </Button>
          <NewTransactionDialog
            onOpenChange={setNewOpen}
            categories={categories}
            accounts={accounts}
            createTx={createTx}
            createAccount={createAccount}
            onDone={refreshConfiguration}
          />
          <FinanceSettingsDialog
            onOpenChange={setSettingsOpen}
            categories={settingsQ.data?.categories ?? []}
            accounts={settingsQ.data?.accounts ?? []}
            createCategory={createCategory}
            createAccount={createAccount}
            manageCategory={manageCategory}
            manageAccount={manageAccount}
            onDone={refreshConfiguration}
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
            value="equipe"
            className="data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            Equipe & Repasses
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
          <div className="space-y-5">
            {dashboardQ.isPlaceholderData && (
              <p className="text-sm text-admin-ink-muted">Atualizando mês selecionado…</p>
            )}
            {dashboardQ.isFetching && !dashboardQ.data && (
              <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
            )}
            {(["BRL", "EUR"] as const).map((currency) => {
              const totals = dashboardQ.data?.totals[currency];
              return (
                <section key={currency} className="space-y-3">
                  <h2 className="font-display text-xl font-semibold">Caixa {currency}</h2>
                  <div className="grid grid-cols-12 gap-4">
                    <MetricCard
                      label="Recebido"
                      value={money(totals?.received ?? 0, currency)}
                      icon={ArrowUpCircle}
                      tone="green"
                    />
                    <MetricCard
                      label="A receber"
                      value={money(totals?.receivable ?? 0, currency)}
                      icon={CalendarClock}
                      tone="amber"
                    />
                    <MetricCard
                      label="Pago"
                      value={money(totals?.paid ?? 0, currency)}
                      icon={ArrowDownCircle}
                      tone="red"
                    />
                    <MetricCard
                      label="A pagar"
                      value={money(totals?.payable ?? 0, currency)}
                      icon={CalendarClock}
                      tone="amber"
                    />
                    <MetricCard
                      label="Saldo realizado"
                      value={money(totals?.realizedBalance ?? 0, currency)}
                      icon={WalletCards}
                      tone="blue"
                    />
                  </div>
                </section>
              );
            })}

            {dashboardQ.data && (
              <FinanceMonthClosePanel
                month={dashboardQ.data.snapshot.period_month.slice(0, 7)}
                analytics={dashboardQ.data}
              />
            )}
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
                      {financeOriginLabel(origin)}
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
                accounts={accounts}
                settle={(data) => settleTx({ data })}
                createAccount={async (name, currency) =>
                  (await createAccount({ data: { name, type: "bank", currency } })).id
                }
                onDone={refresh}
                onDelete={(id) => {
                  if (window.confirm("Excluir esta pendência?"))
                    deleteMutation.mutate({ id, reason: null });
                }}
                onReverse={(id) => {
                  const reason = window.prompt("Motivo do estorno da baixa (obrigatório):");
                  if (reason?.trim() && reason.trim().length >= 3)
                    reverseMutation.mutate({ id, reason: reason.trim() });
                }}
              />
            )}
          </BentoCard>
        </TabsContent>

        <TabsContent value="equipe" className="mt-0 space-y-4">
          <FinanceTeamPanel month={month} accounts={accounts} onChanged={refreshConfiguration} />
        </TabsContent>

        <TabsContent value="recorrencias" className="mt-0 space-y-4">
          <div className="flex justify-end">
            <NewRecurringDialog
              categories={categories}
              accounts={accounts}
              createRule={createRule}
              updateRule={updateRule}
              onDone={refresh}
              month={month}
            />
          </div>
          <BentoCard title="Regras recorrentes">
            {recurringQ.isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
              </div>
            ) : (
              <RecurringTable
                rows={recurringQ.data ?? []}
                categories={categories}
                accounts={accounts}
                createRule={createRule}
                updateRule={updateRule}
                month={month}
                onDone={refresh}
                onToggle={(id, isActive) =>
                  toggleRule({ data: { id, isActive } }).then(() => {
                    toast.success("Recorrencia atualizada");
                    refresh();
                  })
                }
                onEnd={(id) =>
                  endRule({ data: { id, endsOn: `${month}-01` } })
                    .then(() => {
                      toast.success("Recorrência encerrada");
                      refresh();
                    })
                    .catch((error) =>
                      toast.error(error instanceof Error ? error.message : "Erro ao encerrar"),
                    )
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

function TransactionTable({
  rows,
  accounts,
  settle,
  createAccount,
  onDone,
  onDelete,
  onReverse,
  compact = false,
}: {
  rows: FinanceTransaction[];
  accounts: FinanceAccount[];
  settle: React.ComponentProps<typeof SettleTransactionPopover>["settle"];
  createAccount: React.ComponentProps<typeof SettleTransactionPopover>["createAccount"];
  onDone: () => void;
  onDelete: (id: string) => void;
  onReverse: (id: string) => void;
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
            const supported =
              ["manual", "orders", "team_payout"].includes(tx.source_module) ||
              tx.source_module.startsWith("recurring:");
            const canSettle = supported && tx.status === "pending";
            const canReverse = supported && ["received", "paid"].includes(tx.status);
            return (
              <tr key={tx.id} className="border-b border-admin-border last:border-0">
                <td className="max-w-[260px] py-3 pr-3">
                  <p className="truncate font-medium text-admin-ink">{tx.description}</p>
                  <p className="truncate text-xs text-admin-ink-muted">
                    {tx.category_name ?? "Sem categoria"} · {tx.account_name ?? "Sem conta"}
                  </p>
                </td>
                <td className="py-3 pr-3">
                  <Badge variant="outline">{financeOriginLabel(tx.source_module)}</Badge>
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
                  {tx.settled_amount_cents != null && (
                    <div className="text-xs text-admin-ink-muted">
                      Realizado:{" "}
                      {money(tx.settled_amount_cents, tx.settled_currency ?? tx.currency)}
                    </div>
                  )}
                </td>
                {!compact && (
                  <td className="py-3 pl-3 text-right">
                    <div className="flex justify-end gap-2">
                      {canSettle && (
                        <SettleTransactionPopover
                          transaction={tx}
                          accounts={accounts}
                          settle={settle}
                          createAccount={createAccount}
                          onDone={onDone}
                        />
                      )}
                      {canSettle && (
                        <Button size="sm" variant="outline" onClick={() => onDelete(tx.id)}>
                          Excluir
                        </Button>
                      )}
                      {canReverse && (
                        <Button size="sm" variant="outline" onClick={() => onReverse(tx.id)}>
                          Estornar baixa
                        </Button>
                      )}
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
  onEnd,
  categories,
  accounts,
  createRule,
  updateRule,
  month,
  onDone,
}: {
  rows: FinanceRecurringRule[];
  onToggle: (id: string, isActive: boolean) => void;
  onEnd: (id: string) => void;
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  createRule: ReturnType<typeof useServerFn<typeof createFinanceRecurringRule>>;
  updateRule: ReturnType<typeof useServerFn<typeof updateFinanceRecurringRule>>;
  month: string;
  onDone: () => void;
}) {
  if (!rows.length)
    return <p className="text-sm text-admin-ink-muted">Nenhuma recorrencia cadastrada.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-admin-ink-muted">
          <tr className="border-b border-admin-border">
            <th className="py-3 pr-3">Descricao</th>
            <th className="py-3 pr-3">Vigência</th>
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
              <td className="py-3 pr-3 text-admin-ink-muted">
                {rule.starts_on.slice(0, 7)}
                {rule.ends_on ? ` até ${rule.ends_on.slice(0, 7)}` : " em diante"}
              </td>
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
                <div className="flex justify-end gap-2">
                  <NewRecurringDialog
                    rule={rule}
                    categories={categories}
                    accounts={accounts}
                    createRule={createRule}
                    updateRule={updateRule}
                    month={month}
                    onDone={onDone}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onToggle(rule.id, !rule.is_active)}
                  >
                    {rule.is_active ? "Pausar" : "Reativar"}
                  </Button>
                  {!rule.ends_on && (
                    <Button size="sm" variant="outline" onClick={() => onEnd(rule.id)}>
                      Encerrar
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NewTransactionDialog({
  onOpenChange,
  categories,
  accounts,
  createTx,
  createAccount,
  onDone,
}: {
  onOpenChange: (open: boolean) => void;
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  createTx: ReturnType<typeof useServerFn<typeof createFinanceTransaction>>;
  createAccount: ReturnType<typeof useServerFn<typeof createFinanceAccount>>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"income" | "expense">("income");
  const [currency, setCurrency] = useState<"BRL" | "EUR" | "USD">("BRL");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [orderWizardOpen, setOrderWizardOpen] = useState(false);
  const orderCategoryId = categories.find(
    (category) => category.is_system && category.name === "Pedidos/Servicos",
  )?.id;
  const orderMode = type === "income" && !!orderCategoryId && categoryId === orderCategoryId;
  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      createTx({
        data: {
          type,
          description: String(form.get("description") ?? ""),
          amount: Number(form.get("amount") ?? 0),
          currency,
          dueDate: String(form.get("dueDate") ?? ""),
          status: "pending",
          categoryId: categoryId || null,
          accountId: accountId || null,
          paymentMethod: emptyToNull(form.get("paymentMethod")),
          notes: emptyToNull(form.get("notes")),
        },
      }),
    onSuccess: () => {
      toast.success("Lancamento criado");
      setOpen(false);
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar lancamento"),
  });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange(next);
        }}
      >
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
                <p className="py-2 text-sm">Pendente</p>
              </Field>
            </div>
            <Field label="Categoria">
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar" />
                </SelectTrigger>
                <SelectContent>
                  {categories
                    .filter((category) => category.type === type || category.type === "both")
                    .map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            {orderMode ? (
              <div className="space-y-3 rounded border border-blue-200 bg-blue-50 p-4 text-sm">
                <strong>Receita de pedido/serviço</strong>
                <p>
                  Para manter Esteira e Caixa sincronizados, esta operação cria primeiro um pedido;
                  o lançamento financeiro será gerado automaticamente.
                </p>
                <Button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setOrderWizardOpen(true);
                  }}
                >
                  Criar pedido sincronizado
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCategoryId("")}>
                  Voltar ao lançamento comum
                </Button>
              </div>
            ) : (
              <>
                <Field label="Descricao">
                  <Input name="description" required />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Valor">
                    <Input name="amount" type="number" min="0" step="0.01" required />
                  </Field>
                  <Field label="Moeda">
                    <Select
                      value={currency}
                      onValueChange={(value) => {
                        setCurrency(value as typeof currency);
                        setAccountId("");
                      }}
                    >
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
                <Field label="Conta">
                  <FinanceAccountCombobox
                    accounts={accounts}
                    currency={currency}
                    value={accountId}
                    onChange={setAccountId}
                    onCreate={async (name, accountCurrency) => {
                      const result = await createAccount({
                        data: { name, type: "bank", currency: accountCurrency },
                      });
                      await onDone();
                      return result.id;
                    }}
                  />
                </Field>
                <Field label="Metodo">
                  <Input
                    name="paymentMethod"
                    placeholder="dinheiro, cartao, pix, transferencia..."
                  />
                </Field>
                <Field label="Observacoes">
                  <Textarea name="notes" />
                </Field>
                <Button type="submit" disabled={mutation.isPending} className="w-full">
                  {mutation.isPending ? "Salvando..." : "Salvar lancamento"}
                </Button>
              </>
            )}
          </form>
        </DialogContent>
      </Dialog>
      <NewOrderWizard
        open={orderWizardOpen}
        onOpenChange={setOrderWizardOpen}
        initiatedFrom="financeiro"
        onCreated={() => {
          onDone();
        }}
      />
    </>
  );
}

function NewRecurringDialog({
  categories,
  accounts,
  createRule,
  updateRule,
  month,
  rule,
  onDone,
}: {
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  createRule: ReturnType<typeof useServerFn<typeof createFinanceRecurringRule>>;
  updateRule: ReturnType<typeof useServerFn<typeof updateFinanceRecurringRule>>;
  month: string;
  rule?: FinanceRecurringRule;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"income" | "expense">(rule?.type ?? "expense");
  const [currency, setCurrency] = useState<"BRL" | "EUR">(rule?.currency === "EUR" ? "EUR" : "BRL");
  const [categoryId, setCategoryId] = useState(rule?.category_id ?? "");
  const [accountId, setAccountId] = useState(rule?.account_id ?? "");
  const mutation = useMutation({
    mutationFn: (form: FormData) => {
      const data = {
        type,
        description: String(form.get("description") ?? ""),
        amount: Number(form.get("amount") ?? 0),
        currency,
        categoryId: categoryId || null,
        accountId: accountId || null,
        dayOfMonth: Number(form.get("dayOfMonth") ?? 1),
        startsOn: `${String(form.get("startsOn") ?? month).slice(0, 7)}-01`,
        endsOn: form.get("endsOn") ? `${String(form.get("endsOn")).slice(0, 7)}-01` : null,
      };
      return rule ? updateRule({ data: { ...data, id: rule.id } }) : createRule({ data });
    },
    onSuccess: () => {
      toast.success(rule ? "Recorrência atualizada" : "Recorrência criada");
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar recorrencia"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          {!rule && <CalendarClock className="h-4 w-4" />} {rule ? "Editar" : "Nova recorrência"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rule ? "Editar recorrência" : "Nova recorrência mensal"}</DialogTitle>
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
            <Field label="Frequência">
              <Input value="Mensal" disabled />
            </Field>
          </div>
          <Field label="Descricao">
            <Input name="description" defaultValue={rule?.description ?? ""} required />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Valor">
              <Input
                name="amount"
                type="number"
                min="0"
                step="0.01"
                defaultValue={rule ? rule.amount_cents / 100 : ""}
                required
              />
            </Field>
            <Field label="Moeda">
              <Select
                value={currency}
                onValueChange={(value) => {
                  setCurrency(value as "BRL" | "EUR");
                  setAccountId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">BRL</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Dia">
              <Input
                name="dayOfMonth"
                type="number"
                min="1"
                max="31"
                defaultValue={rule?.day_of_month ?? 1}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Início (mês)">
              <Input
                name="startsOn"
                type="month"
                defaultValue={rule?.starts_on.slice(0, 7) ?? month}
                required
              />
            </Field>
            <Field label="Fim (opcional)">
              <Input name="endsOn" type="month" defaultValue={rule?.ends_on?.slice(0, 7) ?? ""} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoria">
              <Select
                value={categoryId || "none"}
                onValueChange={(value) => setCategoryId(value === "none" ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sem categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem categoria</SelectItem>
                  {categories
                    .filter(
                      (item) => item.is_active && (item.type === type || item.type === "both"),
                    )
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Conta">
              <Select
                value={accountId || "none"}
                onValueChange={(value) => setAccountId(value === "none" ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sem conta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem conta</SelectItem>
                  {accounts
                    .filter((item) => item.is_active && item.currency === currency)
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? "Salvando..." : "Salvar recorrencia"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FinanceSettingsDialog({
  onOpenChange,
  categories,
  accounts,
  createCategory,
  createAccount,
  manageCategory,
  manageAccount,
  onDone,
}: {
  onOpenChange: (open: boolean) => void;
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  createCategory: ReturnType<typeof useServerFn<typeof createFinanceCategory>>;
  createAccount: ReturnType<typeof useServerFn<typeof createFinanceAccount>>;
  manageCategory: ReturnType<typeof useServerFn<typeof manageFinanceCategory>>;
  manageAccount: ReturnType<typeof useServerFn<typeof manageFinanceAccount>>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [editingCategory, setEditingCategory] = useState<FinanceCategory | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("");
  const [editCurrency, setEditCurrency] = useState("");
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
  const manageMutation = useMutation({
    mutationFn: async (input: {
      kind: "account" | "category";
      id: string;
      action: "edit" | "archive" | "reactivate" | "remove";
    }) => {
      if (input.kind === "account")
        return manageAccount({
          data: {
            id: input.id,
            action: input.action,
            name: input.action === "edit" ? editName : undefined,
            type:
              input.action === "edit"
                ? (editType as FinanceAccount["type"] as
                    | "cash"
                    | "bank"
                    | "card"
                    | "gateway"
                    | "other")
                : undefined,
            currency: input.action === "edit" ? (editCurrency as "BRL" | "EUR" | "USD") : undefined,
          },
        });
      return manageCategory({
        data: {
          id: input.id,
          action: input.action,
          name: input.action === "edit" ? editName : undefined,
          type: input.action === "edit" ? (editType as "income" | "expense" | "both") : undefined,
        },
      });
    },
    onSuccess: (result) => {
      toast.success(
        result.archivedInstead ? "Item com histórico arquivado" : "Configuração atualizada",
      );
      setEditingAccount(null);
      setEditingCategory(null);
      onDone();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro ao atualizar"),
  });
  const manage = (
    kind: "account" | "category",
    id: string,
    action: "edit" | "archive" | "reactivate" | "remove",
  ) => {
    if (
      action === "remove" &&
      !window.confirm("Remover este item? Se houver histórico, ele será arquivado.")
    )
      return;
    manageMutation.mutate({ kind, id, action });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Settings className="h-4 w-4" /> Configurar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
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
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <section className="space-y-2">
            <h3 className="font-display font-semibold">Categorias</h3>
            {categories.map((category) => (
              <div key={category.id} className="rounded-lg border border-admin-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {category.name} · {category.type} {category.is_system ? "· Sistema" : ""}{" "}
                    {!category.is_active ? "· Arquivada" : ""}
                  </span>
                  {!category.is_system && (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingCategory(category);
                          setEditingAccount(null);
                          setEditName(category.name);
                          setEditType(category.type);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          manage(
                            "category",
                            category.id,
                            category.is_active ? "archive" : "reactivate",
                          )
                        }
                      >
                        {category.is_active ? "Arquivar" : "Reativar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => manage("category", category.id, "remove")}
                      >
                        Remover
                      </Button>
                    </div>
                  )}
                </div>
                {editingCategory?.id === category.id && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Input
                      className="min-w-36 flex-1"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <select
                      className="rounded border border-admin-border bg-admin-bg px-2"
                      value={editType}
                      onChange={(e) => setEditType(e.target.value)}
                    >
                      <option value="income">Entrada</option>
                      <option value="expense">Saída</option>
                      <option value="both">Ambos</option>
                    </select>
                    <Button
                      size="sm"
                      disabled={manageMutation.isPending}
                      onClick={() => manage("category", category.id, "edit")}
                    >
                      Salvar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </section>
          <section className="space-y-2">
            <h3 className="font-display font-semibold">Contas e caixas</h3>
            {accounts.map((account) => (
              <div key={account.id} className="rounded-lg border border-admin-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {account.name} · {account.type} · {account.currency}{" "}
                    {!account.is_active ? "· Arquivada" : ""}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingAccount(account);
                        setEditingCategory(null);
                        setEditName(account.name);
                        setEditType(account.type);
                        setEditCurrency(account.currency);
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        manage("account", account.id, account.is_active ? "archive" : "reactivate")
                      }
                    >
                      {account.is_active ? "Arquivar" : "Reativar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => manage("account", account.id, "remove")}
                    >
                      Remover
                    </Button>
                  </div>
                </div>
                {editingAccount?.id === account.id && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Input
                      className="min-w-36 flex-1"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <select
                      className="rounded border border-admin-border bg-admin-bg px-2"
                      value={editType}
                      onChange={(e) => setEditType(e.target.value)}
                    >
                      {["cash", "bank", "card", "gateway", "other"].map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded border border-admin-border bg-admin-bg px-2"
                      value={editCurrency}
                      disabled={account.has_history}
                      title={
                        account.has_history ? "Conta com histórico: moeda bloqueada" : undefined
                      }
                      onChange={(e) => setEditCurrency(e.target.value)}
                    >
                      {["BRL", "EUR", "USD"].map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={manageMutation.isPending}
                      onClick={() => manage("account", account.id, "edit")}
                    >
                      Salvar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </section>
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
