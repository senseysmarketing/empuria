import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createCustomerLite,
  createOrderFull,
  searchCustomers,
} from "@/lib/admin/esteira.functions";
import { listServicesAdmin } from "@/lib/admin/slots.functions";
import { getEurBrlReferenceRate } from "@/lib/finance/fx.functions";

type Currency = "BRL" | "EUR";
type PaymentState = "pending" | "received" | "gratuito";
type Customer = {
  id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};
type Service = {
  id: string;
  title: string;
  price_cents: number;
  currency?: string | null;
  online_price_cents: number | null;
  online_currency: string | null;
};

function money(cents: number, currency: Currency) {
  return new Intl.NumberFormat(currency === "EUR" ? "pt-PT" : "pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function NewOrderWizard({
  open,
  onOpenChange,
  onCreated,
  initiatedFrom = "esteira",
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onCreated: () => void;
  initiatedFrom?: "esteira" | "financeiro";
}) {
  const search = useServerFn(searchCustomers);
  const createCustomer = useServerFn(createCustomerLite);
  const fetchServices = useServerFn(listServicesAdmin);
  const createOrder = useServerFn(createOrderFull);
  const fetchFx = useServerFn(getEurBrlReferenceRate);
  const [step, setStep] = useState(1);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [newCust, setNewCust] = useState({ full_name: "", email: "", phone: "" });
  const [serviceMode, setServiceMode] = useState<"cadastrado" | "avulso">("cadastrado");
  const [service, setService] = useState<Service | null>(null);
  const [title, setTitle] = useState("");
  const [commercialAmount, setCommercialAmount] = useState("");
  const [commercialCurrency, setCommercialCurrency] = useState<Currency>("EUR");
  const [paymentCurrency, setPaymentCurrency] = useState<Currency>("EUR");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [paymentState, setPaymentState] = useState<PaymentState>("pending");
  const [settledAmount, setSettledAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [confirmFree, setConfirmFree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(false);

  const { data: services = [] } = useQuery({
    queryKey: ["admin-services-wizard"],
    queryFn: () => fetchServices(),
    enabled: open,
  });
  const conversion = commercialCurrency !== paymentCurrency;
  const fxQ = useQuery({
    queryKey: ["eur-brl-reference", paidAt],
    queryFn: () => fetchFx({ data: { date: paidAt } }),
    enabled: open && conversion,
    staleTime: 30 * 60 * 1000,
  });
  const commercialCents = Math.round(Number(commercialAmount || 0) * 100);
  const paymentCents = Math.round(Number(paymentAmount || 0) * 100);
  const settledCents = Math.round(Number(settledAmount || 0) * 100);
  const isFree = commercialCents === 0;

  useEffect(() => {
    if (!open) {
      setStep(1);
      setCustomer(null);
      setQuery("");
      setResults([]);
      setService(null);
      setTitle("");
      setCommercialAmount("");
      setCommercialCurrency("EUR");
      setPaymentCurrency("EUR");
      setPaymentAmount("");
      setFxRate("");
      setPaymentState("pending");
      setSettledAmount("");
      setNotes("");
      setConfirmFree(false);
      setCreated(false);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(
      () =>
        search({ data: { q } })
          .then(setResults)
          .catch(() => setResults([])),
      300,
    );
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    if (!conversion) {
      setFxRate("");
      setPaymentAmount(commercialAmount);
      return;
    }
    if (fxQ.data?.ok && fxQ.data.rate) setFxRate(String(fxQ.data.rate));
  }, [conversion, fxQ.data, commercialAmount]);

  useEffect(() => {
    const rate = Number(fxRate);
    if (!conversion || !rate || !commercialAmount) return;
    const converted =
      commercialCurrency === "EUR"
        ? Number(commercialAmount) * rate
        : Number(commercialAmount) / rate;
    setPaymentAmount(converted.toFixed(2));
  }, [fxRate, commercialAmount, commercialCurrency, conversion]);

  useEffect(() => {
    if (paymentState === "received") setSettledAmount(paymentAmount);
  }, [paymentState, paymentAmount]);
  useEffect(() => {
    if (isFree) setPaymentState("gratuito");
    else if (paymentState === "gratuito") setPaymentState("pending");
  }, [isFree, paymentState]);

  const canSubmit =
    !!customer &&
    commercialAmount !== "" &&
    paymentAmount !== "" &&
    (!conversion || Number(fxRate) > 0) &&
    (serviceMode === "cadastrado" ? !!service : title.trim().length >= 2) &&
    (!isFree || confirmFree) &&
    (paymentState !== "received" || settledAmount !== "");

  const selectService = (id: string) => {
    const selected = (services as Service[]).find((item) => item.id === id);
    if (!selected) return;
    const currency = ((selected.online_price_cents != null
      ? selected.online_currency
      : selected.currency) ?? "EUR") as Currency;
    const cents = selected.online_price_cents ?? selected.price_cents ?? 0;
    setService(selected);
    setCommercialCurrency(currency);
    setPaymentCurrency(currency);
    setCommercialAmount((cents / 100).toFixed(2));
    setPaymentAmount((cents / 100).toFixed(2));
  };

  const createNewCustomer = async () => {
    try {
      const value = await createCustomer({ data: newCust });
      setCustomer({
        id: value.user_id,
        full_name: value.full_name,
        email: value.email,
        phone: value.phone,
      });
      toast.success("Cliente vinculado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao criar cliente");
    }
  };

  const submit = async () => {
    if (!canSubmit || !customer) return;
    setSubmitting(true);
    try {
      await createOrder({
        data: {
          user_id: customer.id,
          customer_name: customer.full_name ?? "Sem nome",
          customer_email: customer.email,
          service_id: serviceMode === "cadastrado" ? service?.id : null,
          service_title: serviceMode === "cadastrado" ? service!.title : title,
          amount_cents: commercialCents,
          currency: commercialCurrency,
          payment_amount_cents: paymentCents,
          payment_currency: paymentCurrency,
          payment_method: paymentState,
          paid_at: paymentState === "received" ? paidAt : null,
          settled_amount_cents: paymentState === "received" ? settledCents : null,
          settled_currency: paymentState === "received" ? paymentCurrency : null,
          fx_reference_rate: conversion && fxQ.data?.ok ? fxQ.data.rate : null,
          fx_reference_date: conversion && fxQ.data?.ok ? fxQ.data.date : null,
          fx_rate: conversion && fxRate ? Number(fxRate) : null,
          fx_source: conversion && fxQ.data?.ok ? fxQ.data.source : conversion ? "MANUAL" : null,
          initiated_from: initiatedFrom,
          notes: notes || undefined,
        },
      });
      setCreated(true);
      setStep(4);
      onCreated();
      toast.success("Pedido criado e sincronizado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao criar pedido");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initiatedFrom === "financeiro" ? "Novo pedido pelo Financeiro" : "Novo pedido"}
          </DialogTitle>
          <DialogDescription>
            {step === 4
              ? "Concluído"
              : `Etapa ${step} de 3 · ${step === 1 ? "Cliente" : step === 2 ? "Serviço & valor" : "Pagamento"}`}
          </DialogDescription>
        </DialogHeader>
        {step === 1 && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar nome, e-mail ou telefone"
              />
            </div>
            {!!results.length && (
              <div className="max-h-48 divide-y overflow-auto rounded border">
                {results.map((item) => (
                  <button
                    type="button"
                    key={item.id ?? item.email ?? item.phone}
                    className="w-full p-3 text-left hover:bg-muted"
                    onClick={() => setCustomer(item)}
                  >
                    <strong>{item.full_name}</strong>
                    <div className="text-xs text-muted-foreground">
                      {item.email} · {item.phone}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="rounded border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <UserPlus className="h-4 w-4" /> Novo cliente
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="Nome"
                  value={newCust.full_name}
                  onChange={(event) => setNewCust({ ...newCust, full_name: event.target.value })}
                />
                <Input
                  placeholder="E-mail"
                  value={newCust.email}
                  onChange={(event) => setNewCust({ ...newCust, email: event.target.value })}
                />
                <PhoneInput
                  value={newCust.phone}
                  onChange={(value) => setNewCust({ ...newCust, phone: value ?? "" })}
                />
                <Button type="button" variant="outline" onClick={createNewCustomer}>
                  Criar e vincular
                </Button>
              </div>
            </div>
            {customer && (
              <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <strong>Selecionado:</strong> {customer.full_name} · {customer.email}
              </div>
            )}
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <Field label="Tipo de serviço">
              <Select
                value={serviceMode}
                onValueChange={(value) => setServiceMode(value as typeof serviceMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cadastrado">Serviço cadastrado</SelectItem>
                  <SelectItem value="avulso">Serviço avulso</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {serviceMode === "cadastrado" ? (
              <Field label="Serviço">
                <Select value={service?.id ?? ""} onValueChange={selectService}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {(services as Service[]).map((item) => {
                      const curr = ((item.online_price_cents != null
                        ? item.online_currency
                        : item.currency) ?? "EUR") as Currency;
                      return (
                        <SelectItem key={item.id} value={item.id}>
                          {item.title} · {money(item.online_price_cents ?? item.price_cents, curr)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <>
                <Field label="Título">
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} />
                </Field>
                <Field label="Moeda comercial">
                  <CurrencySelect
                    value={commercialCurrency}
                    onChange={(value) => {
                      setCommercialCurrency(value);
                      setPaymentCurrency(value);
                    }}
                  />
                </Field>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor comercial">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={commercialAmount}
                  onChange={(event) => setCommercialAmount(event.target.value)}
                />
              </Field>
              <Field label="Moeda do pagamento">
                <CurrencySelect value={paymentCurrency} onChange={setPaymentCurrency} />
              </Field>
            </div>
            {conversion && (
              <div className="space-y-3 rounded border bg-muted/30 p-3">
                <div className="text-sm">
                  <strong>Referência PTAX:</strong>{" "}
                  {fxQ.data?.ok
                    ? `${fxQ.data.rate.toFixed(4)} em ${fxQ.data.date}`
                    : "indisponível — informe manualmente"}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cotação aplicada (1 EUR em BRL)">
                    <Input
                      type="number"
                      step="0.0001"
                      value={fxRate}
                      onChange={(event) => setFxRate(event.target.value)}
                    />
                  </Field>
                  <Field label="Cobrança prevista">
                    <Input
                      type="number"
                      step="0.01"
                      value={paymentAmount}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                    />
                  </Field>
                </div>
              </div>
            )}
            {!conversion && (
              <div className="text-sm text-muted-foreground">
                Cobrança prevista: <strong>{money(paymentCents, paymentCurrency)}</strong>
              </div>
            )}
            {isFree && (
              <label className="flex gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={confirmFree}
                  onChange={(event) => setConfirmFree(event.target.checked)}
                />{" "}
                Confirmo este pedido como gratuito.
              </label>
            )}
          </div>
        )}
        {step === 3 && (
          <div className="space-y-4">
            <Field label="Situação do pagamento">
              <Select
                value={paymentState}
                onValueChange={(value) => setPaymentState(value as PaymentState)}
                disabled={isFree}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">A receber</SelectItem>
                  <SelectItem value="received">Já recebido</SelectItem>
                  <SelectItem value="gratuito" disabled={!isFree}>
                    Gratuito
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {paymentState === "received" && (
              <div className="space-y-3 rounded border p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Data">
                    <Input
                      type="date"
                      value={paidAt}
                      onChange={(event) => setPaidAt(event.target.value)}
                    />
                  </Field>
                  <Field label={`Valor recebido (${paymentCurrency})`}>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={settledAmount}
                      onChange={(event) => setSettledAmount(event.target.value)}
                    />
                  </Field>
                </div>
              </div>
            )}
            <Field label="Observação">
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            <div className="rounded bg-muted p-3 text-sm">
              Comercial: <strong>{money(commercialCents, commercialCurrency)}</strong>
              <br />
              Previsto: <strong>{money(paymentCents, paymentCurrency)}</strong>
              {paymentState === "received" && (
                <>
                  <br />
                  Realizado: <strong>{money(settledCents, paymentCurrency)}</strong>
                </>
              )}
            </div>
          </div>
        )}
        {step === 4 && created && (
          <div className="flex items-center gap-3 rounded border border-emerald-200 bg-emerald-50 p-5">
            <CheckCircle2 className="h-6 w-6 text-emerald-700" />
            <div>
              <strong>Pedido criado</strong>
              <p className="text-sm text-muted-foreground">
                Uma única receita foi sincronizada no Financeiro.
              </p>
            </div>
          </div>
        )}
        <div className="flex justify-between border-t pt-4">
          {step === 4 ? (
            <>
              <span />
              <Button onClick={() => onOpenChange(false)}>Fechar</Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                disabled={step === 1}
                onClick={() => setStep((value) => value - 1)}
              >
                Voltar
              </Button>
              {step < 3 ? (
                <Button
                  disabled={
                    (step === 1 && !customer) ||
                    (step === 2 &&
                      (!commercialAmount ||
                        (serviceMode === "cadastrado" ? !service : title.trim().length < 2) ||
                        (isFree && !confirmFree)))
                  }
                  onClick={() => setStep((value) => value + 1)}
                >
                  Próximo
                </Button>
              ) : (
                <Button disabled={!canSubmit || submitting} onClick={submit}>
                  {submitting ? "Criando..." : "Criar pedido"}
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CurrencySelect({
  value,
  onChange,
}: {
  value: Currency;
  onChange: (value: Currency) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Currency)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="BRL">BRL</SelectItem>
        <SelectItem value="EUR">EUR</SelectItem>
      </SelectContent>
    </Select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
