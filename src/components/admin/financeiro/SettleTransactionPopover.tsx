import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
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
import { FinanceAccountCombobox } from "./FinanceAccountCombobox";

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
    settledCurrency: "BRL" | "EUR";
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
  const [open, setOpen] = useState(false);
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(String(transaction.amount_cents / 100));
  const [currency, setCurrency] = useState<"BRL" | "EUR">(
    transaction.currency === "EUR" ? "EUR" : "BRL",
  );
  const [accountId, setAccountId] = useState(transaction.account_id ?? "");
  const [fxRate, setFxRate] = useState(transaction.fx_rate ? String(transaction.fx_rate) : "");
  const conversion =
    !!transaction.reference_currency && transaction.reference_currency !== currency;
  const mutation = useMutation({
    mutationFn: () =>
      settle({
        id: transaction.id,
        paidAt,
        settledAmount: Number(amount),
        settledCurrency: currency,
        accountId,
        fxReferenceRate: transaction.fx_reference_rate,
        fxReferenceDate: transaction.fx_date,
        fxRate: fxRate ? Number(fxRate) : null,
        fxSource: transaction.fx_source ?? (fxRate ? "MANUAL" : null),
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
            Previsto:{" "}
            {new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: transaction.currency,
            }).format(transaction.amount_cents / 100)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Data</Label>
            <Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
          </div>
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
        </div>
        <div>
          <Label>Moeda recebida</Label>
          <Select
            value={currency}
            onValueChange={(value) => {
              setCurrency(value as "BRL" | "EUR");
              setAccountId("");
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
        {conversion && (
          <div className="rounded bg-muted p-2 text-xs">
            Original: {transaction.reference_currency}{" "}
            {((transaction.reference_amount_cents ?? 0) / 100).toFixed(2)}
            <div className="mt-2">
              <Label>Cotação aplicada</Label>
              <Input
                type="number"
                step="0.0001"
                value={fxRate}
                onChange={(event) => setFxRate(event.target.value)}
              />
            </div>
          </div>
        )}
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
          disabled={!accountId || !amount || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Confirmando..." : "Confirmar baixa"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
