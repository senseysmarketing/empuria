import { useEffect, useState, type ElementType, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCheckoutIntent } from "@/lib/checkout/checkout.functions";
import {
  checkMercadoPagoPayment,
  createMercadoPagoPayment,
  getMercadoPagoPublicCheckoutConfig,
} from "@/lib/mercadopago/mercadopago.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  Check,
  Clock,
  Copy,
  CreditCard,
  FileText,
  Loader2,
  MapPin,
  QrCode,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { useCurrentUser } from "@/hooks/use-current-user";
import { getServiceImage } from "@/lib/service-images";

export type ShopService = {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  description: string | null;
  kind: string | null;
  price_cents: number;
  currency: string;
  online_price_cents?: number | null;
  online_currency?: string | null;
  image_url: string | null;
  requires_slot?: boolean;
  document_checklist?: string[] | null;
  meeting_address?: string | null;
};

type PaymentTab = "pix" | "boleto" | "card";
type MpPayment = {
  method: "pix" | "boleto" | "credit_card";
  status: string;
  statusDetail: string | null;
  orderPaymentStatus: "pendente" | "aprovado" | "recusado" | "estornado";
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  digitableLine: string | null;
  barcodeContent: string | null;
};

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string) => {
      createCardToken: (data: Record<string, string>) => Promise<{ id: string }>;
    };
  }
}

