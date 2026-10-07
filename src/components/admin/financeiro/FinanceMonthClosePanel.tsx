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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettleTransactionPopover } from "./SettleTransactionPopover";
import type { FinanceAccount } from "@/lib/admin/financeiro.functions";
import type {
  FinanceCloseSnapshot,
  FinanceDashboardData,
  FinanceDistribution,
  FinanceMonthClosure,
} from "@/lib/admin/finance-close.functions";

type Currency = "BRL" | "EUR";

function money(cents: number, currency: Currency) {
  return new Intl.NumberFormat(currency === "EUR" ? "pt-PT" : "pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

const STATUS_LABEL = { open: "Aberto", ready: "Pronto para fechar", closed: "Fechado" };

export function FinanceMonthClosePanel({
  month,
  status,
  closure,
  snapshot,
  liveSnapshot,
  distributions,
  analytics,
  accounts,
  prepare,
  close,
  settle,
  createAccount,
  onChanged,
  busy,
}: {
  month: string;
  status: "open" | "ready" | "closed";
  closure: FinanceMonthClosure | null;
  snapshot: FinanceCloseSnapshot;
  liveSnapshot: FinanceCloseSnapshot;
  distributions: FinanceDistribution[];
  analytics: FinanceDashboardData;
  accounts: FinanceAccount[];
  prepare: () => void;
  close: () => void;
  settle: React.ComponentProps<typeof SettleTransactionPopover>["settle"];
  createAccount: React.ComponentProps<typeof SettleTransactionPopover>["createAccount"];
  onChanged: () => void;
  busy: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      <BentoCard title={`Fechamento ${month} · ${STATUS_LABEL[status]}`}>
        <div className="space-y-4 text-sm">
          <p className="text-admin-ink-muted">
            {status === "closed"
              ? `Snapshot final de ${closure?.closed_at?.slice(0, 10) ?? "—"}. Baixas posteriores não alteram este resultado.`
              : status === "ready"
                ? `Revisão preparada em ${closure?.prepared_at?.slice(0, 10) ?? "—"}. Atualize a revisão antes de fechar se houver mudanças.`
                : "Revise receitas, despesas e pendências antes de preparar o fechamento."}
          </p>
          <div className="grid gap-4 xl:grid-cols-2">
            {(["BRL", "EUR"] as const).map((item) => {
              const row = snapshot[item];
              return (
                <section key={item} className="rounded-lg border border-admin-border p-4">
                  <h3 className="mb-3 font-semibold">Resultado {item}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <span>
                      Receita realizada: <strong>{money(row.revenue_realized_cents, item)}</strong>
                    </span>
                    <span>
                      Despesas operacionais:{" "}
                      <strong>{money(row.operational_expenses_cents, item)}</strong>
                    </span>
                    <span>
                      Equipe/Repasses: <strong>{money(row.team_payouts_cents, item)}</strong>
                    </span>
                    <span>
                      Recorrências: <strong>{money(row.recurring_expenses_cents, item)}</strong>
                    </span>
                    {status !== "closed" && (
                      <span>
                        Variáveis projetadas:{" "}
                        <strong>{money(row.projected_payouts_cents, item)}</strong>
                      </span>
                    )}
                    <span>
                      Resultado: <strong>{money(row.result_cents, item)}</strong>
                    </span>
                    <span>
                      Lucro distribuível:{" "}
                      <strong>{money(row.distributable_profit_cents, item)}</strong>
                    </span>
                    <span>
                      Rossini 70%: <strong>{money(row.rossini_cents, item)}</strong>
                    </span>
                    <span>
                      Luana 30%: <strong>{money(row.luana_cents, item)}</strong>
                    </span>
                  </div>
                  <div className="mt-3 border-t border-admin-border pt-3 text-admin-ink-muted">
                    A receber {money(row.receivable_cents, item)} · A pagar{" "}
                    {money(row.payable_cents, item)} · Vencidos anteriores{" "}
                    {money(row.overdue_previous_cents, item)}
                  </div>
                </section>
              );
            })}
          </div>
          {status === "closed" && (
            <p className="text-admin-ink-muted">
              Movimento atual após o fechamento: BRL {money(liveSnapshot.BRL.result_cents, "BRL")} ·
              EUR {money(liveSnapshot.EUR.result_cents, "EUR")}. O snapshot acima permanece fixo.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {status !== "closed" && (
              <Button variant="outline" disabled={busy} onClick={prepare}>
                {status === "ready" ? "Atualizar revisão" : "Preparar fechamento"}
              </Button>
            )}
            {status === "ready" && (
              <Button disabled={busy} onClick={() => setConfirmOpen(true)}>
                Fechar mês
              </Button>
            )}
          </div>
        </div>
      </BentoCard>

      {status === "closed" && (
        <BentoCard title="Distribuições societárias">
          <div className="space-y-2 text-sm">
            {distributions.length === 0 && (
              <p className="text-admin-ink-muted">Sem lucro distribuível neste mês.</p>
            )}
            {distributions.map((distribution) => (
              <div
                key={distribution.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-admin-border py-2 last:border-0"
              >
                <span>
                  {distribution.partner_name} · {distribution.currency} ·{" "}
                  {money(distribution.amount_cents, distribution.currency)}
                </span>
                <div className="flex items-center gap-2">
                  <span>
                    {distribution.transaction?.status === "paid"
                      ? `Pago em ${distribution.transaction.paid_at?.slice(0, 10) ?? "—"}`
                      : "A pagar"}
                  </span>
                  {distribution.transaction &&
                    !["paid", "received", "canceled"].includes(distribution.transaction.status) && (
                      <SettleTransactionPopover
                        transaction={distribution.transaction}
                        accounts={accounts}
                        settle={settle}
                        createAccount={createAccount}
                        onDone={onChanged}
                      />
                    )}
                </div>
              </div>
            ))}
          </div>
        </BentoCard>
      )}

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

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar fechamento definitivo</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-admin-ink-muted">
            Este processo materializa repasses variáveis pendentes, congela o resultado de {month} e
            cria obrigações Rossini/Luana por moeda. Pendências podem ser baixadas depois, mas o
            snapshot não será recalculado.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Voltar
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setConfirmOpen(false);
                close();
              }}
            >
              Confirmar fechamento
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
