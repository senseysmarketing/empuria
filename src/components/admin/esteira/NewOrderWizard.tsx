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
import { PhoneInput } from "@/components/ui/phone-input";
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
import { Search, UserPlus, AlertTriangle, CheckCircle2, Copy, Link2, ChevronDown } from "lucide-react";
import { listServicesAdmin } from "@/lib/admin/slots.functions";
import {
  searchCustomers,
  createCustomerLite,
  createOrderFull,
  generateWisePaymentForOrder,
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
  online_price_cents: number | null;
  online_currency: string | null;
  currency?: string | null;
  kind: string | null;
  requires_slot: boolean;
};

const fmtEUR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "EUR" });

type PaymentMethod = "wise" | "manual" | "dinheiro" | "pendente" | "gratuito";

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
  const genWise = useServerFn(generateWisePaymentForOrder);

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

  const [method, setMethod] = useState<PaymentMethod>("wise");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmFree, setConfirmFree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<{
    id: string;
    reference: string | null;
    paymentUrl: string | null;
    iban: string | null;
    bic: string | null;
    beneficiaryName: string | null;
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
      setMethod("wise");
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

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      runSearch();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

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
    const s = services.find((x) => x.id === id) as Service | undefined;
    if (s) {
      setService(s);
      setAmount(((s.price_cents ?? 0) / 100).toFixed(2));
    }
  };

  const amountCents = Math.round(parseFloat(amount || "0") * 100);
  const isFree = amountCents === 0;

  // Auto-switch method when value becomes 0 or > 0
  useEffect(() => {
    if (isFree && method !== "gratuito") setMethod("gratuito");
    if (!isFree && method === "gratuito") setMethod("wise");
  }, [isFree]); // eslint-disable-line react-hooks/exhaustive-deps

  const reasonRequired = method === "manual" || method === "dinheiro";
  const reasonOk = !reasonRequired || reason.trim().length >= 3;
  const canSubmit =
    customer &&
    (serviceMode === "cadastrado" ? !!service : customTitle.length >= 2) &&
    amount !== "" &&
    (!isFree || confirmFree) &&
    reasonOk;

  const submit = async () => {
    if (!canSubmit || !customer || submitting) return;
    setSubmitting(true);
    try {
      const effectiveMethod: PaymentMethod = isFree ? "gratuito" : method;
      const created = await createOrder({
        data: {
          user_id: customer.id,
          customer_name: customer.full_name ?? "Sem nome",
          customer_email: customer.email ?? undefined,
          service_id: serviceMode === "cadastrado" ? service?.id : null,
          service_title: serviceMode === "cadastrado" ? service!.title : customTitle,
          amount_cents: amountCents,
          payment_method: effectiveMethod,
          reason:
            effectiveMethod === "manual" || effectiveMethod === "dinheiro" ? reason : undefined,
          notes: notes || undefined,
        },
      });
      let reference: string | null = null;
      let paymentUrl: string | null = null;
      let iban: string | null = null;
      let bic: string | null = null;
      let beneficiaryName: string | null = null;
      if (effectiveMethod === "wise") {
        try {
          const link = await genWise({ data: { id: created.id } });
          reference = link.reference ?? `EMP-${created.id}`;
          paymentUrl = link.paymentUrl ?? null;
          iban = link.iban ?? null;
          bic = link.bic ?? null;
          beneficiaryName = link.beneficiaryName ?? null;
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Não foi possível gerar o pagamento Wise");
        }
      }
      setCreatedOrder({
        id: created.id,
        reference,
        paymentUrl,
        iban,
        bic,
        beneficiaryName,
        method: effectiveMethod,
      });
      setStep(4);
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
            {step === 4 ? "Conclusão" : `Etapa ${step} de 3 · ${stepLabel(step)}`}
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
                <PhoneInput
                  value={newCust.phone}
                  onChange={(e164) => setNewCust({ ...newCust, phone: e164 ?? "" })}
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
            <div>
              <Label>Tipo de serviço</Label>
              <Select value={serviceMode} onValueChange={(v) => setServiceMode(v as never)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cadastrado">Serviço cadastrado</SelectItem>
                  <SelectItem value="avulso">Serviço avulso</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {serviceMode === "cadastrado" ? (
              <div>
                <Label>Serviço</Label>
                <Select value={service?.id ?? ""} onValueChange={onSelectService}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o serviço" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((s) => {
                      const eur = s.price_cents ?? 0;
                      return (
                        <SelectItem key={s.id} value={s.id}>
                          {s.title} · {fmtEUR.format(eur / 100)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>Título do serviço avulso</Label>
                <Input
                  placeholder="Ex: Consulta avulsa"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                />
              </div>
            )}

            <div>
              <Label>Valor (EUR)</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Todo o sistema opera em EUR. Cobranças online são processadas pela Wise.
              </p>
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

        {step === 3 && (
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
                  <SelectItem value="wise">Gerar cobrança Wise (EUR)</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro (recebido pessoalmente)</SelectItem>
                  <SelectItem value="manual">Marcar como pago manualmente</SelectItem>
                  <SelectItem value="pendente">
                    Apenas criar pedido (cobrar depois)
                  </SelectItem>
                  <SelectItem value="gratuito" disabled={!isFree}>
                    Gratuito
                  </SelectItem>
                </SelectContent>
              </Select>
              {method === "wise" && !isFree && (
                <p className="text-xs text-muted-foreground mt-1">
                  Gera link Wise + IBAN/BIC. A reconciliação é automática via webhook quando o
                  valor cai no saldo EUR.
                </p>
              )}
              {method === "dinheiro" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Pedido criado já como <strong>pago</strong>. Use a observação abaixo para
                  registrar quem recebeu e quando.
                </p>
              )}
              {method === "pendente" && (
                <p className="text-xs text-muted-foreground mt-1">
                  O pedido fica pendente. Você pode gerar a cobrança Wise depois pela esteira.
                </p>
              )}
            </div>

            {method === "manual" && (
              <div>
                <Label>Motivo do pagamento manual *</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
            )}

            {method === "dinheiro" && (
              <div>
                <Label>Observação do recebimento em dinheiro *</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Ex.: Recebido em mãos por Fulano em 16/06"
                />
              </div>
            )}

            <div>
              <Label>Notas internas (opcional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            <div className="text-xs text-muted-foreground">
              Cliente: <strong>{customer?.full_name}</strong> · Serviço:{" "}
              <strong>{serviceMode === "cadastrado" ? service?.title : customTitle}</strong> ·
              Valor: <strong>{fmtEUR.format(amountCents / 100)}</strong>
            </div>
          </div>
        )}

        {step === 4 && createdOrder && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded border border-emerald-200 bg-emerald-50">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
              <div>
                <div className="font-medium text-emerald-900">Pedido criado com sucesso</div>
                <div className="text-xs text-emerald-800/80">
                  {customer?.full_name} ·{" "}
                  {serviceMode === "cadastrado" ? service?.title : customTitle} ·{" "}
                  {fmtEUR.format(amountCents / 100)}
                </div>
              </div>
            </div>

            {createdOrder.method === "wise" && (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Aguardando confirmação automática via Wise (webhook <em>balances#credit</em>).
                  O pedido será aprovado assim que o valor cair no saldo EUR com a referência
                  abaixo.
                </div>
                {createdOrder.paymentUrl && (
                  <div>
                    <Label>Link de pagamento Wise</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        readOnly
                        value={createdOrder.paymentUrl}
                        className="font-mono text-xs"
                      />
                      <Button
                        variant="outline"
                        onClick={() => copy(createdOrder.paymentUrl!, "Link")}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button asChild variant="outline">
                        <a href={createdOrder.paymentUrl} target="_blank" rel="noreferrer">
                          <Link2 className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Envie ao cliente. O valor e a referência já vão preenchidos.
                    </p>
                  </div>
                )}
                {!createdOrder.paymentUrl && (
                  <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm">
                    <strong>Link Wise não configurado.</strong> Configure o "Link Quick Pay" nas{" "}
                    <em>Configurações → Wise</em> para gerar links automaticamente. O cliente
                    ainda pode pagar por IBAN/BIC abaixo.
                  </div>
                )}
                {(createdOrder.iban || createdOrder.bic || createdOrder.beneficiaryName || createdOrder.reference) && (
                  <BankTransferCollapsible
                    defaultOpen={!createdOrder.paymentUrl}
                    beneficiaryName={createdOrder.beneficiaryName}
                    iban={createdOrder.iban}
                    bic={createdOrder.bic}
                    amountLabel={fmtEUR.format(amountCents / 100)}
                    amountRaw={(amountCents / 100).toFixed(2)}
                    reference={createdOrder.reference}
                    hasWiseUrl={!!createdOrder.paymentUrl}
                    onCopy={copy}
                  />
                )}
              </div>
            )}

            {createdOrder.method === "manual" && (
              <div className="text-sm text-muted-foreground">
                Pagamento marcado como recebido manualmente.
              </div>
            )}
            {createdOrder.method === "gratuito" && (
              <div className="text-sm text-muted-foreground">Pedido registrado como gratuito.</div>
            )}
            {createdOrder.method === "pendente" && (
              <div className="text-sm text-muted-foreground">
                Pedido criado como pendente. Você pode gerar a cobrança Wise depois pela esteira.
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between pt-4 border-t">
          {step === 4 ? (
            <>
              <span />
              <Button
                onClick={() => onOpenChange(false)}
                className="bg-admin-accent hover:bg-admin-accent/90"
              >
                Fechar
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={step === 1}
              >
                Voltar
              </Button>
              {step < 3 ? (
                <Button
                  onClick={() => setStep((s) => s + 1)}
                  disabled={
                    (step === 1 && !customer) ||
                    (step === 2 &&
                      ((serviceMode === "cadastrado" ? !service : customTitle.length < 2) ||
                        amount === "" ||
                        (isFree && !confirmFree)))
                  }
                >
                  Próximo
                </Button>
              ) : (
                <Button
                  onClick={submit}
                  disabled={!canSubmit || submitting}
                  className="bg-admin-accent hover:bg-admin-accent/90"
                >
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

function stepLabel(s: number) {
  return s === 1 ? "Cliente" : s === 2 ? "Serviço & valor" : "Pagamento";
}

function BankTransferCollapsible({
  defaultOpen,
  beneficiaryName,
  iban,
  bic,
  amountLabel,
  amountRaw,
  reference,
  hasWiseUrl,
  onCopy,
}: {
  defaultOpen: boolean;
  beneficiaryName: string | null;
  iban: string | null;
  bic: string | null;
  amountLabel: string;
  amountRaw: string;
  reference: string | null;
  hasWiseUrl: boolean;
  onCopy: (text: string, label: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <span className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
          {hasWiseUrl ? "Ou faça uma transferência bancária" : "Dados bancários EUR"}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-border/60 px-4 pb-4 pt-2 text-sm">
          {beneficiaryName && (
            <BankRow label="Beneficiário" value={beneficiaryName} onCopy={() => onCopy(beneficiaryName, "Beneficiário")} />
          )}
          {iban && <BankRow label="IBAN" value={iban} onCopy={() => onCopy(iban, "IBAN")} mono />}
          {bic && <BankRow label="BIC/SWIFT" value={bic} onCopy={() => onCopy(bic, "BIC")} mono />}
          <BankRow label="Valor" value={amountLabel} onCopy={() => onCopy(amountRaw, "Valor")} />
          {reference && (
            <BankRow label="Referência" value={reference} onCopy={() => onCopy(reference, "Referência")} mono />
          )}
          {reference && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Inclua a referência <strong>{reference}</strong> na transferência para conciliação automática.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BankRow({
  label,
  value,
  onCopy,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  mono?: boolean;
}) {
  return (
    <div className="mt-2 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <Label className="font-display text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </Label>
        <div className={`break-all text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="mt-4 shrink-0 text-admin-accent"
        aria-label="Copiar"
      >
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
}
