import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { checkEmail, createCheckoutIntent } from "@/lib/checkout/checkout.functions";
import {
  checkMercadoPagoPayment,
  createMercadoPagoPayment,
  getMercadoPagoPublicCheckoutConfig,
} from "@/lib/mercadopago/mercadopago.functions";
import { SlotPicker } from "./SlotPicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, Copy, CreditCard, FileText, Loader2, QrCode, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

type ServiceKind = "airport" | "tour" | "consulting" | "banking" | "meeting";
type CheckoutService = {
  id: string;
  slug: string;
  title: string;
  price_cents: number;
  currency: string;
  online_price_cents?: number | null;
  online_currency?: string | null;
  kind: ServiceKind;
  requires_slot: boolean;
  short_description?: string | null;
};

type Step = "data" | "contact" | "payment" | "done";
type PaymentTab = "pix" | "boleto" | "card";
type MpPayment = {
  id: string;
  orderId: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  method: "pix" | "boleto" | "credit_card";
  status: string;
  statusDetail: string | null;
  orderPaymentStatus: "pendente" | "aprovado" | "recusado" | "estornado";
  amountCents: number;
  currency: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  digitableLine: string | null;
  barcodeContent: string | null;
  expiresAt: string | null;
};

declare global {
  interface Window {
    // Mercado Pago SDK is loaded from https://sdk.mercadopago.com/js/v2 only on card tokenization.
    MercadoPago?: new (publicKey: string) => {
      createCardToken: (data: Record<string, string>) => Promise<{ id: string }>;
    };
  }
}

function money(cents: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

function copy(value: string, label = "Copiado") {
  navigator.clipboard.writeText(value);
  toast.success(label);
}

function cardBrand(number: string) {
  const digits = number.replace(/\D/g, "");
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "master";
  if (/^3[47]/.test(digits)) return "amex";
  return "visa";
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

async function loadMercadoPagoSdk() {
  if (window.MercadoPago) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-mercadopago-sdk]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Erro ao carregar SDK Mercado Pago")),
        {
          once: true,
        },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://sdk.mercadopago.com/js/v2";
    script.async = true;
    script.dataset.mercadopagoSdk = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Erro ao carregar SDK Mercado Pago"));
    document.head.appendChild(script);
  });
}

type PendingPix = {
  intent: { orderId: string; reference: string; amountCents: number; currency: string };
  payment: MpPayment;
  savedAt: number;
};

const PENDING_PIX_KEY = (slug: string) => `empuria:pending-pix:${slug}`;

