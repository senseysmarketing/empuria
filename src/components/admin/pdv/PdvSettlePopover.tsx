import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { getEurBrlReferenceRate } from "@/lib/finance/fx.functions";
import type { PdvSaleRecord } from "@/lib/admin/pdv-sales.functions";

type Currency = "BRL" | "EUR";
type Account = { id: string; name: string; currency: string; is_active: boolean };

export function PdvSettlePopover({
  sale,
  accounts,
  settle,
  onDone,
}: {
  sale: PdvSaleRecord;
  accounts: Account[];
  settle: (input: {
    saleId: string;
    paidAt: string;
    settledAmount: number;
    settledCurrency: Currency;
    accountId: string;
    fxReferenceRate?: number | null;
    fxReferenceDate?: string | null;
    fxRate?: number | null;
    fxSource?: string | null;
  }) => Promise<unknown>;
  onDone: () => void;
}) {
  const fetchFx = useServerFn(getEurBrlReferenceRate);
  const baseCurrency: Currency = sale.payment_currency === "BRL" ? "BRL" : "EUR";
  const baseAmount = (sale.payment_amount_cents ?? sale.total_eur_cents) / 100;
  const [open, setOpen] = useState(false);
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState<Currency>(baseCurrency);
  const [amount, setAmount] = useState(baseAmount.toFixed(2));
  const [accountId, setAccountId] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [saving, setSaving] = useState(false);
  const conversion = currency !== baseCurrency;

  useEffect(() => {
    if (!open) return;
    setPaidAt(new Date().toISOString().slice(0, 10));
    setCurrency(baseCurrency);
    setAmount(baseAmount.toFixed(2));
    setAccountId("");
    setFxRate("");
  }, [open, baseCurrency, baseAmount]);

  const fxQ = useQuery({
    queryKey: ["pdv-fx-reference", paidAt],
    queryFn: () => fetchFx({ data: { date: paidAt } }),
    enabled: open && conversion,
    staleTime: 30 * 60 * 1000,
  });
  useEffect(() => {
    if (!conversion) return;
    if (fxQ.data?.ok) setFxRate(String(fxQ.data.rate));
  }, [conversion, fxQ.data]);
  useEffect(() => {
    const rate = Number(fxRate);
    if (!conversion || !Number.isFinite(rate) || rate <= 0) return;
    setAmount((baseCurrency === "EUR" ? baseAmount * rate : baseAmount / rate).toFixed(2));
  }, [baseAmount, baseCurrency, conversion, fxRate]);

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const canSave =
    !saving &&
    paidAt &&
    Number(amount) > 0 &&
    selectedAccount?.currency === currency &&
    (!conversion || Number(fxRate) > 0) &&
    !fxQ.isFetching;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <CheckCircle2 className="h-4 w-4" /> Dar baixa
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <strong className="text-sm">Dar baixa · {sale.sale_code}</strong>
          <p className="text-xs text-muted-foreground">
            Valor da venda: {baseCurrency} {baseAmount.toFixed(2)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Data do pagamento</Label>
            <Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
          </div>
          <div>
            <Label>Moeda recebida</Label>
            <Select
              value={currency}
              onValueChange={(value: Currency) => {
                setCurrency(value);
                setAccountId("");
                setFxRate("");
                setAmount(baseAmount.toFixed(2));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EUR">EUR</SelectItem>
                <SelectItem value="BRL">BRL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {conversion && (
          <div className="space-y-2 rounded bg-muted p-2 text-xs">
            <div>
              {fxQ.isFetching
                ? "Buscando PTAX…"
                : fxQ.data?.ok
                  ? `PTAX: ${fxQ.data.rate.toFixed(4)} em ${fxQ.data.date}`
                  : "PTAX indisponível — informe a cotação manualmente."}
            </div>
            <Label>Cotação aplicada EUR/BRL</Label>
            <Input
              type="number"
              min="0.0001"
              step="0.0001"
              value={fxRate}
              onChange={(event) => setFxRate(event.target.value)}
            />
          </div>
        )}
        <div>
          <Label>Valor realizado</Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div>
          <Label>Conta {currency}</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione uma conta ativa" />
            </SelectTrigger>
            <SelectContent>
              {accounts
                .filter((account) => account.currency === currency)
                .map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="w-full"
          disabled={!canSave}
          onClick={async () => {
            setSaving(true);
            try {
              await settle({
                saleId: sale.id,
                paidAt,
                settledAmount: Number(amount),
                settledCurrency: currency,
                accountId,
                fxReferenceRate: conversion && fxQ.data?.ok ? fxQ.data.rate : null,
                fxReferenceDate: conversion && fxQ.data?.ok ? fxQ.data.date : null,
                fxRate: conversion ? Number(fxRate) : null,
                fxSource: conversion ? (fxQ.data?.ok ? fxQ.data.source : "MANUAL") : null,
              });
              setOpen(false);
              onDone();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Erro ao dar baixa");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar baixa"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
