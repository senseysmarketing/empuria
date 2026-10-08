import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  FinanceCloseSnapshot,
  FinanceDashboardData,
} from "@/lib/admin/finance-close.functions";

type Currency = "BRL" | "EUR";

function money(cents: number, currency: Currency) {
  return new Intl.NumberFormat(currency === "EUR" ? "pt-PT" : "pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function FinanceMonthClosePanel({
  month,
  snapshot,
  analytics,
}: {
  month: string;
  snapshot: FinanceCloseSnapshot;
  analytics: FinanceDashboardData;
}) {
  const [currency, setCurrency] = useState<Currency>("BRL");
  const daily = analytics.daily.filter((row) => row.currency === currency);
  const maxIncome = daily.reduce(
    (best, row) => (row.income_cents > best.income_cents ? row : best),
    { day: "—", income_cents: 0, expense_cents: 0 },
  );
  const maxExpense = daily.reduce(
    (best, row) => (row.expense_cents > best.expense_cents ? row : best),
    { day: "—", income_cents: 0, expense_cents: 0 },
  );
  return (
    <div className="space-y-4">
      <BentoCard title={`Resultado ao vivo · ${month}`}>
        <p className="mb-4 text-sm text-admin-ink-muted">
          Valores recalculados com os lançamentos atuais. Rossini e Luana são apenas uma referência
          informativa; nenhum repasse é gerado automaticamente.
        </p>
        <div className="grid gap-4 xl:grid-cols-2">
          {(["BRL", "EUR"] as const).map((item) => {
            const row = snapshot[item];
            const lines = [
              ["Receita realizada", row.revenue_realized_cents, false],
              ["Despesas operacionais", row.operational_expenses_cents, true],
              ["Equipe / Repasses", row.team_payouts_cents, true],
              ["Recorrências", row.recurring_expenses_cents, true],
              ["Variáveis projetadas", row.projected_payouts_cents, true],
            ] as const;
            return (
              <section key={item} className="rounded-lg border border-admin-border p-4">
                <h3 className="mb-3 font-display font-semibold">Resultado {item}</h3>
                <div className="space-y-2 text-sm">
                  {lines.map(([label, amount, subtract]) => (
                    <div key={label} className="flex justify-between gap-2">
                      <span>
                        {subtract ? "− " : ""}
                        {label}
                      </span>
                      <strong>{money(amount, item)}</strong>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-admin-border pt-2 font-semibold">
                    <span>Resultado atual</span>
                    <span>{money(row.result_cents, item)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Lucro atual</span>
                    <strong>{money(row.distributable_profit_cents, item)}</strong>
                  </div>
                  <div className="grid grid-cols-2 gap-3 border-t border-admin-border pt-3">
                    <div>
                      Rossini 70%<strong className="block">{money(row.rossini_cents, item)}</strong>
                    </div>
                    <div>
                      Luana 30%<strong className="block">{money(row.luana_cents, item)}</strong>
                    </div>
                  </div>
                  <p className="border-t border-admin-border pt-2 text-xs text-admin-ink-muted">
                    A receber {money(row.receivable_cents, item)} · A pagar{" "}
                    {money(row.payable_cents, item)} · Vencidos anteriores{" "}
                    {money(row.overdue_previous_cents, item)}
                  </p>
                </div>
              </section>
            );
          })}
        </div>
      </BentoCard>

      <div className="flex items-center gap-3">
        <h2 className="font-display text-xl font-semibold">Dashboard do mês</h2>
        <Select value={currency} onValueChange={(value) => setCurrency(value as Currency)}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BRL">BRL</SelectItem>
            <SelectItem value="EUR">EUR</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <BentoCard title={`Fluxo diário realizado · ${currency}`}>
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
          <p className="mt-2 text-xs text-admin-ink-muted">
            Pico de entradas: {maxIncome.day} · {money(maxIncome.income_cents, currency)}. Pico de
            saídas: {maxExpense.day} · {money(maxExpense.expense_cents, currency)}.
          </p>
        </BentoCard>
        <BentoCard title="Movimentação por conta">
          <div className="space-y-2 text-sm">
            {analytics.accounts
              .filter((row) => row.currency === currency)
              .map((row) => (
                <div
                  key={`${row.account_id}-${row.currency}`}
                  className="border-b border-admin-border pb-2"
                >
                  <strong>{row.account_name}</strong>
                  <p>
                    Entradas {money(row.income_cents, currency)} · Saídas{" "}
                    {money(row.expense_cents, currency)} · Líquido {money(row.net_cents, currency)}
                  </p>
                </div>
              ))}
            {!analytics.accounts.some((row) => row.currency === currency) && (
              <p className="text-admin-ink-muted">Sem movimentação por conta.</p>
            )}
          </div>
        </BentoCard>
        <BentoCard title="Serviços mais vendidos">
          <div className="space-y-2 text-sm">
            {analytics.services
              .filter((row) => row.currency === currency)
              .map((row, index) => (
                <div
                  key={`${row.service_id ?? row.service_title}-${index}`}
                  className="flex justify-between border-b border-admin-border pb-2"
                >
                  <span>
                    {row.service_title} · {row.quantity} pedido(s)
                  </span>
                  <strong>{money(row.revenue_cents, currency)}</strong>
                </div>
              ))}
            {!analytics.services.some((row) => row.currency === currency) && (
              <p className="text-admin-ink-muted">Sem serviços pagos.</p>
            )}
          </div>
        </BentoCard>
        <BentoCard title="Maiores despesas realizadas">
          <div className="space-y-2 text-sm">
            {analytics.expenses
              .filter((row) => row.currency === currency)
              .map((row, index) => (
                <div
                  key={`${row.category_id ?? "none"}-${index}`}
                  className="flex justify-between border-b border-admin-border pb-2"
                >
                  <span>{row.category_name}</span>
                  <strong>{money(row.amount_cents, currency)}</strong>
                </div>
              ))}
            {!analytics.expenses.some((row) => row.currency === currency) && (
              <p className="text-admin-ink-muted">Sem despesas realizadas.</p>
            )}
          </div>
        </BentoCard>
        <BentoCard title="Recorrências">
          {(() => {
            const row = analytics.recurring.find((item) => item.currency === currency);
            return (
              <p className="text-sm">
                Previsto {money(row?.planned_cents ?? 0, currency)} · Pago{" "}
                {money(row?.paid_cents ?? 0, currency)} · Pendente{" "}
                {money(row?.pending_cents ?? 0, currency)}
              </p>
            );
          })()}
        </BentoCard>
        <BentoCard title="Equipe & Repasses">
          {(() => {
            const row = analytics.team.find((item) => item.currency === currency);
            return (
              <p className="text-sm">
                Projetado {money(row?.projected_cents ?? 0, currency)} · A pagar{" "}
                {money(row?.payable_cents ?? 0, currency)} · Pago{" "}
                {money(row?.paid_cents ?? 0, currency)}
              </p>
            );
          })()}
        </BentoCard>
      </div>
    </div>
  );
}