function loadPendingPix(slug: string): PendingPix | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_PIX_KEY(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingPix;
    if (!parsed?.payment?.expiresAt) return null;
    if (new Date(parsed.payment.expiresAt).getTime() <= Date.now()) return null;
    if (parsed.payment.orderPaymentStatus !== "pendente") return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePendingPix(slug: string, data: PendingPix) {
  try {
    window.localStorage.setItem(PENDING_PIX_KEY(slug), JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}

function clearPendingPix(slug: string) {
  try {
    window.localStorage.removeItem(PENDING_PIX_KEY(slug));
  } catch {
    /* ignore */
  }
}

export function CheckoutModal({
  service,
  open,
  onOpenChange,
}: {
  service: CheckoutService | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const check = useServerFn(checkEmail);
  const createIntent = useServerFn(createCheckoutIntent);
  const fetchMpConfig = useServerFn(getMercadoPagoPublicCheckoutConfig);
  const createPayment = useServerFn(createMercadoPagoPayment);
  const checkPayment = useServerFn(checkMercadoPagoPayment);

  const [step, setStep] = useState<Step>("data");
  const [loading, setLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState<PaymentTab | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);

  const [slotId, setSlotId] = useState<string | undefined>();
  const [arrivalDate, setArrivalDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [terminal, setTerminal] = useState("");
  const [bagsCount, setBagsCount] = useState<number>(1);

  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const [intent, setIntent] = useState<{
    orderId: string;
    reference: string;
    amountCents: number;
    currency: string;
  } | null>(null);
  const [mpConfig, setMpConfig] = useState<{
    enabled: boolean;
    publicKey: string | null;
    methods: { pix: boolean; boleto: boolean; card: boolean };
  } | null>(null);
  const [payment, setPayment] = useState<MpPayment | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<PaymentTab>("pix");

  const [cpf, setCpf] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [streetName, setStreetName] = useState("");
  const [streetNumber, setStreetNumber] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [stateUf, setStateUf] = useState("");

  const [cardNumber, setCardNumber] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const [cardExpiration, setCardExpiration] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const [installments, setInstallments] = useState(1);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) {
      setStep("data");
      setSlotId(undefined);
      setArrivalDate("");
      setArrivalTime("");
      setFlightNumber("");
      setTerminal("");
      setBagsCount(1);
      setName("");
      setWhatsapp("");
      setEmail("");
      setPassword("");
      setEmailExists(null);
      setIntent(null);
      setMpConfig(null);
      setPayment(null);
      setQrUrl(null);
      setTab("pix");
      setCpf("");
      setZipCode("");
      setStreetName("");
      setStreetNumber("");
      setNeighborhood("");
      setCity("");
      setStateUf("");
      setCardNumber("");
      setCardholderName("");
      setCardExpiration("");
      setSecurityCode("");
      setInstallments(1);
      return;
    }
    // Quando o modal abre, tenta retomar um PIX pendente do mesmo serviço.
    if (service) {
      const pending = loadPendingPix(service.slug);
      if (pending) {
        setIntent(pending.intent);
        setPayment(pending.payment);
        setTab("pix");
        setStep("payment");
        // mpConfig será recarregado em background (apenas para `publicKey` do cartão).
        fetchMpConfig()
          .then(setMpConfig)
          .catch(() => undefined);
      }
    }
  }, [open, service, fetchMpConfig]);

  // Tick de 1s para o contador regressivo do PIX.
  useEffect(() => {
    if (!open || step !== "payment" || !payment?.expiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, step, payment?.expiresAt]);

  const pixMsLeft = payment?.method === "pix" && payment.expiresAt
    ? Math.max(0, new Date(payment.expiresAt).getTime() - now)
    : null;
  const pixExpired = pixMsLeft !== null && pixMsLeft === 0;
  const pixCountdown = pixMsLeft !== null
    ? `${String(Math.floor(pixMsLeft / 60000)).padStart(2, "0")}:${String(Math.floor((pixMsLeft % 60000) / 1000)).padStart(2, "0")}`
    : null;

  useEffect(() => {
    const pix = payment?.method === "pix" ? payment.qrCode : null;
    if (!pix) {
      setQrUrl(null);
      return;
    }
    QRCode.toDataURL(pix, { width: 240, margin: 1 }).then(setQrUrl);
  }, [payment]);

  useEffect(() => {
    if (!intent || step !== "payment") return;
    const timer = window.setInterval(async () => {
      try {
        const result = await checkPayment({ data: { orderId: intent.orderId } });
        if (result.payment) setPayment(result.payment);
        if (result.orderPaymentStatus === "aprovado") {
          if (service) clearPendingPix(service.slug);
          toast.success("Pagamento aprovado!");
          setStep("done");
          window.clearInterval(timer);
          setTimeout(() => {
            onOpenChange(false);
            navigate({ to: "/portal" });
          }, 1300);
        }
      } catch {
        // Polling is best-effort; explicit verification shows user-facing errors.
      }
    }, 8000);
    return () => window.clearInterval(timer);
  }, [checkPayment, intent, navigate, onOpenChange, step]);

  const paymentAmount = intent
    ? money(intent.amountCents, intent.currency)
    : service
      ? money(
          service.online_price_cents ?? service.price_cents,
          service.online_currency ?? service.currency,
        )
      : "";

  const dataStepValid = useMemo(() => {
    if (!service) return false;
    if (service.kind === "airport") return !!arrivalDate && !!arrivalTime && !!flightNumber;
    if (service.requires_slot) return !!slotId;
    return true;
  }, [service, arrivalDate, arrivalTime, flightNumber, slotId]);

  const onEmailBlur = async () => {
    const e = email.trim();
    if (!e || !/^\S+@\S+\.\S+$/.test(e)) return;
    setCheckingEmail(true);
    try {
      const res = await check({ data: { email: e } });
      setEmailExists(res.exists);
    } catch {
      setEmailExists(null);
    } finally {
      setCheckingEmail(false);
    }
  };

  const submit = async () => {
    if (!service) return;
    if (!name || !whatsapp || !email || !password || password.length < 6) {
      toast.error("Preencha todos os campos (senha minima de 6 caracteres)");
      return;
    }
    setLoading(true);
    try {
      if (emailExists === false) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/portal`,
            data: { full_name: name },
          },
        });
        if (error) throw error;
        const { error: siErr } = await supabase.auth.signInWithPassword({ email, password });
        if (siErr) throw new Error("Confirme seu e-mail antes de continuar");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error("Senha incorreta. Tente novamente.");
      }

      const [intentRes, configRes] = await Promise.all([
        createIntent({
          data: {
            serviceSlug: service.slug,
            contact: { name, whatsapp },
            serviceData: {
              slotId,
              arrivalDate: arrivalDate || undefined,
              arrivalTime: arrivalTime || undefined,
              flightNumber: flightNumber || undefined,
              terminal: terminal || undefined,
              bagsCount: service.kind === "airport" ? bagsCount : undefined,
            },
          },
        }),
        fetchMpConfig(),
      ]);
      setIntent(intentRes);
      setMpConfig(configRes);
      setStep("payment");
      if (!configRes.enabled) toast.error("Mercado Pago ainda nao esta ativo. Fale com a equipe.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao processar");
    } finally {
      setLoading(false);
    }
  };

  const generatePayment = async (method: PaymentTab) => {
    if (!intent) return;
    setPaymentLoading(method);
    try {
      const result = await createPayment({
        data: {
          orderId: intent.orderId,
          method: method === "card" ? "credit_card" : method,
          payer:
            method === "boleto" || method === "card"
              ? {
                  cpf,
                  zipCode,
                  streetName,
                  streetNumber,
                  neighborhood,
                  city,
                  state: stateUf.toUpperCase(),
                }
              : undefined,
          card: undefined,
        },
      });
      setPayment(result.payment);
      if (method === "pix" && service && result.payment.expiresAt) {
        savePendingPix(service.slug, {
          intent,
          payment: result.payment,
          savedAt: Date.now(),
        });
      }
      toast.success(method === "pix" ? "Pix gerado" : "Boleto gerado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar pagamento");
    } finally {
      setPaymentLoading(null);
    }
  };

  const payCard = async () => {
    if (!intent || !mpConfig?.publicKey) return;
    const [month, year] = cardExpiration.split("/").map((v) => v.trim());
    if (!cardNumber || !cardholderName || !month || !year || !securityCode || !cpf) {
      toast.error("Preencha os dados do cartao e CPF");
      return;
    }
    setPaymentLoading("card");
    try {
      await loadMercadoPagoSdk();
      if (!window.MercadoPago) throw new Error("SDK Mercado Pago indisponivel.");
      const mp = new window.MercadoPago(mpConfig.publicKey);
      const token = await mp.createCardToken({
        cardNumber: cardNumber.replace(/\s/g, ""),
        cardholderName,
        cardExpirationMonth: month.padStart(2, "0"),
        cardExpirationYear: year.length === 2 ? `20${year}` : year,
        securityCode,
        identificationType: "CPF",
        identificationNumber: onlyDigits(cpf),
      });
      const result = await createPayment({
        data: {
          orderId: intent.orderId,
          method: "credit_card",
          payer: {
            cpf,
            zipCode,
            streetName,
            streetNumber,
            neighborhood,
            city,
            state: stateUf.toUpperCase(),
          },
          card: {
            token: token.id,
            paymentMethodId: cardBrand(cardNumber),
            installments,
          },
        },
      });
      setPayment(result.payment);
      setPayment(result.payment);
      if (result.payment.orderPaymentStatus === "aprovado") {
        if (service) clearPendingPix(service.slug);
        toast.success("Pagamento aprovado!");
        setStep("done");
      } else if (result.payment.orderPaymentStatus === "recusado") {
        toast.error("Pagamento recusado pelo Mercado Pago.");
      } else {
        toast.success("Pagamento em processamento.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao processar cartao");
    } finally {
      setPaymentLoading(null);
    }
  };

  const verifyPayment = async () => {
    if (!intent) return;
    setCheckingPayment(true);
    try {
      const result = await checkPayment({ data: { orderId: intent.orderId } });
      if (result.payment) setPayment(result.payment);
      if (result.orderPaymentStatus === "aprovado") {
        if (service) clearPendingPix(service.slug);
        toast.success("Pagamento aprovado!");
        setStep("done");
        setTimeout(() => {
          onOpenChange(false);
          navigate({ to: "/portal" });
        }, 1300);
      } else {
        toast.info("Pagamento ainda nao confirmado.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao verificar pagamento");
    } finally {
      setCheckingPayment(false);
    }
  };

  if (!service) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-offwhite text-brown-deep">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl uppercase tracking-tight">
            {service.title}
          </DialogTitle>
          <p className="font-body text-sm text-brown-deep/60">{paymentAmount} · pagamento unico</p>
        </DialogHeader>

        <div className="mb-2 flex items-center gap-2 font-display text-[11px] uppercase tracking-widest text-brown-deep/50">
          <StepDot active={step === "data"} done={step !== "data"} label="1. Dados" />
          <StepDot
            active={step === "contact"}
            done={step === "payment" || step === "done"}
            label="2. Conta"
          />
          <StepDot active={step === "payment"} done={step === "done"} label="3. Pagamento" />
        </div>

        {step === "data" && (
          <div className="space-y-3">
            {service.kind === "airport" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Data de chegada">
                    <Input
                      type="date"
                      value={arrivalDate}
                      onChange={(e) => setArrivalDate(e.target.value)}
                    />
                  </Field>
                  <Field label="Horario previsto">
                    <Input
                      type="time"
                      value={arrivalTime}
                      onChange={(e) => setArrivalTime(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Numero do voo">
                  <Input
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value)}
                    placeholder="LA8084"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Terminal">
                    <Input
                      value={terminal}
                      onChange={(e) => setTerminal(e.target.value)}
                      placeholder="T4"
                    />
                  </Field>
                  <Field label="Malas">
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={bagsCount}
                      onChange={(e) => setBagsCount(parseInt(e.target.value || "0"))}
                    />
                  </Field>
                </div>
              </>
            )}
            {service.requires_slot && (
              <SlotPicker serviceId={service.id} value={slotId} onChange={setSlotId} />
            )}
            {!service.requires_slot && service.kind !== "airport" && (
              <p className="font-body text-sm text-brown-deep/70">
                Sem agendamento previo: nosso time entra em contato apos o pagamento para conduzir o
                atendimento.
              </p>
            )}
            <Button
              disabled={!dataStepValid}
              onClick={() => setStep("contact")}
              className="mt-2 w-full bg-orange-brand text-offwhite hover:bg-red-brand"
            >
              Continuar <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {step === "contact" && (
          <div className="space-y-3">
            <Field label="Nome completo">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como aparece no passaporte"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="WhatsApp">
                <Input
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="+55 11 99999-9999"
                />
              </Field>
              <Field label="E-mail">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailExists(null);
                  }}
                  onBlur={onEmailBlur}
                  placeholder="seu@email.com"
                />
              </Field>
            </div>
            {checkingEmail && (
              <p className="inline-flex items-center gap-1 text-xs text-brown-deep/50">
                <Loader2 className="h-3 w-3 animate-spin" /> Verificando e-mail...
              </p>
            )}
            {emailExists !== null && (
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <Label className="font-display text-xs uppercase tracking-wider text-orange-brand">
                  {emailExists
                    ? "Bem-vindo de volta! Insira sua senha"
                    : "Crie uma senha para acessar seu portal"}
                </Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2"
                  placeholder="******"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("data")} className="flex-1">
                Voltar
              </Button>
              <Button
                onClick={submit}
                disabled={
                  loading || !name || !whatsapp || !email || !password || emailExists === null
                }
                className="flex-1 bg-orange-brand text-offwhite hover:bg-red-brand"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Comprar Agora <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === "payment" && intent && (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span>Pedido</span>
                <strong>{intent.reference.slice(0, 12)}...</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>Total</span>
                <strong>{money(intent.amountCents, intent.currency)}</strong>
              </div>
            </div>

            <div className="flex gap-1 rounded-md bg-muted/50 p-1">
              <PayTab
                active={tab === "pix"}
                onClick={() => setTab("pix")}
                icon={QrCode}
                label="Pix"
                disabled={!mpConfig?.methods.pix}
              />
              <PayTab
                active={tab === "boleto"}
                onClick={() => setTab("boleto")}
                icon={FileText}
                label="Boleto"
                disabled={!mpConfig?.methods.boleto}
              />
              <PayTab
                active={tab === "card"}
                onClick={() => setTab("card")}
                icon={CreditCard}
                label="Cartao"
                disabled={!mpConfig?.methods.card}
              />
            </div>

            {tab === "pix" && (
              <div className="space-y-3 text-center">
                {payment?.method === "pix" && payment.qrCode ? (
                  <>
                    <div className="flex justify-center">
                      {payment.qrCodeBase64 ? (
                        <img
                          src={`data:image/png;base64,${payment.qrCodeBase64}`}
                          alt="QR Pix"
                          className="h-auto w-full max-w-[220px] rounded-lg border border-border bg-white p-2"
                        />
                      ) : qrUrl ? (
                        <img
                          src={qrUrl}
                          alt="QR Pix"
                          className="h-auto w-full max-w-[220px] rounded-lg border border-border bg-white p-2"
                        />
                      ) : (
                        <div className="flex h-[220px] w-[220px] items-center justify-center">
                          <QrCode className="h-10 w-10 text-brown-deep/30" />
                        </div>
                      )}
                    </div>
                    <CopyBlock label="Pix copia e cola" value={payment.qrCode} />
                  </>
                ) : (
                  <Button
                    onClick={() => generatePayment("pix")}
                    disabled={paymentLoading === "pix" || !mpConfig?.enabled}
                    className="w-full bg-orange-brand text-offwhite hover:bg-red-brand"
                  >
                    {paymentLoading === "pix" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Gerar Pix"
                    )}
                  </Button>
                )}
              </div>
            )}

            {tab === "boleto" && (
              <div className="space-y-3">
                <PayerFields
                  cpf={cpf}
                  setCpf={setCpf}
                  zipCode={zipCode}
                  setZipCode={setZipCode}
                  streetName={streetName}
                  setStreetName={setStreetName}
                  streetNumber={streetNumber}
                  setStreetNumber={setStreetNumber}
                  neighborhood={neighborhood}
                  setNeighborhood={setNeighborhood}
                  city={city}
                  setCity={setCity}
                  stateUf={stateUf}
                  setStateUf={setStateUf}
                />
                {payment?.method === "boleto" ? (
                  <>
                    {payment.digitableLine && (
                      <CopyBlock label="Linha digitavel" value={payment.digitableLine} />
                    )}
                    {payment.barcodeContent && (
                      <CopyBlock label="Codigo de barras" value={payment.barcodeContent} />
                    )}
                    {payment.ticketUrl && (
                      <a
                        href={payment.ticketUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 w-full items-center justify-center rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        Abrir boleto
                      </a>
                    )}
                  </>
                ) : (
                  <Button
                    onClick={() => generatePayment("boleto")}
                    disabled={paymentLoading === "boleto" || !mpConfig?.enabled}
                    className="w-full bg-orange-brand text-offwhite hover:bg-red-brand"
                  >
                    {paymentLoading === "boleto" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Gerar boleto"
                    )}
                  </Button>
                )}
              </div>
            )}

            {tab === "card" && (
              <div className="space-y-3">
                <PayerFields
                  cpf={cpf}
                  setCpf={setCpf}
                  zipCode={zipCode}
                  setZipCode={setZipCode}
                  streetName={streetName}
                  setStreetName={setStreetName}
                  streetNumber={streetNumber}
                  setStreetNumber={setStreetNumber}
                  neighborhood={neighborhood}
                  setNeighborhood={setNeighborhood}
                  city={city}
                  setCity={setCity}
                  stateUf={stateUf}
                  setStateUf={setStateUf}
                  compact
                />
                <Field label="Numero do cartao">
                  <Input
                    inputMode="numeric"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    placeholder="0000 0000 0000 0000"
                  />
                </Field>
                <Field label="Nome impresso">
                  <Input
                    value={cardholderName}
                    onChange={(e) => setCardholderName(e.target.value)}
                    placeholder="NOME SOBRENOME"
                  />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Validade">
                    <Input
                      value={cardExpiration}
                      onChange={(e) => setCardExpiration(e.target.value)}
                      placeholder="MM/AA"
                    />
                  </Field>
                  <Field label="CVV">
                    <Input
                      inputMode="numeric"
                      value={securityCode}
                      onChange={(e) => setSecurityCode(e.target.value)}
                      placeholder="123"
                    />
                  </Field>
                  <Field label="Parcelas">
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={installments}
                      onChange={(e) => setInstallments(parseInt(e.target.value || "1"))}
                    />
                  </Field>
                </div>
                <p className="text-xs text-brown-deep/50">
                  Os dados do cartao sao tokenizados pelo Mercado Pago. O Empuria recebe apenas o
                  token.
                </p>
                <Button
                  onClick={payCard}
                  disabled={paymentLoading === "card" || !mpConfig?.enabled || !mpConfig?.publicKey}
                  className="w-full bg-orange-brand text-offwhite hover:bg-red-brand"
                >
                  {paymentLoading === "card" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Finalizar pagamento"
                  )}
                </Button>
              </div>
            )}

            {payment && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-brown-deep/70">
                Status Mercado Pago: <strong>{payment.status}</strong>
                {payment.statusDetail ? ` · ${payment.statusDetail}` : ""}
              </div>
            )}
            <Button
              variant="outline"
              onClick={verifyPayment}
              disabled={checkingPayment}
              className="w-full"
            >
              {checkingPayment ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Ja paguei, verificar"
              )}
            </Button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-3 py-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <Check className="h-7 w-7 text-green-700" />
            </div>
            <h3 className="font-display text-xl">Pagamento confirmado!</h3>
            <p className="text-sm text-brown-deep/60">Redirecionando para seu Portal...</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={`flex-1 border-b-2 pb-1 text-center ${active ? "border-orange-brand text-orange-brand" : done ? "border-green-600/40 text-green-700/70" : "border-border"}`}
    >
      {label}
    </span>
  );
}

function PayTab({
  active,
  onClick,
  icon: Icon,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: ElementType;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded py-2 font-display text-xs uppercase tracking-wider disabled:opacity-40 ${active ? "bg-offwhite shadow-sm" : "text-brown-deep/60"}`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-md bg-muted/50 p-3 text-left">
      <Label className="font-display text-[10px] uppercase tracking-wider">{label}</Label>
      <div className="mt-1 flex items-start gap-2">
        <code className="line-clamp-2 min-w-0 flex-1 break-all font-mono text-[10px] text-brown-deep/70">
          {value}
        </code>
        <button onClick={() => copy(value)} className="shrink-0 text-orange-brand">
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function PayerFields({
  cpf,
  setCpf,
  zipCode,
  setZipCode,
  streetName,
  setStreetName,
  streetNumber,
  setStreetNumber,
  neighborhood,
  setNeighborhood,
  city,
  setCity,
  stateUf,
  setStateUf,
  compact,
}: {
  cpf: string;
  setCpf: (v: string) => void;
  zipCode: string;
  setZipCode: (v: string) => void;
  streetName: string;
  setStreetName: (v: string) => void;
  streetNumber: string;
  setStreetNumber: (v: string) => void;
  neighborhood: string;
  setNeighborhood: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  stateUf: string;
  setStateUf: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="CPF">
          <Input
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="123.456.789-09"
          />
        </Field>
        <Field label="CEP">
          <Input
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value)}
            placeholder="06233-903"
          />
        </Field>
      </div>
      {!compact && (
        <>
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <Field label="Rua">
              <Input value={streetName} onChange={(e) => setStreetName(e.target.value)} />
            </Field>
            <Field label="Numero">
              <Input value={streetNumber} onChange={(e) => setStreetNumber(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Bairro">
              <Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
            </Field>
            <Field label="Cidade">
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label="UF">
              <Input
                maxLength={2}
                value={stateUf}
                onChange={(e) => setStateUf(e.target.value.toUpperCase())}
              />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}
