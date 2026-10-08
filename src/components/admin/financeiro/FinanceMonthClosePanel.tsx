import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BentoCard } from "@/components/admin/BentoCard";
import type { FinanceDashboardData } from "@/lib/admin/finance-close.functions";

type Currency = "BRL" | "EUR";

function money(cents: number, currency: Currency) {
  return new Intl.NumberFormat(currency === "EUR" ? "pt-PT" : "pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function FinanceMonthClosePanel({
  month,
  analytics,
}: {
  month: string;
  analytics: FinanceDashboardData;
}) {
  return (
    <div className="space-y-4">
      <BentoCard title={`Resultado ao vivo · ${month}`}>
        <p className="mb-4 text-sm text-admin-ink-muted">
          Receitas recebidas e despesas do mês. Rossini e Luana são apenas uma referência
          informativa; nenhum repasse é gerado automaticamente.
        </p>
        <div className="grid gap-4 xl:grid-cols-2">
          {(["BRL", "EUR"] as const).map((currency) => {
            const row = analytics.snapshot[currency];
            return (
              <section key={currency} className="rounded-lg border border-admin-border p-4">
                <h3 className="mb-3 font-display font-semibold">Resultado {currency}</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span>Recebido</span>
                    <strong>{money(row.revenue_realized_cents, currency)}</strong>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Despesas operacionais</span>
                    <strong>{money(row.operational_expenses_cents, currency)}</strong>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Equipe / Repasses</span>
                    <strong>{money(row.team_payouts_cents, currency)}</strong>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Recorrências</span>
                    <strong>{money(row.recurring_expenses_cents, currency)}</strong>
                  </div>
                  <div className="flex justify-between border-t border-admin-border pt-2 font-semibold">
                    <span>Resultado atual</span>
                    <span>{money(row.result_cents, currency)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 border-t border-admin-border pt-3">
                    <div>
                      Rossini 70%
                      <strong className="block">{money(row.rossini_cents, currency)}</strong>
                    </div>
                    <div>
                      Luana 30%<strong className="block">{money(row.luana_cents, currency)}</strong>
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </BentoCard>
      <h2 className="font-display text-xl font-semibold">Dashboard do mês</h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {(["BRL", "EUR"] as const).map((currency) => {
          const daily = analytics.daily.filter((row) => row.currency === currency);
          return (
            <BentoCard key={currency} title={`Fluxo diário realizado · ${currency}`}>
              {daily.length ? (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={daily} margin={{ left: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" tickFormatter={(day: string) => day.slice(8)} />
                      <YAxis tickFormatter={(value: number) => `${Math.round(value / 100)}`} />
                      <Tooltip formatter={(value) => money(Number(value ?? 0), currency)} />
                      <Legend />
                      <Bar dataKey="income_cents" name="Entradas" fill="#059669" />
                      <Bar dataKey="expense_cents" name="Saídas" fill="#dc2626" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-admin-ink-muted">Sem movimento realizado.</p>
              )}
            </BentoCard>
          );
        })}
        <BentoCard title="Serviços mais vendidos">
          <div className="space-y-3 text-sm">
            {analytics.services.map((row) => (
              <div
                key={row.service_id ?? row.service_title}
                className="border-b border-admin-border pb-2"
              >
                <strong>
                  {row.service_title} · {row.sales_count} pedido(s)
                </strong>
                {(["BRL", "EUR"] as const).map((currency) => {
                  const amounts = row.currencies[currency];
                  if (!amounts.sold_cents && !amounts.received_cents) return null;
                  return (
                    <p key={currency}>
                      {currency}: vendido {money(amounts.sold_cents, currency)} · recebido{" "}
                      {money(amounts.received_cents, currency)} · a receber{" "}
                      {money(amounts.receivable_cents, currency)}
                    </p>
                  );
                })}
              </div>
            ))}
            {!analytics.services.length && (
              <p className="text-admin-ink-muted">Sem vendas no mês.</p>
            )}
          </div>
        </BentoCard>
        <BentoCard title="Maiores despesas do mês">
          <div className="space-y-2 text-sm">
            {analytics.expenses.map((row) => (
              <div
                key={`${row.category_id ?? "none"}-${row.currency}`}
                className="flex justify-between border-b border-admin-border pb-2"
              >
                <span>
                  {row.category_name} · {row.currency}
                </span>
                <strong>{money(row.amount_cents, row.currency)}</strong>
              </div>
            ))}
            {!analytics.expenses.length && (
              <p className="text-admin-ink-muted">Sem despesas no mês.</p>
            )}
          </div>
        </BentoCard>
        <BentoCard title="Recorrências">
          {(["BRL", "EUR"] as const).map((currency) => {
            const row = analytics.recurring.find((item) => item.currency === currency);
            return (
              <p key={currency} className="text-sm">
                {currency}: pago {money(row?.paid_cents ?? 0, currency)} · a pagar{" "}
                {money(row?.pending_cents ?? 0, currency)}
              </p>
            );
          })}
        </BentoCard>
        <BentoCard title="Equipe & Repasses">
          {(["BRL", "EUR"] as const).map((currency) => {
            const row = analytics.team.find((item) => item.currency === currency);
            return (
              <p key={currency} className="text-sm">
                {currency}: pago {money(row?.paid_cents ?? 0, currency)} · a pagar{" "}
                {money(row?.payable_cents ?? 0, currency)}
              </p>
            );
          })}
        </BentoCard>
        <BentoCard title="PDV · Caixa e pendências">
          <p className="mb-3 text-xs text-admin-ink-muted">
            Valores já incluídos no Resumo acima; não são somados novamente.
          </p>
          {(["BRL", "EUR"] as const).map((currency) => {
            const row = analytics.pdv?.find((item) => item.currency === currency);
            return (
              <p key={currency} className="text-sm">
                {currency}: recebido {money(row?.received_cents ?? 0, currency)} · pendente{" "}
                {money(row?.pending_cents ?? 0, currency)}
              </p>
            );
          })}
        </BentoCard>
      </div>
    </div>
  );
}