function money(cents: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

function copy(value: string) {
  navigator.clipboard.writeText(value);
  toast.success("Copiado");
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function cardBrand(number: string) {
  const digits = number.replace(/\D/g, "");
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "master";
  if (/^3[47]/.test(digits)) return "amex";
  return "visa";
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
        { once: true },
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

export function UpsellSheet({
  service,
  open,
  onOpenChange,
}: {
  service: ShopService | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { impersonation } = useCurrentUser();
  const navigate = useNavigate();
  const createIntent = useServerFn(createCheckoutIntent);
  const fetchMpConfig = useServerFn(getMercadoPagoPublicCheckoutConfig);
  const createPayment = useServerFn(createMercadoPagoPayment);
  const checkPayment = useServerFn(checkMercadoPagoPayment);
  const [loading, setLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState<PaymentTab | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);
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
  const [qr, setQr] = useState<string | null>(null);
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

  useEffect(() => {
    if (!open) {
      setIntent(null);
      setMpConfig(null);
      setPayment(null);
      setQr(null);
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
    }
  }, [open]);

  useEffect(() => {
    const pix = payment?.method === "pix" ? payment.qrCode : null;
    if (!pix) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(pix, { width: 240, margin: 1 }).then(setQr);
  }, [payment]);

  useEffect(() => {
    if (!intent) return;
    const timer = window.setInterval(async () => {
      try {
        const result = await checkPayment({ data: { orderId: intent.orderId } });
        if (result.payment) setPayment(result.payment);
        if (result.orderPaymentStatus === "aprovado") {
          toast.success("Pagamento aprovado!");
          window.clearInterval(timer);
          onOpenChange(false);
          navigate({ to: "/portal/servicos" });
        }
      } catch {
        // Polling automatico e silencioso; o botao de verificacao exibe erro ao usuario.
      }
    }, 8000);
    return () => window.clearInterval(timer);
  }, [checkPayment, intent, navigate, onOpenChange]);

  const buyNow = async () => {
    if (!service) return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      toast.error("Sessao expirada");
      return;
    }
    setLoading(true);
    try {
      const profile = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("id", data.user.id)
        .single();
      const [intentRes, configRes] = await Promise.all([
        createIntent({
          data: {
            serviceSlug: service.slug,
            contact: {
              name:
                impersonation?.targetName ?? profile.data?.full_name ?? data.user.email ?? "Membro",
              whatsapp: impersonation ? "-" : (profile.data?.phone ?? "-"),
            },
            serviceData: {},
          },
        }),
        fetchMpConfig(),
      ]);
      setIntent(intentRes);
      setMpConfig(configRes);
      if (!configRes.enabled) toast.error("Mercado Pago ainda nao esta ativo. Fale com a equipe.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar compra");
    } finally {
      setLoading(false);
    }
  };

  const payer = {
    cpf,
    zipCode,
    streetName,
    streetNumber,
    neighborhood,
    city,
    state: stateUf.toUpperCase(),
  };

  const generatePayment = async (method: PaymentTab) => {
    if (!intent) return;
    setPaymentLoading(method);
    try {
      const result = await createPayment({
        data: {
          orderId: intent.orderId,
          method: method === "card" ? "credit_card" : method,
          payer: method === "pix" ? undefined : payer,
          card: undefined,
        },
      });
      setPayment(result.payment);
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
          payer,
          card: { token: token.id, paymentMethodId: cardBrand(cardNumber), installments },
        },
      });
      setPayment(result.payment);
      if (result.payment.orderPaymentStatus === "aprovado") {
        toast.success("Pagamento aprovado!");
        onOpenChange(false);
        navigate({ to: "/portal/servicos" });
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
        toast.success("Pagamento aprovado!");
        onOpenChange(false);
        navigate({ to: "/portal/servicos" });
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
  const displayPrice = money(
    service.online_price_cents ?? service.price_cents,
    service.online_currency ?? service.currency,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto border-admin-border bg-admin-surface text-admin-ink sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl text-admin-ink">{service.title}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 aspect-video overflow-hidden rounded-xl bg-admin-surface-2">
          <img
            src={getServiceImage(service)}
            alt={service.title}
            className="h-full w-full object-cover"
          />
        </div>

        <div className="mt-4 space-y-3">
          <div className="font-display text-3xl font-bold text-admin-accent">
            {intent ? money(intent.amountCents, intent.currency) : displayPrice}
          </div>
          {service.short_description && (
            <p className="font-body text-sm text-admin-ink-soft">{service.short_description}</p>
          )}
          {service.description && (
            <div className="whitespace-pre-line font-body text-sm text-admin-ink-muted">
              {service.description}
            </div>
          )}

          {Array.isArray(service.document_checklist) && service.document_checklist.length > 0 && (
            <div className="pt-2">
              <h4 className="mb-2 font-display text-[10px] font-bold uppercase tracking-widest text-admin-ink-muted">
                O que esta incluido
              </h4>
              <ul className="space-y-1.5">
                {service.document_checklist.map((item, i) => (
                  <li key={i} className="flex gap-2 font-body text-xs text-admin-ink-soft">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-admin-accent" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {service.meeting_address && (
            <InfoBlock icon={MapPin} title="Local" text={service.meeting_address} />
          )}
          {service.requires_slot && (
            <InfoBlock
              icon={Clock}
              title="Agendamento"
              text="A equipe confirma data e horario apos o pagamento."
            />
          )}
        </div>

        {!intent ? (
          <div className="mt-6 space-y-3">
            <div className="rounded-xl border border-admin-border bg-admin-surface-2 p-4 font-body text-xs text-admin-ink-muted">
              Ao clicar em <strong className="text-admin-ink">Comprar agora</strong>, geramos sua
              ordem e exibimos as formas de pagamento.
            </div>
            <Button
              onClick={buyNow}
              disabled={loading}
              className="h-12 w-full bg-orange-brand text-base text-offwhite hover:bg-red-brand"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ShoppingBag className="mr-2 h-4 w-4" /> Comprar agora - {displayPrice}
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex gap-1 rounded-md bg-admin-surface-2 p-1">
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
              <div className="space-y-3">
                {payment?.method === "pix" && payment.qrCode ? (
                  <>
                    <div className="flex justify-center">
                      {payment.qrCodeBase64 ? (
                        <img
                          src={`data:image/png;base64,${payment.qrCodeBase64}`}
                          alt="QR Pix"
                          className="h-auto w-full max-w-[220px] rounded-lg border border-admin-border bg-white p-2"
                        />
                      ) : qr ? (
                        <img
                          src={qr}
                          alt="QR Pix"
                          className="h-auto w-full max-w-[220px] rounded-lg border border-admin-border bg-white p-2"
                        />
                      ) : (
                        <div className="flex h-[220px] w-[220px] items-center justify-center">
                          <QrCode className="h-10 w-10 text-admin-ink-muted" />
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
                        className="inline-flex h-9 w-full items-center justify-center rounded-md border border-admin-border px-4 py-2 text-sm font-medium hover:bg-admin-surface-2"
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
                <Field label="CPF">
                  <Input
                    value={cpf}
                    onChange={(e) => setCpf(e.target.value)}
                    placeholder="123.456.789-09"
                  />
                </Field>
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
                <p className="text-xs text-admin-ink-muted">
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
              <div className="rounded-md border border-admin-border bg-admin-surface-2 p-3 text-xs text-admin-ink-muted">
                Status Mercado Pago: <strong>{payment.status}</strong>
                {payment.statusDetail ? ` - ${payment.statusDetail}` : ""}
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
      </SheetContent>
    </Sheet>
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
      className={`flex flex-1 items-center justify-center gap-1 rounded py-2 font-display text-[10px] uppercase tracking-wider disabled:opacity-40 ${active ? "bg-admin-surface shadow-sm" : "text-admin-ink-muted"}`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-admin-border bg-admin-surface-2 p-3">
      <div className="mb-1 font-display text-[10px] uppercase tracking-widest text-admin-ink-muted">
        {label}
      </div>
      <div className="flex items-start gap-2">
        <code className="line-clamp-2 min-w-0 flex-1 break-all font-mono text-[10px] text-admin-ink-soft">
          {value}
        </code>
        <button onClick={() => copy(value)} className="shrink-0 text-admin-accent">
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function InfoBlock({
  icon: Icon,
  title,
  text,
}: {
  icon: ElementType;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border border-admin-border bg-admin-surface-2 p-3">
      <div className="mb-1 flex items-center gap-2 font-display text-[10px] uppercase tracking-widest text-admin-ink-muted">
        <Icon className="h-3 w-3" /> {title}
      </div>
      <div className="font-body text-xs text-admin-ink-soft">{text}</div>
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
    </div>
  );
}
