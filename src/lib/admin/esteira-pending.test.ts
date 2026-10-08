import { strict as assert } from "node:assert";
import { test } from "node:test";
import { summarizePendingPayments } from "./esteira-pending";

test("pending Esteira banner separates BRL and EUR and ignores resolved orders", () => {
  const orders = [
    {
      payment_status: "pendente",
      amount_cents: 10000,
      currency: "EUR",
      payment_amount_cents: 12000,
      payment_currency: "EUR",
    },
    { payment_status: "pendente", amount_cents: 5000, currency: "BRL" },
    { payment_status: "aprovado", amount_cents: 9000, currency: "EUR" },
    { payment_status: "recusado", amount_cents: 7000, currency: "BRL" },
  ];
  assert.deepEqual(summarizePendingPayments(orders), { count: 2, BRL: 5000, EUR: 12000 });
  assert.deepEqual(summarizePendingPayments(orders.slice(2)), { count: 0, BRL: 0, EUR: 0 });
});
