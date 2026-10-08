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
      {(["BRL", "EUR"] as const).map((currency) => {
        const daily = analytics.daily.filter((row) => row.currency === currency);
        const services = analytics.services.filter(
          (row) =>
            row.currencies[currency].sold_cents > 0 || row.currencies[currency].received_cents > 0,
        );
        const expenses = analytics.expenses.filter((row) => row.currency === currency);
        const recurring = analytics.recurring.find((row) => row.currency === currency);
        const team = analytics.team.find((row) => row.currency === currency);
        return (
          <section key={currency} className="space-y-4">
            <h3 className="font-display text-lg font-semibold">Painel {currency}</h3>
            <div className="grid gap-4 xl:grid-cols-2">
              <BentoCard title="Fluxo diário realizado">
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
              <BentoCard title="Serviços mais vendidos">
                <div className="space-y-2 text-sm">
                  {services.map((row) => (
                    <div
                      key={`${row.service_id ?? row.service_title}-${currency}`}
                      className="border-b border-admin-border pb-2"
                    >
                      <strong>
                        {row.service_title} · {row.sales_count} pedido(s)
                      </strong>
                      <p>
                        Vendido {money(row.currencies[currency].sold_cents, currency)} · Recebido{" "}
                        {money(row.currencies[currency].received_cents, currency)} · A receber{" "}
                        {money(row.currencies[currency].receivable_cents, currency)}
                      </p>
                    </div>
                  ))}
                  {!services.length && <p className="text-admin-ink-muted">Sem vendas no mês.</p>}
                </div>
              </BentoCard>
              <BentoCard title="Maiores despesas do mês">
                <div className="space-y-2 text-sm">
                  {expenses.map((row) => (
                    <div
                      key={`${row.category_id ?? "none"}-${currency}`}
                      className="flex justify-between border-b border-admin-border pb-2"
                    >
                      <span>{row.category_name}</span>
                      <strong>{money(row.amount_cents, currency)}</strong>
                    </div>
                  ))}
                  {!expenses.length && <p className="text-admin-ink-muted">Sem despesas no mês.</p>}
                </div>
              </BentoCard>
              <BentoCard title="Recorrências">
                <p className="text-sm">
                  Pago {money(recurring?.paid_cents ?? 0, currency)} · A pagar{" "}
                  {money(recurring?.pending_cents ?? 0, currency)}
                </p>
              </BentoCard>
              <BentoCard title="Equipe & Repasses">
                <p className="text-sm">
                  Pago {money(team?.paid_cents ?? 0, currency)} · A pagar{" "}
                  {money(team?.payable_cents ?? 0, currency)}
                </p>
              </BentoCard>
            </div>
          </section>
        );
      })}
    </div>
  );
}
