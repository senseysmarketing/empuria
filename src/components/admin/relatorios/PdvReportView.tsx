import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Loader2,
  Package,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BentoCard } from "@/components/admin/BentoCard";
import { getReportsPdv, type ReportFilters } from "@/lib/admin/reports.functions";

function money(cents: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format((cents ?? 0) / 100);
}
function number(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n);
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  const cls = up ? "text-emerald-700 bg-emerald-100" : "text-red-800 bg-red-100";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
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
          {hint && <p className="mt-0.5 text-xs text-admin-ink-muted tabular-nums truncate">{hint}</p>}
          {deltaPct !== undefined && <div className="mt-1"><DeltaBadge pct={deltaPct ?? null} /></div>}
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

function EmptyState({ label }: { label: string }) {
  return <div className="flex h-32 items-center justify-center text-sm text-admin-ink-muted">{label}</div>;
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
              <span className="font-display tabular-nums text-admin-ink text-right">{r.value}</span>
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

function HourlySalesChart({ data }: { data: { hour: number; revenue: number; sales: number }[] }) {
  if (!data.some((d) => d.sales > 0)) return <EmptyState label="Sem vendas no período." />;
  const chart = data.map((d) => ({
    label: `${String(d.hour).padStart(2, "0")}h`,
    value: (d.revenue ?? 0) / 100,
    sales: d.sales,
  }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.008 70)" vertical={false} />
          <XAxis dataKey="label" fontSize={10} stroke="oklch(0.62 0.025 50)" tickLine={false} axisLine={false} interval={1} />
          <YAxis fontSize={10} stroke="oklch(0.62 0.025 50)" tickLine={false} axisLine={false} width={60} tickFormatter={(v) => `€${Number(v).toFixed(0)}`} />
          <Tooltip
            contentStyle={{ background: "white", border: "1px solid oklch(0.91 0.008 70)", borderRadius: 12, fontSize: 12 }}
            formatter={(v: unknown, n: unknown) => (n === "sales" ? [`${v}`, "Vendas"] : [`€ ${Number(v).toFixed(2)}`, "Receita"])}
          />
          <Bar dataKey="value" name="Receita" fill="oklch(0.58 0.18 45)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PdvReportView({ filters }: { filters: ReportFilters }) {
  const fetchFn = useServerFn(getReportsPdv);
  const q = useQuery({
    queryKey: ["reports-pdv", filters],
    queryFn: () => fetchFn({ data: filters }),
  });

  if (q.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-admin-accent" />
      </div>
    );
  }
  if (q.error) {
    return (
      <BentoCard padded>
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-700 mt-0.5" />
          <div>
            <p className="font-display text-sm text-red-800">Erro ao carregar relatório</p>
            <p className="text-xs text-admin-ink-muted mt-1">
              {q.error instanceof Error ? q.error.message : "Falha desconhecida"}
            </p>
          </div>
        </div>
      </BentoCard>
    );
  }
  if (!q.data) return null;
  const d = q.data;
  const c = d.cards;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-12 gap-4">
        <MetricCard label="Faturamento PDV" value={money(c.revenue.currentEur ?? 0)} deltaPct={c.revenue.deltaPct} icon={TrendingUp} tone="green" />
        <MetricCard label="Vendas concluídas" value={number(c.salesCount.current)} deltaPct={c.salesCount.deltaPct} icon={ShoppingCart} tone="blue" />
        <MetricCard label="Ticket médio" value={money(c.ticket.currentEur ?? 0)} deltaPct={c.ticket.deltaPct} icon={BarChart3} tone="neutral" />
        <MetricCard label="Itens vendidos" value={number(c.itemsSold.current)} icon={Package} tone="amber" />
        <MetricCard label="Vendas anuladas" value={number(c.voided.current)} deltaPct={c.voided.deltaPct} icon={AlertTriangle} tone="red" />
        <MetricCard label="Descontos concedidos" value={money(c.discounts.currentEur ?? 0)} deltaPct={c.discounts.deltaPct} icon={TrendingDown} tone="amber" />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <BentoCard title="Top 10 produtos mais vendidos" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.topProducts.map((p) => ({
              label: `${p.name} · ${number(p.qty)}un`,
              value: money(p.revenue),
              raw: p.qty,
            }))}
            empty="Sem vendas no período."
          />
        </BentoCard>
        <BentoCard title="Top operadores" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.topCashiers.map((c) => ({
              label: `${c.label} · ${number(c.count)} vendas`,
              value: money(c.revenue),
              raw: c.revenue,
            }))}
            empty="Sem operadores no período."
          />
        </BentoCard>
        <BentoCard title="Formas de pagamento" className="col-span-12 lg:col-span-6">
          <RankingList
            rows={d.paymentMethods.map((p) => ({
              label: `${p.label} · ${number(p.count)}x`,
              value: money(p.revenue),
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
                <li key={p.id} className="flex items-center justify-between rounded-lg bg-admin-bg px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 text-admin-ink truncate">
                    <Boxes className="h-4 w-4 text-amber-600" />
                    {p.name}
                  </span>
                  <span className={`font-display tabular-nums ${p.stock_quantity === 0 ? "text-red-700" : "text-amber-700"}`}>
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
