export function summarizePendingPayments(
  orders: readonly {
    payment_status: string;
    payment_amount_cents?: number | null;
    amount_cents?: number | null;
    payment_currency?: string | null;
    currency?: string | null;
  }[],
) {
  const summary = { count: 0, BRL: 0, EUR: 0 };
  for (const order of orders) {
    if (order.payment_status !== "pendente") continue;
    summary.count += 1;
    const currency = order.payment_currency ?? order.currency;
    const amount = order.payment_amount_cents ?? order.amount_cents ?? 0;
    if (currency === "BRL" || currency === "EUR") summary[currency] += amount;
  }
  return summary;
}
