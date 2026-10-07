import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FinanceAccount, FinanceTransaction } from "@/lib/admin/financeiro.functions";
import { getEurBrlReferenceRate } from "@/lib/finance/fx.functions";
import { FinanceAccountCombobox } from "./FinanceAccountCombobox";

type Currency = "BRL" | "EUR";

function transactionBase(transaction: FinanceTransaction) {
  const currency =
    transaction.reference_currency === "BRL" || transaction.reference_currency === "EUR"
      ? transaction.reference_currency
      : transaction.currency === "EUR"
        ? "EUR"
        : "BRL";
  const amountCents = transaction.reference_currency
    ? (transaction.reference_amount_cents ?? transaction.amount_cents)
    : transaction.amount_cents;
  return { currency, amountCents } as { currency: Currency; amountCents: number };
}

export function SettleTransactionPopover({
  transaction,
  accounts,
  settle,
  createAccount,
  onDone,
}: {
  transaction: FinanceTransaction;
  accounts: FinanceAccount[];
  settle: (data: {
    id: string;
    paidAt: string;
    settledAmount: number;
    settledCurrency: Currency;
    accountId: string;
    fxReferenceRate?: number | null;
    fxReferenceDate?: string | null;
    fxRate?: number | null;
    fxSource?: string | null;
    notes?: string | null;
  }) => Promise<unknown>;
  createAccount: (name: string, currency: "BRL" | "EUR" | "USD") => Promise<string>;
  onDone: () => void;
}) {
  const fetchFx = useServerFn(getEurBrlReferenceRate);
  const base = useMemo(() => transactionBase(transaction), [transaction]);
  const [open, setOpen] = useState(false);
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(String(transaction.amount_cents / 100));
  const [currency, setCurrency] = useState<Currency>(
    transaction.currency === "EUR" ? "EUR" : "BRL",
  );
  const [accountId, setAccountId] = useState(transaction.account_id ?? "");
  const [fxReferenceRate, setFxReferenceRate] = useState<number | null>(
    transaction.fx_reference_rate,
  );
  const [fxReferenceDate, setFxReferenceDate] = useState<string | null>(transaction.fx_date);
  const [fxRate, setFxRate] = useState(transaction.fx_rate ? String(transaction.fx_rate) : "");
  const [fxSource, setFxSource] = useState<string | null>(transaction.fx_source);
  const conversion = base.currency !== currency;

  useEffect(() => {
    if (!open) return;
    const initialCurrency = transaction.currency === "EUR" ? "EUR" : "BRL";
    setPaidAt(new Date().toISOString().slice(0, 10));
    setAmount(String(transaction.amount_cents / 100));
    setCurrency(initialCurrency);
    setAccountId(
      accounts.some(
        (account) => account.id === transaction.account_id && account.currency === initialCurrency,
      )
        ? (transaction.account_id ?? "")
        : "",
    );
    setFxReferenceRate(transaction.fx_reference_rate);
    setFxReferenceDate(transaction.fx_date);
    setFxRate(transaction.fx_rate ? String(transaction.fx_rate) : "");
    setFxSource(transaction.fx_source);
  }, [accounts, open, transaction]);

  const fxQ = useQuery({
    queryKey: ["settlement-eur-brl-reference", transaction.id, paidAt, base.currency, currency],
    queryFn: () => fetchFx({ data: { date: paidAt } }),
    enabled: open && conversion,
    staleTime: 30 * 60 * 1000,
  });

  useEffect(() => {
    if (!conversion) {
      setFxReferenceRate(null);
      setFxReferenceDate(null);
      setFxRate("");
      setFxSource(null);
      setAmount((base.amountCents / 100).toFixed(2));
      return;
    }
    if (fxQ.data?.ok) {
      setFxReferenceRate(fxQ.data.rate);
      setFxReferenceDate(fxQ.data.date);
      setFxRate(String(fxQ.data.rate));
      setFxSource(fxQ.data.source);
    } else if (fxQ.data && !fxQ.data.ok) {
      setFxReferenceRate(null);
      setFxReferenceDate(null);
      setFxSource("MANUAL");
    }
  }, [base.amountCents, conversion, fxQ.data]);

  useEffect(() => {
    const rate = Number(fxRate);
    if (!conversion || !rate) return;
    const baseAmount = base.amountCents / 100;
    const converted = base.currency === "EUR" ? baseAmount * rate : baseAmount / rate;
    setAmount(converted.toFixed(2));
  }, [base.amountCents, base.currency, conversion, fxRate]);

  const mutation = useMutation({
    mutationFn: () =>
      settle({
        id: transaction.id,
        paidAt,
        settledAmount: Number(amount),
        settledCurrency: currency,
        accountId,
        fxReferenceRate: conversion ? fxReferenceRate : null,
        fxReferenceDate: conversion ? fxReferenceDate : null,
        fxRate: conversion && fxRate ? Number(fxRate) : null,
        fxSource: conversion ? (fxSource ?? "MANUAL") : null,
      }),
    onSuccess: () => {
      toast.success("Baixa confirmada");
      setOpen(false);
      onDone();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro ao dar baixa"),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <CheckCircle2 className="h-4 w-4" /> Dar baixa
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <strong className="text-sm">Dar baixa</strong>
          <p className="text-xs text-muted-foreground">
            Previsto: {formatMoney(transaction.amount_cents, transaction.currency)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Data</Label>
            <Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
          </div>
          <div>
            <Label>Moeda realizada</Label>
            <Select
              value={currency}
              onValueChange={(value) => {
                setCurrency(value as Currency);
                setAccountId("");
                setFxReferenceRate(null);
                setFxReferenceDate(null);
                setFxRate("");
                setFxSource(value === base.currency ? null : "MANUAL");
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
          </div>
        </div>
        {conversion && (
          <div className="space-y-2 rounded bg-muted p-2 text-xs">
            <div>Valor de referência: {formatMoney(base.amountCents, base.currency)}</div>
            <div>
              <Label>PTAX EUR/BRL</Label>
              <div className="mt-1 min-h-5 text-muted-foreground">
                {fxQ.isFetching ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Buscando referência…
                  </span>
                ) : fxReferenceRate ? (
                  `${fxReferenceRate.toFixed(4)} em ${fxReferenceDate}`
                ) : (
                  "Referência indisponível — informe a cotação manualmente."
                )}
              </div>
            </div>
            <div>
              <Label>Cotação aplicada</Label>
              <Input
                type="number"
                min="0.0001"
                step="0.0001"
                value={fxRate}
                onChange={(event) => {
                  setFxRate(event.target.value);
                  if (!fxReferenceRate) setFxSource("MANUAL");
                }}
              />
            </div>
          </div>
        )}
        <div>
          <Label>Valor realizado</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div>
          <Label>Conta</Label>
          <FinanceAccountCombobox
            accounts={accounts}
            currency={currency}
            value={accountId}
            onChange={setAccountId}
            onCreate={createAccount}
          />
        </div>
        <Button
          className="w-full"
          disabled={
            !accountId || !amount || (conversion && !fxRate) || fxQ.isFetching || mutation.isPending
          }
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Confirmando..." : "Confirmar baixa"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(currency === "EUR" ? "pt-PT" : "pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}
