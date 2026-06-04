import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Search, UserPlus, AlertTriangle, CheckCircle2, Copy, Link2 } from "lucide-react";
import { listServicesAdmin } from "@/lib/admin/slots.functions";
import {
  searchCustomers,
  createCustomerLite,
  createOrderFull,
  generatePaymentLink,
} from "@/lib/admin/esteira.functions";
import { useQuery } from "@tanstack/react-query";

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
  kind: string | null;
  requires_slot: boolean;
};

type PaymentMethod = "mercadopago" | "manual" | "gratuito";
type Currency = "EUR" | "BRL";

export function NewOrderWizard({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const search = useServerFn(searchCustomers);
  const createCustomer = useServerFn(createCustomerLite);
  const fetchServices = useServerFn(listServicesAdmin);
  const createOrder = useServerFn(createOrderFull);
  const genLink = useServerFn(generatePaymentLink);

  const [step, setStep] = useState(1);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [newCust, setNewCust] = useState({ full_name: "", email: "", phone: "" });

  const [service, setService] = useState<Service | null>(null);
  const [serviceMode, setServiceMode] = useState<"cadastrado" | "avulso">("cadastrado");
  const [customTitle, setCustomTitle] = useState("");

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [payAmount, setPayAmount] = useState("");
  const [payCurrency, setPayCurrency] = useState<Currency>("BRL");
  const [fxRate, setFxRate] = useState("");

  const [method, setMethod] = useState<PaymentMethod>("mercadopago");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmFree, setConfirmFree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<{
    id: string;
    reference: string | null;
    paymentUrl: string | null;
    method: PaymentMethod;
  } | null>(null);

  const { data: services = [] } = useQuery({
    queryKey: ["admin-services-wizard"],
    queryFn: () => fetchServices(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setStep(1);
      setCustomer(null);
      setQuery("");
      setResults([]);
      setNewCust({ full_name: "", email: "", phone: "" });
      setService(null);
      setServiceMode("cadastrado");
      setCustomTitle("");
      setAmount("");
      setPayAmount("");
      setFxRate("");
      setMethod("mercadopago");
      setReason("");
      setNotes("");
      setConfirmFree(false);
      setSubmitting(false);
      setCreatedOrder(null);
    }
  }, [open]);

  const runSearch = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const r = await search({ data: { q: query.trim() } });
      setResults(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na busca");
    } finally {
      setSearching(false);
    }
  };

  const createCust = async () => {
    if (!newCust.full_name || !newCust.email || !newCust.phone) {
      toast.error("Nome, e-mail e telefone sao obrigatorios");
      return;
    }
    try {
      const c = await createCustomer({ data: newCust });
      setCustomer({ id: c.user_id, full_name: c.full_name, email: c.email, phone: c.phone });
      toast.success("Cliente vinculado. Oriente o primeiro acesso pelo login.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const onSelectService = (id: string) => {
    const s = services.find((x) => x.id === id);
    if (s) {
      setService(s as Service);
      setAmount(((s.price_cents ?? 0) / 100).toFixed(2));
    }
  };

  const amountCents = Math.round(parseFloat(amount || "0") * 100);
  const payCents = payAmount ? Math.round(parseFloat(payAmount) * 100) : amountCents;
  const isFree = amountCents === 0;

  const mpNeedsBrl = !isFree && method === "mercadopago" && payCurrency !== "BRL";

  const canSubmit =
    customer &&
    (serviceMode === "cadastrado" ? !!service : customTitle.length >= 2) &&
    amount !== "" &&
    (!isFree || confirmFree) &&
    (method !== "manual" || reason.length >= 3) &&
    !mpNeedsBrl;

  const submit = async () => {
    if (!canSubmit || !customer || submitting) return;
    setSubmitting(true);
    try {
      const created = await createOrder({
        data: {
          user_id: customer.id,
          customer_name: customer.full_name ?? "Sem nome",
          customer_email: customer.email ?? undefined,
          service_id: serviceMode === "cadastrado" ? service?.id : null,
          service_title: serviceMode === "cadastrado" ? service!.title : customTitle,
          amount_cents: amountCents,
          currency,
          payment_amount_cents: payCents,
          payment_currency: payCurrency,
          fx_rate: fxRate ? parseFloat(fxRate) : undefined,
          payment_method: isFree ? "gratuito" : method,
          reason: method === "manual" ? reason : undefined,
          notes: notes || undefined,
        },
      });
      const effectiveMethod: PaymentMethod = isFree ? "gratuito" : method;
      let reference: string | null = null;
      let paymentUrl: string | null = null;
      if (effectiveMethod === "mercadopago") {
        try {
          const link = await genLink({ data: { id: created.id } });
          reference = link.reference ?? `EMP-${created.id}`;
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Não foi possível preparar o link MP");
        }
        if (typeof window !== "undefined") {
          paymentUrl = `${window.location.origin}/portal/servicos?order=${created.id}`;
        }
      }
      setCreatedOrder({ id: created.id, reference, paymentUrl, method: effectiveMethod });
      setStep(5);
      toast.success("Pedido criado");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSubmitting(false);
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo pedido</DialogTitle>
          <DialogDescription>
            {step === 5 ? "Conclusão" : `Etapa ${step} de 4 · ${stepLabel(step)}`}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Buscar por nome, e-mail ou telefone"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
              />
              <Button onClick={runSearch} disabled={searching}>
                <Search className="h-4 w-4" />
              </Button>
            </div>

            {results.length > 0 && (
              <div className="border rounded divide-y max-h-56 overflow-auto">
                {results.map((c) => (
                  <button
                    key={c.id ?? c.email ?? Math.random()}
                    onClick={() => setCustomer(c)}
                    className={`w-full text-left p-3 hover:bg-muted ${
                      customer?.id === c.id ? "bg-admin-accent-soft" : ""
                    }`}
                  >
                    <div className="font-medium">{c.full_name ?? "Sem nome"}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.email ?? "sem e-mail"} · {c.phone ?? "sem telefone"}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="border-t pt-3">
              <div className="flex items-center gap-2 text-sm font-display uppercase tracking-wider text-muted-foreground mb-2">
                <UserPlus className="h-4 w-4" /> Criar novo cliente
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Nome"
                  value={newCust.full_name}
                  onChange={(e) => setNewCust({ ...newCust, full_name: e.target.value })}
                />
                <Input
                  placeholder="E-mail"
                  value={newCust.email}
                  onChange={(e) => setNewCust({ ...newCust, email: e.target.value })}
                />
                <Input
                  placeholder="Telefone"
                  value={newCust.phone}
                  onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })}
                />
                <Button variant="outline" onClick={createCust}>
                  Criar e vincular
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                A conta e criada sem senha. O cliente acessa depois pelo link Primeiro acesso na
                tela de login.
              </p>
            </div>

            {customer && (
              <div className="bg-admin-accent-soft border rounded p-3 text-sm">
                <strong>Selecionado:</strong> {customer.full_name ?? "—"} ·{" "}
                {customer.email ?? "sem e-mail"}
                {!customer.email && (
                  <div className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Sem e-mail: pedido não aparecerá no
                    portal.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Select value={serviceMode} onValueChange={(v) => setServiceMode(v as never)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cadastrado">Serviço cadastrado</SelectItem>
                <SelectItem value="avulso">Serviço avulso</SelectItem>
              </SelectContent>
            </Select>
            {serviceMode === "cadastrado" ? (
              <Select value={service?.id ?? ""} onValueChange={onSelectService}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o serviço" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title} · € {(s.price_cents / 100).toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="Título do serviço avulso"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
              />
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor comercial</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>Moeda</Label>
                <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="BRL">BRL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Valor cobrança (Mercado Pago)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={payAmount}
                  placeholder={amount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>Moeda cobrança</Label>
                <Select value={payCurrency} onValueChange={(v) => setPayCurrency(v as Currency)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BRL">BRL</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {currency !== payCurrency && (
                <div className="col-span-2">
                  <Label>Taxa de câmbio (manual)</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value)}
                    placeholder="Ex: 6.00"
                  />
                </div>
              )}
            </div>
            {isFree && (
              <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={confirmFree}
                    onChange={(e) => setConfirmFree(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Este pedido será criado com valor zero. Confirmo como{" "}
                    <strong>pedido gratuito</strong>.
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div>
              <Label>Forma de pagamento</Label>
              <Select
                value={method}
                onValueChange={(v) => setMethod(v as PaymentMethod)}
                disabled={isFree}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mercadopago">Gerar link Mercado Pago</SelectItem>
                  <SelectItem value="manual">Marcar como pago manualmente</SelectItem>
                  <SelectItem value="gratuito" disabled={!isFree}>
                    Gratuito
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {method === "manual" && (
              <div>
                <Label>Motivo do pagamento manual *</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
            )}
            <div>
              <Label>Notas internas (opcional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="text-xs text-muted-foreground">
              Cliente: <strong>{customer?.full_name}</strong> · Serviço:{" "}
              <strong>{serviceMode === "cadastrado" ? service?.title : customTitle}</strong> ·
              Valor:{" "}
              <strong>
                {currency} {amount}
              </strong>
            </div>
          </div>
        )}

        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
          >
            Voltar
          </Button>
          {step < 4 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 1 && !customer) ||
                (step === 2 &&
                  (serviceMode === "cadastrado" ? !service : customTitle.length < 2)) ||
                (step === 3 && (amount === "" || (isFree && !confirmFree)))
              }
            >
              Próximo
            </Button>
          ) : (
            <Button
              onClick={submit}
              disabled={!canSubmit}
              className="bg-admin-accent hover:bg-admin-accent/90"
            >
              Criar pedido
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function stepLabel(s: number) {
  return s === 1 ? "Cliente" : s === 2 ? "Serviço" : s === 3 ? "Valor & moeda" : "Pagamento";
}
