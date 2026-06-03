import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useMemo } from "react";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Wallet,
  ShoppingCart,
  Users,
  Ticket as TicketIcon,
  Sparkles,
  Loader2,
  AlertTriangle,
  Construction,
  Package,
  CalendarCheck,
  CalendarX,
  UserCheck,
  Boxes,
  Activity,
  Crown,
  MessageSquare,
  Clock,
  Megaphone,
  UserMinus,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BentoCard } from "@/components/admin/BentoCard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  getReportsOverview,
  getReportsVendas,
  getReportsPdv,
  getReportsServicos,
  getReportsEventos,
  getReportsClube,
  getReportsCrm,
  type ReportFilters,
} from "@/lib/admin/reports.functions";
import { exportReportXlsx } from "@/lib/admin/reports.export.functions";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

// ---------- URL search schema ----------

const searchSchema = z.object({
  tab: fallback(
    z.enum(["visao", "vendas", "pdv", "servicos", "eventos", "clube", "crm"]),
    "visao",
  ).default("visao"),
  period: fallback(z.enum(["today", "7d", "30d", "month", "last_month", "custom"]), "30d").default(
    "30d",
  ),
  from: z.string().optional(),
  to: z.string().optional(),
  compare: fallback(z.enum(["none", "prev_period", "prev_month"]), "prev_period").default(
    "prev_period",
  ),
  currency: fallback(z.enum(["BRL", "EUR", "both"]), "both").default("both"),
  origin: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/admin/relatorios")({
  validateSearch: zodValidator(searchSchema),
  component: RelatoriosPage,
});

type SearchSchema = z.infer<typeof searchSchema>;

function normalizeSearch(search: Partial<SearchSchema>): SearchSchema {
  return {
    tab: search.tab ?? "visao",
    period: search.period ?? "30d",
    compare: search.compare ?? "prev_period",
    currency: search.currency ?? "both",
    from: search.from,
    to: search.to,
    origin: search.origin,
  };
}

// ---------- Helpers ----------

const PERIOD_LABEL: Record<string, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Este mês",
  last_month: "Mês anterior",
  custom: "Personalizado",
};

const COMPARE_LABEL: Record<string, string> = {
  none: "Sem comparação",
  prev_period: "Período anterior",
  prev_month: "Mesmo período do mês passado",
};

const ORIGIN_LABEL: Record<string, string> = {
  pdv: "PDV",
  orders: "Esteira",
  esteira: "Esteira",
  eventos: "Eventos",
  clube: "Clube",
  manual: "Manual",
  hubla: "Hubla",
};

function money(cents: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format((cents ?? 0) / 100);
}

function number(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n);
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

// ---------- Page ----------

function RelatoriosPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  const filters: ReportFilters = useMemo(
    () => ({
      period: search.period,
      from: search.from,
      to: search.to,
      compare: search.compare,
      currency: search.currency,
      origin: search.origin,
    }),
    [search.period, search.from, search.to, search.compare, search.currency, search.origin],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-admin-accent/15">
            <BarChart3 className="h-6 w-6 text-admin-accent" />
          </div>
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">Relatórios</h1>
            <p className="mt-1 text-sm text-admin-ink-muted">
              Central analítica com visão geral, comparativos e exportação por categoria.
            </p>
          </div>
        </div>
        <ExportButtons tab={search.tab} filters={filters} />
      </header>

      <GlobalFiltersBar search={search} navigate={navigate} />

      <Tabs
        value={search.tab}
        onValueChange={(v) =>
          navigate({
            to: "/admin/relatorios",
            search: (prev: Partial<SearchSchema>) => ({
              ...normalizeSearch(prev as Partial<SearchSchema>),
              tab: v as SearchSchema["tab"],
            }),
            replace: true,
          })
        }
        className="space-y-4"
      >
        <TabsList className="bg-admin-surface border border-admin-border">
          {[
            { v: "visao", l: "Visão Geral" },
            { v: "vendas", l: "Vendas & Financeiro" },
            { v: "pdv", l: "PDV & Estoque" },
            { v: "servicos", l: "Serviços & Agenda" },
            { v: "eventos", l: "Eventos" },
            { v: "clube", l: "Clube" },
            { v: "crm", l: "CRM & SLA" },
          ].map((t) => (
            <TabsTrigger
              key={t.v}
              value={t.v}
              className="data-[state=active]:bg-admin-accent data-[state=active]:text-white"
            >
              {t.l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="visao" className="mt-0">
          <VisaoGeralTab filters={filters} />
        </TabsContent>
        <TabsContent value="vendas" className="mt-0">
          <VendasTab filters={filters} />
        </TabsContent>
        <TabsContent value="pdv" className="mt-0">
          <PdvTab filters={filters} />
        </TabsContent>
        <TabsContent value="servicos" className="mt-0">
          <ServicosTab filters={filters} />
        </TabsContent>
        <TabsContent value="eventos" className="mt-0">
          <EventosTab filters={filters} />
        </TabsContent>
        <TabsContent value="clube" className="mt-0">
          <ClubeTab filters={filters} />
        </TabsContent>
        <TabsContent value="crm" className="mt-0">
          <CrmTab filters={filters} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- Filters bar ----------

function GlobalFiltersBar({
  search,
  navigate,
}: {
  search: z.infer<typeof searchSchema>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const upd = (patch: Partial<SearchSchema>) =>
    navigate({
      to: "/admin/relatorios",
      search: (prev: Partial<SearchSchema>) => ({ ...normalizeSearch(prev as Partial<SearchSchema>), ...patch }),
      replace: true,
    });

  return (
    <BentoCard padded>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_220px_160px_160px_1fr]">
        <Select value={search.period} onValueChange={(v) => upd({ period: v as never })}>
          <SelectTrigger className="bg-admin-bg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PERIOD_LABEL).map(([k, l]) => (
              <SelectItem key={k} value={k}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={search.compare} onValueChange={(v) => upd({ compare: v as never })}>
          <SelectTrigger className="bg-admin-bg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(COMPARE_LABEL).map(([k, l]) => (
              <SelectItem key={k} value={k}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={search.currency} onValueChange={(v) => upd({ currency: v as never })}>
          <SelectTrigger className="bg-admin-bg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="both">Todas moedas</SelectItem>
            <SelectItem value="BRL">BRL</SelectItem>
            <SelectItem value="EUR">EUR</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={search.origin ?? "all"}
          onValueChange={(v) => upd({ origin: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="bg-admin-bg">
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas origens</SelectItem>
            <SelectItem value="pdv">PDV</SelectItem>
            <SelectItem value="orders">Esteira</SelectItem>
            <SelectItem value="eventos">Eventos</SelectItem>
            <SelectItem value="clube">Clube</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="hubla">Hubla</SelectItem>
          </SelectContent>
        </Select>

        {search.period === "custom" ? (
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={search.from ?? ""}
              onChange={(e) => upd({ from: e.target.value || undefined })}
              className="bg-admin-bg"
            />
            <Input
              type="date"
              value={search.to ?? ""}
              onChange={(e) => upd({ to: e.target.value || undefined })}
              className="bg-admin-bg"
            />
          </div>
        ) : (
          <div className="text-xs text-admin-ink-muted self-center">
            Filtros são salvos na URL — pode compartilhar este link.
          </div>
        )}
      </div>
    </BentoCard>
  );
}

// ---------- Reusable bits ----------

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  const cls = up ? "text-emerald-700 bg-emerald-100" : "text-red-800 bg-red-100";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function MetricCard({
  label,
  value,
  hint,
  deltaPct,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  deltaPct?: number | null;
  icon?: typeof BarChart3;
  tone?: "neutral" | "green" | "red" | "blue" | "amber";
}) {
  const tones = {
    neutral: "text-admin-ink bg-admin-bg",
    green: "text-emerald-700 bg-emerald-100",
    red: "text-red-800 bg-red-100",
    blue: "text-blue-800 bg-blue-100",
    amber: "text-amber-800 bg-amber-100",
  };
  return (
    <BentoCard className="col-span-12 sm:col-span-6 lg:col-span-3" padded>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-admin-ink-muted">{label}</p>
          <p className="mt-2 font-display text-2xl font-bold text-admin-ink truncate">{value}</p>
          {hint && (
            <p className="mt-0.5 text-xs text-admin-ink-muted tabular-nums truncate">{hint}</p>
          )}
          {deltaPct !== undefined && (
            <div className="mt-1">
              <DeltaBadge pct={deltaPct ?? null} />
            </div>
          )}
        </div>
        {Icon && (
          <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
    </BentoCard>
  );
}

function LoadingBlock() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
    </div>
  );
}

function ErrorBlock({ error }: { error: unknown }) {
  return (
    <BentoCard padded>
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-red-700 mt-0.5" />
        <div>
          <p className="font-display text-sm text-red-800">Erro ao carregar relatório</p>
          <p className="text-xs text-admin-ink-muted mt-1">
            {error instanceof Error ? error.message : "Falha desconhecida"}
          </p>
        </div>
      </div>
    </BentoCard>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-admin-ink-muted">
      {label}
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <BentoCard padded>
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Construction className="h-10 w-10 text-admin-ink-muted" />
        <p className="font-display text-lg text-admin-ink">Relatório de {label}</p>
        <p className="text-sm text-admin-ink-muted max-w-md">
          Este relatório será entregue em uma próxima fase. Os filtros globais já estão prontos para
          receber esta aba.
        </p>
      </div>
    </BentoCard>
  );
}

// ---------- Export buttons ----------

function ExportButtons({ tab, filters }: { tab: SearchSchema["tab"]; filters: ReportFilters }) {
  const xlsxFn = useServerFn(exportReportXlsx);
  const [busy, setBusy] = useState(false);

  const handleXlsx = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await xlsxFn({ data: { tab, filters } });
      const binary = atob(res.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: res.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Excel gerado", { description: res.filename });
    } catch (e) {
      toast.error("Falha ao exportar Excel", {
        description: e instanceof Error ? e.message : "Erro desconhecido",
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => {
    document.body.classList.add("relatorios-printing");
    setTimeout(() => {
      window.print();
      setTimeout(() => document.body.classList.remove("relatorios-printing"), 500);
    }, 80);
  };

  return (
    <div className="flex items-center gap-2 print:hidden">
      <Button variant="outline" size="sm" onClick={handleXlsx} disabled={busy} className="gap-2">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="h-4 w-4" />
        )}
        Excel
      </Button>
      <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
        <Printer className="h-4 w-4" />
        PDF
      </Button>
    </div>
  );
}

// ---------- Visão Geral ----------

function VisaoGeralTab({ filters }: { filters: ReportFilters }) {
  const fetchFn = useServerFn(getReportsOverview);
  const q = useQuery({
    queryKey: ["reports-overview", filters],
    queryFn: () => fetchFn({ data: filters }),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  if (!q.data) return null;
  const d = q.data;
  const c = d.cards;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-12 gap-4">
        <MetricCard
          label="Receita total"
          value={money(c.totalRevenue.current)}
          deltaPct={c.totalRevenue.deltaPct}
          icon={TrendingUp}
          tone="green"
        />
        <MetricCard
          label="Receita recebida"
          value={money(c.received.current)}
          deltaPct={c.received.deltaPct}
          icon={TrendingUp}
          tone="green"
        />

        <MetricCard
          label="Receita prevista"
          value={money(c.receivable.current)}
          deltaPct={c.receivable.deltaPct}
          icon={Wallet}
          tone="amber"
        />
        <MetricCard
          label="Despesas"
          value={money(c.expenses.current)}
          deltaPct={c.expenses.deltaPct}
          icon={TrendingDown}
          tone="red"
        />
        <MetricCard
          label="Saldo"
          value={money(c.balance.current)}
          deltaPct={c.balance.deltaPct}
          icon={Wallet}
          tone={c.balance.current >= 0 ? "blue" : "red"}
        />
        <MetricCard
          label="Pedidos pagos"
          value={number(c.ordersPaid.current)}
          deltaPct={c.ordersPaid.deltaPct}
          icon={ShoppingCart}
          tone="blue"
        />
        <MetricCard
          label="Vendas PDV"
          value={number(c.pdvSales.current)}
          icon={ShoppingCart}
          tone="neutral"
        />
        <MetricCard
          label="Novos leads"
          value={number(c.newLeads.current)}
          deltaPct={c.newLeads.deltaPct}
          icon={Sparkles}
          tone="amber"
        />
        <MetricCard
          label="Novos membros do Clube"
          value={number(c.newClubMembers.current)}
          icon={Users}
          tone="green"
        />
        <MetricCard
          label="Ingressos vendidos"
          value={number(c.eventTickets.current)}
          icon={TicketIcon}
          tone="blue"
        />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <BentoCard title="Receita por dia" className="col-span-12 lg:col-span-8">
          <DailyAreaChart data={d.series} />
        </BentoCard>
        <BentoCard title="Top 5 fontes de receita" className="col-span-12 lg:col-span-4">
          <RankingList
            rows={d.topSources.map((r) => ({
              label: ORIGIN_LABEL[r.label] ?? r.label,
              value: money(r.amount_cents),
              raw: r.amount_cents,
            }))}
          />
        </BentoCard>
        <BentoCard title="Receita por origem" className="col-span-12 lg:col-span-6">
          <OriginBarChart data={d.byOrigin} />
        </BentoCard>
        <BentoCard title="Funil de leads" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.leadsFunnel.map((s: { label: string; count: number }) => ({
              label: s.label,
              value: `${number(s.count)}`,
              raw: s.count,
            }))}
            empty="Sem leads ativos no funil."
          />
        </BentoCard>
        <BentoCard title="Alertas" className="col-span-12">
          {d.alerts.length === 0 ? (
            <EmptyState label="Tudo certo — nenhum alerta no período." />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {d.alerts.map((a, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                    a.severity === "danger"
                      ? "bg-red-50 text-red-900"
                      : "bg-amber-50 text-amber-900"
                  }`}
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{a.message}</span>
                </li>
              ))}
            </ul>
          )}
        </BentoCard>
      </div>
    </div>
  );
}

// ---------- Vendas & Financeiro ----------

function VendasTab({ filters }: { filters: ReportFilters }) {
  const fetchFn = useServerFn(getReportsVendas);
  const q = useQuery({
    queryKey: ["reports-vendas", filters],
    queryFn: () => fetchFn({ data: filters }),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  if (!q.data) return null;
  const d = q.data;
  const c = d.cards;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-12 gap-4">
        <MetricCard
          label="Receita recebida"
          value={money(c.received.current)}
          deltaPct={c.received.deltaPct}
          icon={TrendingUp}
          tone="green"
        />
        <MetricCard
          label="A receber"
          value={money(c.receivable.current)}
          deltaPct={c.receivable.deltaPct}
          icon={Wallet}
          tone="amber"
        />
        <MetricCard
          label="Despesas pagas"
          value={money(c.expenses.current)}
          deltaPct={c.expenses.deltaPct}
          icon={TrendingDown}
          tone="red"
        />
        <MetricCard
          label="Saldo"
          value={money(c.balance.current)}
          deltaPct={c.balance.deltaPct}
          icon={Wallet}
          tone={c.balance.current >= 0 ? "blue" : "red"}
        />
        <MetricCard
          label="Pedidos pagos"
          value={number(c.ordersPaid.current)}
          deltaPct={c.ordersPaid.deltaPct}
          icon={ShoppingCart}
          tone="blue"
        />
        <MetricCard
          label="Pedidos pendentes"
          value={number(c.ordersPending.current)}
          deltaPct={c.ordersPending.deltaPct}
          icon={ShoppingCart}
          tone="amber"
        />
        <MetricCard
          label="Ticket médio"
          value={money(c.ticketAvg.current)}
          deltaPct={c.ticketAvg.deltaPct}
          icon={BarChart3}
          tone="neutral"
        />
        <MetricCard
          label="Conversão pagto."
          value={`${c.paymentConversionPct.current.toFixed(1)}%`}
          icon={TrendingUp}
          tone="green"
        />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <BentoCard title="Receita diária" className="col-span-12 lg:col-span-8">
          <DailyAreaChart data={d.series} />
        </BentoCard>
        <BentoCard title="Receita por origem" className="col-span-12 lg:col-span-4">
          <RankingList
            rows={d.byOrigin.map((r) => ({
              label: ORIGIN_LABEL[r.label] ?? r.label,
              value: money(r.amount_cents),
              raw: r.amount_cents,
            }))}
            empty="Nenhuma receita no período."
          />
        </BentoCard>
        <BentoCard title="Ticket médio por origem" className="col-span-12 lg:col-span-4">
          <RankingList
            rows={d.ticketAvgByOrigin.map((r) => ({
              label: ORIGIN_LABEL[r.label] ?? r.label,
              value: money(r.amount_cents),
              raw: r.amount_cents,
            }))}
            empty="Sem dados."
          />
        </BentoCard>
        <BentoCard title="Pendentes por status" className="col-span-12 lg:col-span-4">
          <RankingList
            rows={d.pendingByStatus.map((r) => ({
              label:
                r.label === "overdue"
                  ? "Vencido"
                  : r.label === "pending"
                    ? "Pendente"
                    : r.label === "planned"
                      ? "Planejado"
                      : r.label,
              value: money(r.amount_cents),
              raw: r.amount_cents,
            }))}
            empty="Sem pendências."
          />
        </BentoCard>
        <BentoCard title="Despesas por categoria" className="col-span-12 lg:col-span-4">
          <RankingList
            rows={d.expenseByCategory.map((r) => ({
              label: r.label,
              value: money(r.amount_cents),
              raw: r.amount_cents,
            }))}
            empty="Nenhuma despesa registrada."
          />
        </BentoCard>
      </div>
    </div>
  );
}

// ---------- Charts & lists ----------

function DailyAreaChart({ data }: { data: { date: string; value: number }[] }) {
  if (!data.length) return <EmptyState label="Sem dados no período." />;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="rep-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.58 0.18 45)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="oklch(0.58 0.18 45)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.008 70)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            fontSize={10}
            stroke="oklch(0.62 0.025 50)"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            fontSize={10}
            stroke="oklch(0.62 0.025 50)"
            tickLine={false}
            axisLine={false}
            width={50}
            tickFormatter={(v) => `€${Number(v).toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              background: "white",
              border: "1px solid oklch(0.91 0.008 70)",
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(v) => [`€ ${Number(v).toFixed(2)}`, "Receita"]}
            labelFormatter={(l) => formatDate(String(l))}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="oklch(0.58 0.18 45)"
            strokeWidth={2}
            fill="url(#rep-area)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function OriginBarChart({ data }: { data: { label: string; amount_cents: number }[] }) {
  if (!data.length) return <EmptyState label="Sem receita no período." />;
  const chartData = data.map((d) => ({
    label: ORIGIN_LABEL[d.label] ?? d.label,
    value: d.amount_cents / 100,
  }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.008 70)" vertical={false} />
          <XAxis
            dataKey="label"
            fontSize={11}
            stroke="oklch(0.62 0.025 50)"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            fontSize={10}
            stroke="oklch(0.62 0.025 50)"
            tickLine={false}
            axisLine={false}
            width={50}
            tickFormatter={(v) => `€${Number(v).toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              background: "white",
              border: "1px solid oklch(0.91 0.008 70)",
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(v) => [`€ ${Number(v).toFixed(2)}`, "Receita"]}
          />
          <Bar dataKey="value" fill="oklch(0.58 0.18 45)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RankingList({
  rows,
  empty = "Sem dados no período.",
}: {
  rows: { label: string; value: string; raw: number }[];
  empty?: string;
}) {
  if (!rows.length) return <EmptyState label={empty} />;
  const max = Math.max(...rows.map((r) => r.raw), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => {
        const pct = (r.raw / max) * 100;
        return (
          <li key={i} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-admin-ink truncate pr-2">{r.label}</span>
              <span className="font-display tabular-nums text-admin-ink">{r.value}</span>
            </div>
            <div className="h-1.5 w-full bg-admin-bg rounded-full overflow-hidden">
              <div className="h-full bg-admin-accent rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- PDV & Estoque ----------

function PdvTab({ filters }: { filters: ReportFilters }) {
  const fetchFn = useServerFn(getReportsPdv);
  const q = useQuery({
    queryKey: ["reports-pdv", filters],
    queryFn: () => fetchFn({ data: filters }),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  if (!q.data) return null;
  const d = q.data;
  const c = d.cards;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-12 gap-4">
        <MetricCard
          label="Faturamento PDV"
          value={money(c.revenue.current, "EUR")}
          deltaPct={c.revenue.deltaPct}
          icon={TrendingUp}
          tone="green"
        />
        <MetricCard
          label="Vendas concluídas"
          value={number(c.salesCount.current)}
          deltaPct={c.salesCount.deltaPct}
          icon={ShoppingCart}
          tone="blue"
        />
        <MetricCard
          label="Ticket médio"
          value={money(c.ticket.current, "EUR")}
          deltaPct={c.ticket.deltaPct}
          icon={BarChart3}
          tone="neutral"
        />
        <MetricCard
          label="Itens vendidos"
          value={number(c.itemsSold.current)}
          icon={Package}
          tone="amber"
        />
        <MetricCard
          label="Vendas anuladas"
          value={number(c.voided.current)}
          deltaPct={c.voided.deltaPct}
          icon={AlertTriangle}
          tone="red"
        />
        <MetricCard
          label="Descontos concedidos"
          value={money(c.discounts.current, "EUR")}
          deltaPct={c.discounts.deltaPct}
          icon={TrendingDown}
          tone="amber"
        />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <BentoCard title="Top 10 produtos mais vendidos" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.topProducts.map((p) => ({
              label: `${p.name} · ${number(p.qty)}un`,
              value: money(p.revenue, "EUR"),
              raw: p.qty,
            }))}
            empty="Sem vendas no período."
          />
        </BentoCard>
        <BentoCard title="Top operadores" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.topCashiers.map((c) => ({
              label: `${c.label} · ${number(c.count)} vendas`,
              value: money(c.revenue, "EUR"),
              raw: c.revenue,
            }))}
            empty="Sem operadores no período."
          />
        </BentoCard>
        <BentoCard title="Formas de pagamento" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.paymentMethods.map((p) => ({
              label: `${p.label} · ${number(p.count)}x`,
              value: money(p.revenue, "EUR"),
              raw: p.revenue,
            }))}
            empty="Sem pagamentos registrados."
          />
        </BentoCard>
        <BentoCard title="Estoque baixo (≤ 5)" className="col-span-12 lg:col-span-6">
          {d.lowStock.length === 0 ? (
            <EmptyState label="Nenhum produto com estoque baixo." />
          ) : (
            <ul className="space-y-2">
              {d.lowStock.map((p: { id: string; name: string; stock_quantity: number }) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-lg bg-admin-bg px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2 text-admin-ink truncate">
                    <Boxes className="h-4 w-4 text-amber-600" />
                    {p.name}
                  </span>
                  <span
                    className={`font-display tabular-nums ${
                      p.stock_quantity === 0 ? "text-red-700" : "text-amber-700"
                    }`}
                  >
                    {p.stock_quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </BentoCard>
        <BentoCard title="Horários de maior venda" className="col-span-12">
          <HourlySalesChart data={d.hourly} />
        </BentoCard>
      </div>
    </div>
  );
}

function HourlySalesChart({ data }: { data: { hour: number; revenue: number; sales: number }[] }) {
  if (!data.some((d) => d.sales > 0)) return <EmptyState label="Sem vendas no período." />;
  const chart = data.map((d) => ({
    label: `${String(d.hour).padStart(2, "0")}h`,
    value: d.revenue / 100,
    sales: d.sales,
  }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.008 70)" vertical={false} />
          <XAxis
            dataKey="label"
            fontSize={10}
            stroke="oklch(0.62 0.025 50)"
            tickLine={false}
            axisLine={false}
            interval={1}
          />
          <YAxis
            fontSize={10}
            stroke="oklch(0.62 0.025 50)"
            tickLine={false}
            axisLine={false}
            width={50}
            tickFormatter={(v) => `€${Number(v).toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              background: "white",
              border: "1px solid oklch(0.91 0.008 70)",
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(v: unknown, n: unknown) => {
              if (n === "sales") return [`${v}`, "Vendas"];
              return [`€ ${Number(v).toFixed(2)}`, "Receita"];
            }}
          />
          <Bar dataKey="value" name="Receita" fill="oklch(0.58 0.18 45)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Serviços & Agenda ----------

function ServicosTab({ filters }: { filters: ReportFilters }) {
  const fetchFn = useServerFn(getReportsServicos);
  const q = useQuery({
    queryKey: ["reports-servicos", filters],
    queryFn: () => fetchFn({ data: filters }),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  if (!q.data) return null;
  const d = q.data;
  const c = d.cards;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-12 gap-4">
        <MetricCard
          label="Agendamentos"
          value={number(c.total.current)}
          deltaPct={c.total.deltaPct}
          icon={CalendarCheck}
          tone="blue"
        />
        <MetricCard
          label="Confirmados"
          value={number(c.confirmed.current)}
          deltaPct={c.confirmed.deltaPct}
          icon={UserCheck}
          tone="green"
        />
        <MetricCard
          label="Concluídos"
          value={number(c.completed.current)}
          deltaPct={c.completed.deltaPct}
          icon={UserCheck}
          tone="green"
        />
        <MetricCard
          label="Cancelados"
          value={number(c.canceled.current)}
          deltaPct={c.canceled.deltaPct}
          icon={CalendarX}
          tone="red"
        />
        <MetricCard
          label="Não compareceu"
          value={number(c.noShow.current)}
          deltaPct={c.noShow.deltaPct}
          icon={AlertTriangle}
          tone="amber"
        />
        <MetricCard
          label="Taxa de no-show"
          value={`${c.noShowRate.current.toFixed(1)}%`}
          icon={TrendingDown}
          tone="amber"
        />
        <MetricCard
          label="Taxa de cancelamento"
          value={`${c.cancelRate.current.toFixed(1)}%`}
          icon={TrendingDown}
          tone="red"
        />
        <MetricCard
          label="Taxa de ocupação"
          value={`${c.occupancyRate.current.toFixed(1)}%`}
          icon={Activity}
          tone="blue"
        />
        <MetricCard
          label="Slots abertos"
          value={number(c.slotsOpen.current)}
          icon={CalendarCheck}
          tone="green"
        />
        <MetricCard
          label="Slots lotados"
          value={number(c.slotsFull.current)}
          icon={CalendarX}
          tone="amber"
        />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <BentoCard title="Serviços mais agendados" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.topServices.map((s) => ({
              label: s.label,
              value: `${number(s.count)}`,
              raw: s.count,
            }))}
            empty="Sem agendamentos no período."
          />
        </BentoCard>
        <BentoCard title="Por categoria" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.byCategory.map((s) => ({
              label: s.label,
              value: `${number(s.count)}`,
              raw: s.count,
            }))}
            empty="Sem dados."
          />
        </BentoCard>
        <BentoCard title="Ocupação por dia da semana" className="col-span-12 lg:col-span-8">
          <WeekdayBarChart data={d.byWeekday} />
        </BentoCard>
        <BentoCard title="Status dos agendamentos" className="col-span-12 lg:col-span-4">
          <RankingList
            rows={d.byStatus.map((s) => ({
              label: s.label,
              value: `${number(s.count)}`,
              raw: s.count,
            }))}
            empty="Sem dados."
          />
        </BentoCard>
      </div>
    </div>
  );
}

function WeekdayBarChart({ data }: { data: { label: string; count: number }[] }) {
  if (!data.some((d) => d.count > 0)) return <EmptyState label="Sem agendamentos no período." />;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.008 70)" vertical={false} />
          <XAxis
            dataKey="label"
            fontSize={11}
            stroke="oklch(0.62 0.025 50)"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            fontSize={10}
            stroke="oklch(0.62 0.025 50)"
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: "white",
              border: "1px solid oklch(0.91 0.008 70)",
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(v) => [`${v}`, "Agendamentos"]}
          />
          <Bar dataKey="count" fill="oklch(0.58 0.18 45)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Eventos ----------

function EventosTab({ filters }: { filters: ReportFilters }) {
  const fetchFn = useServerFn(getReportsEventos);
  const q = useQuery({
    queryKey: ["reports-eventos", filters],
    queryFn: () => fetchFn({ data: filters }),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  if (!q.data) return null;
  const d = q.data;
  const c = d.cards;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-12 gap-4">
        <MetricCard
          label="Eventos publicados"
          value={number(c.publishedEvents.current)}
          icon={Megaphone}
          tone="blue"
        />
        <MetricCard
          label="Ingressos vendidos"
          value={number(c.ticketsSold.current)}
          deltaPct={c.ticketsSold.deltaPct}
          icon={TicketIcon}
          tone="green"
        />
        <MetricCard
          label="Receita"
          value={money(c.revenue.current, "EUR")}
          deltaPct={c.revenue.deltaPct}
          icon={TrendingUp}
          tone="green"
        />
        <MetricCard
          label="Check-ins"
          value={number(c.checkedIn.current)}
          deltaPct={c.checkedIn.deltaPct}
          icon={UserCheck}
          tone="blue"
        />
        <MetricCard
          label="Taxa de comparecimento"
          value={`${c.attendanceRate.current.toFixed(1)}%`}
          icon={Activity}
          tone="amber"
        />
        <MetricCard
          label="Cancelados"
          value={number(c.canceled.current)}
          deltaPct={c.canceled.deltaPct}
          icon={AlertTriangle}
          tone="red"
        />
        <MetricCard
          label="Capacidade média vendida"
          value={`${c.avgCapacityPct.current.toFixed(1)}%`}
          icon={BarChart3}
          tone="neutral"
        />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <BentoCard title="Top eventos por receita" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.topEventsByRevenue.map((e) => ({
              label: `${e.label} · ${number(e.sold)} ing.`,
              value: money(e.revenue, "EUR"),
              raw: e.revenue,
            }))}
            empty="Sem vendas no período."
          />
        </BentoCard>
        <BentoCard title="Top eventos por ingressos" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.topEventsBySold.map((e) => ({
              label: `${e.label} · ${number(e.checkedIn)} check-ins`,
              value: `${number(e.sold)}`,
              raw: e.sold,
            }))}
            empty="Sem dados."
          />
        </BentoCard>
        <BentoCard title="Receita por lote" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.tierRevenue.map((t) => ({
              label: t.label,
              value: money(t.revenue, "EUR"),
              raw: t.revenue,
            }))}
            empty="Sem vendas por lote no período."
          />
        </BentoCard>
        <BentoCard title="Eventos com baixa procura" className="col-span-12 lg:col-span-6">
          {d.lowDemand.length === 0 ? (
            <EmptyState label="Nenhum evento com baixa procura — ótimo!" />
          ) : (
            <ul className="space-y-2">
              {d.lowDemand.map(
                (e: { id: string; title: string; pct: number; sold: number; capacity: number }) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2 text-amber-900 truncate">
                      <AlertTriangle className="h-4 w-4" />
                      {e.title}
                    </span>
                    <span className="font-display tabular-nums text-amber-900">
                      {e.sold}/{e.capacity} ({e.pct.toFixed(0)}%)
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}
        </BentoCard>
        <BentoCard title="Status dos ingressos" className="col-span-12 lg:col-span-4">
          <RankingList
            rows={d.ticketStatus.map((s) => ({
              label: s.label,
              value: `${number(s.count)}`,
              raw: s.count,
            }))}
            empty="Sem dados."
          />
        </BentoCard>
      </div>
    </div>
  );
}

// ---------- Clube do Imigrante ----------

function ClubeTab({ filters }: { filters: ReportFilters }) {
  const fetchFn = useServerFn(getReportsClube);
  const q = useQuery({
    queryKey: ["reports-clube", filters],
    queryFn: () => fetchFn({ data: filters }),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  if (!q.data) return null;
  const d = q.data;
  const c = d.cards;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-12 gap-4">
        <MetricCard
          label="Membros ativos"
          value={number(c.activeMembers.current)}
          icon={Crown}
          tone="green"
        />
        <MetricCard
          label="Novas assinaturas"
          value={number(c.newSubs.current)}
          deltaPct={c.newSubs.deltaPct}
          icon={Sparkles}
          tone="blue"
        />
        <MetricCard
          label="Cancelamentos"
          value={number(c.canceled.current)}
          deltaPct={c.canceled.deltaPct}
          icon={UserMinus}
          tone="red"
        />
        <MetricCard
          label="Inadimplentes/Inativos"
          value={number(c.inactive.current)}
          icon={AlertTriangle}
          tone="amber"
        />
        <MetricCard
          label="Receita do Clube"
          value={money(c.revenue.current)}
          icon={TrendingUp}
          tone="green"
        />
        <MetricCard label="MRR estimado" value={money(c.mrr.current)} icon={Wallet} tone="blue" />
        <MetricCard
          label="Churn"
          value={`${c.churnPct.current.toFixed(1)}%`}
          icon={TrendingDown}
          tone="amber"
        />
        <MetricCard
          label="Pagamentos aprovados"
          value={number(c.approved.current)}
          icon={ShoppingCart}
          tone="neutral"
        />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <BentoCard title="Eventos Hubla no período" className="col-span-12 lg:col-span-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-admin-bg p-3">
              <p className="text-xs text-admin-ink-muted">Recebidos</p>
              <p className="font-display text-2xl text-admin-ink">{number(d.hubla.received)}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="text-xs text-amber-800">Pendentes</p>
              <p className="font-display text-2xl text-amber-900">{number(d.hubla.pending)}</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3">
              <p className="text-xs text-red-800">Com erro</p>
              <p className="font-display text-2xl text-red-900">{number(d.hubla.errors)}</p>
            </div>
          </div>
        </BentoCard>
        <BentoCard title="Tipos de evento Hubla" className="col-span-12 lg:col-span-4">
          <RankingList
            rows={d.eventTypes.map((e) => ({
              label: e.label,
              value: `${number(e.count)}`,
              raw: e.count,
            }))}
            empty="Sem eventos Hubla no período."
          />
        </BentoCard>
        <BentoCard title="Erros recentes Hubla" className="col-span-12 lg:col-span-4">
          {d.recentErrors.length === 0 ? (
            <EmptyState label="Nenhum erro de integração Hubla. 🎉" />
          ) : (
            <ul className="space-y-2">
              {d.recentErrors.map(
                (e: {
                  id: string;
                  event_type: string;
                  error_message: string | null;
                  created_at: string;
                }) => (
                  <li key={e.id} className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900">
                    <div className="font-medium">{e.event_type}</div>
                    <div className="opacity-80 truncate">
                      {e.error_message ?? "Erro não detalhado"}
                    </div>
                    <div className="mt-1 text-[10px] opacity-60">
                      {new Date(e.created_at).toLocaleString("pt-BR")}
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </BentoCard>
        <BentoCard title="Assinaturas vs cancelamentos (diário)" className="col-span-12">
          <SubsDailyChart data={d.dailySeries} />
        </BentoCard>
      </div>
    </div>
  );
}

function SubsDailyChart({ data }: { data: { date: string; news: number; cancels: number }[] }) {
  if (!data.some((d) => d.news > 0 || d.cancels > 0))
    return <EmptyState label="Sem movimentações no período." />;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.008 70)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            fontSize={10}
            stroke="oklch(0.62 0.025 50)"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            fontSize={10}
            stroke="oklch(0.62 0.025 50)"
            tickLine={false}
            axisLine={false}
            width={36}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: "white",
              border: "1px solid oklch(0.91 0.008 70)",
              borderRadius: 12,
              fontSize: 12,
            }}
            labelFormatter={(l) => formatDate(String(l))}
          />
          <Bar dataKey="news" name="Novas" fill="oklch(0.62 0.16 150)" radius={[4, 4, 0, 0]} />
          <Bar
            dataKey="cancels"
            name="Cancelamentos"
            fill="oklch(0.55 0.18 25)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- CRM & SLA ----------

function CrmTab({ filters }: { filters: ReportFilters }) {
  const fetchFn = useServerFn(getReportsCrm);
  const q = useQuery({
    queryKey: ["reports-crm", filters],
    queryFn: () => fetchFn({ data: filters }),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  if (!q.data) return null;
  const d = q.data;
  const c = d.cards;

  return (
    <div className="space-y-4">
      {/* CRM Comercial */}
      <div>
        <p className="font-display text-sm uppercase tracking-wide text-admin-ink-muted mb-2">
          CRM Comercial
        </p>
        <div className="grid grid-cols-12 gap-4">
          <MetricCard
            label="Leads criados"
            value={number(c.leadsCreated.current)}
            deltaPct={c.leadsCreated.deltaPct}
            icon={Sparkles}
            tone="blue"
          />
          <MetricCard
            label="Leads ganhos"
            value={number(c.won.current)}
            deltaPct={c.won.deltaPct}
            icon={TrendingUp}
            tone="green"
          />
          <MetricCard
            label="Leads perdidos"
            value={number(c.lost.current)}
            deltaPct={c.lost.deltaPct}
            icon={TrendingDown}
            tone="red"
          />
          <MetricCard
            label="Leads parados (>7d)"
            value={number(c.stalled.current)}
            icon={AlertTriangle}
            tone="amber"
          />
          <MetricCard
            label="Sem responsável"
            value={number(c.withoutOwner.current)}
            icon={UserMinus}
            tone={c.withoutOwner.current > 0 ? "red" : "green"}
          />
        </div>
      </div>

      {/* SLA WhatsApp */}
      <div>
        <p className="font-display text-sm uppercase tracking-wide text-admin-ink-muted mb-2">
          SLA WhatsApp
        </p>
        <div className="grid grid-cols-12 gap-4">
          <MetricCard
            label="Tempo médio 1ª resposta"
            value={
              c.avgResponseMin.current >= 60
                ? `${(c.avgResponseMin.current / 60).toFixed(1)}h`
                : `${c.avgResponseMin.current.toFixed(1)}min`
            }
            icon={Clock}
            tone="blue"
          />
          <MetricCard
            label="Respondido ≤ 5min"
            value={`${c.pctWithin5.current.toFixed(0)}%`}
            icon={Activity}
            tone="green"
          />
          <MetricCard
            label="Respondido ≤ 30min"
            value={`${c.pctWithin30.current.toFixed(0)}%`}
            icon={Activity}
            tone="green"
          />
          <MetricCard
            label="Inbound"
            value={number(c.inboundMessages.current)}
            icon={MessageSquare}
            tone="neutral"
          />
          <MetricCard
            label="Sem resposta"
            value={number(c.unrepliedInbox.current)}
            icon={MessageSquare}
            tone={c.unrepliedInbox.current > 0 ? "red" : "green"}
          />
          <MetricCard
            label="Convertidas em lead"
            value={number(c.convertedToLead.current)}
            icon={Sparkles}
            tone="green"
          />
          <MetricCard
            label="Leads via WhatsApp"
            value={number(c.leadsViaWhatsapp.current)}
            icon={MessageSquare}
            tone="blue"
          />
        </div>
      </div>

      {/* Follow-ups */}
      <div>
        <p className="font-display text-sm uppercase tracking-wide text-admin-ink-muted mb-2">
          Follow-ups
        </p>
        <div className="grid grid-cols-12 gap-4">
          <MetricCard
            label="Pendentes"
            value={number(c.followupsPending.current)}
            icon={CalendarCheck}
            tone="amber"
          />
          <MetricCard
            label="Atrasados"
            value={number(c.followupsOverdue.current)}
            icon={AlertTriangle}
            tone={c.followupsOverdue.current > 0 ? "red" : "green"}
          />
          <MetricCard
            label="Concluídos no período"
            value={number(c.followupsDone.current)}
            icon={UserCheck}
            tone="green"
          />
          <MetricCard
            label="SLA cumprido"
            value={`${c.slaPct.current.toFixed(0)}%`}
            icon={Activity}
            tone="blue"
          />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <BentoCard title="Funil de leads" className="col-span-12 lg:col-span-6">
          {d.totalInFunnel === 0 ? (
            <EmptyState label="Nenhum lead ativo no funil." />
          ) : (
            <ul className="space-y-3">
              {d.funnel.map((stage) => {
                const pct = d.totalInFunnel > 0 ? (stage.count / d.totalInFunnel) * 100 : 0;
                return (
                  <li key={stage.key} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-admin-ink">{stage.label}</span>
                      <span className="font-display tabular-nums text-admin-ink">
                        {number(stage.count)} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2 w-full bg-admin-bg rounded-full overflow-hidden">
                      <div
                        className="h-full bg-admin-accent rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </BentoCard>
        <BentoCard title="Leads por origem" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.leadsBySource.map((s) => ({
              label: s.label,
              value: `${number(s.count)}`,
              raw: s.count,
            }))}
            empty="Sem leads no período."
          />
        </BentoCard>
        <BentoCard title="Ranking por responsável" className="col-span-12">
          {d.ownerRanking.length === 0 ? (
            <EmptyState label="Nenhum responsável com leads atribuídos no período." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-admin-ink-muted border-b border-admin-border">
                    <th className="py-2 pr-4">Responsável</th>
                    <th className="py-2 pr-4 text-right">Leads recebidos</th>
                    <th className="py-2 pr-4 text-right">Fechados</th>
                    <th className="py-2 pr-4 text-right">Follow-ups feitos</th>
                    <th className="py-2 pr-4 text-right">Leads parados</th>
                    <th className="py-2 pr-4 text-right">Conversão</th>
                  </tr>
                </thead>
                <tbody>
                  {d.ownerRanking.map(
                    (r: {
                      id: string;
                      label: string;
                      received: number;
                      closed: number;
                      stalled: number;
                      followupsDone: number;
                    }) => {
                      const conv = r.received > 0 ? (r.closed / r.received) * 100 : 0;
                      return (
                        <tr key={r.id} className="border-b border-admin-border/60">
                          <td className="py-2 pr-4 text-admin-ink">{r.label}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {number(r.received)}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-emerald-700">
                            {number(r.closed)}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {number(r.followupsDone)}
                          </td>
                          <td
                            className={`py-2 pr-4 text-right tabular-nums ${
                              r.stalled > 0 ? "text-amber-700" : ""
                            }`}
                          >
                            {number(r.stalled)}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">{conv.toFixed(0)}%</td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
          )}
        </BentoCard>
      </div>
    </div>
  );
}
