import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getPublicPaymentLink,
  type PublicPaymentLinkResult,
} from "@/lib/payments/payment-links.functions";
import {
  checkPublicMercadoPagoPayment,
  createPublicMercadoPagoPayment,
} from "@/lib/mercadopago/mercadopago.functions";
import { getPublicWisePayment } from "@/lib/wise/wise.functions";
import { WisePaymentPanel } from "@/components/payments/WisePaymentPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/pagar/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pagamento seguro · Instituto Empuria" },
      { name: "robots", content: "noindex,nofollow" },
      {
        name: "description",
        content:
          "Conclua o pagamento do seu pedido com o Instituto Empuria por Pix ou cartão de crédito.",
      },
    ],
  }),
  component: PagarPage,
});

type MpPayment = {
  id: string;
  method: "pix" | "boleto" | "credit_card";
  status: string;
  statusDetail: string | null;
  orderPaymentStatus: "pendente" | "aprovado" | "recusado" | "estornado";
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
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

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function formatCpf(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

function isValidCpf(value: string) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  return rev === parseInt(cpf[10]);
}

function cardBrand(number: string) {
  const digits = number.replace(/\D/g, "");
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "master";
  if (/^3[47]/.test(digits)) return "amex";
  return "visa";
}

let mpSdkPromise: Promise<void> | null = null;
function loadMercadoPagoSdk() {
  if (mpSdkPromise) return mpSdkPromise;
  mpSdkPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("SSR"));
    if (window.MercadoPago) return resolve();
    const script = document.createElement("script");
    script.src = "https://sdk.mercadopago.com/js/v2";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar Mercado Pago"));
    document.head.appendChild(script);
  });
  return mpSdkPromise;
}

function PagarPage() {
  const { token } = Route.useParams();
  const fetchLink = useServerFn(getPublicPaymentLink);
  const fetchWise = useServerFn(getPublicWisePayment);

  const linkQuery = useQuery({
    queryKey: ["payment-link", token],
    queryFn: () => fetchLink({ data: { token } }),
    refetchOnWindowFocus: false,
  });

  const wiseQuery = useQuery({
    queryKey: ["wise-payment", token],
    queryFn: () => fetchWise({ data: { token } }),
    enabled: !!linkQuery.data && linkQuery.data.ok === true,
    refetchOnWindowFocus: false,
  });

  if (linkQuery.isLoading) {
    return (
      <Shell>
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-brown-deep/50" />
        </div>
      </Shell>
    );
  }

  if (linkQuery.error || !linkQuery.data) {
    return (
      <Shell>
        <StatusCard
          tone="error"
          title="Não foi possível abrir o pagamento"
          message={
            linkQuery.error instanceof Error
              ? linkQuery.error.message
              : "Tente novamente em instantes."
          }
        />
      </Shell>
    );
  }

  const data = linkQuery.data;
  if (!data.ok) {
    const titles: Record<string, string> = {
      not_found: "Link inválido",
      expired: "Link expirado",
      revoked: "Link revogado",
      paid: "Pagamento já realizado",
      canceled: "Pedido cancelado",
      refunded: "Pedido estornado",
    };
    return (
      <Shell>
        <StatusCard
          tone={data.reason === "paid" ? "success" : "warning"}
          title={titles[data.reason] ?? "Link indisponível"}
          message={data.message}
        />
      </Shell>
    );
  }

  // Wise (EUR) is the primary provider. Use it whenever the order is in EUR
  // or the wise payment row exists. Mercado Pago stays as legacy fallback.
  const isWise = (wiseQuery.data?.currency ?? data.currency ?? "").toUpperCase() === "EUR";
  if (isWise && wiseQuery.data) {
    const w = wiseQuery.data;
    return (
      <Shell>
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="font-display text-[11px] uppercase tracking-widest text-brown-deep/50">
              Resumo do pedido
            </div>
            <div className="mt-1 text-base font-medium">{w.serviceTitle}</div>
            <div className="text-sm text-brown-deep/60">Cliente: {w.customerName}</div>
          </div>
          <WisePaymentPanel
            orderId={w.orderId}
            amountCents={w.amountCents}
            currency={w.currency}
            reference={w.reference}
            paymentUrl={w.paymentUrl}
            iban={w.iban}
            bic={w.bic}
            beneficiaryName={w.beneficiaryName}
          />
        </div>
      </Shell>
    );
  }

  return <PaymentBody token={token} data={data} />;
}

function PaymentBody({
  token,
  data,
}: {
  token: string;
  data: Extract<PublicPaymentLinkResult, { ok: true }>;
}) {
  const createPayment = useServerFn(createPublicMercadoPagoPayment);
  const checkPayment = useServerFn(checkPublicMercadoPagoPayment);

  const allowPix = data.paymentMethods.includes("pix");
  const allowCard = data.paymentMethods.includes("card");
  const [tab, setTab] = useState<"pix" | "card">(allowPix ? "pix" : "card");
  const [payment, setPayment] = useState<MpPayment | null>(null);
  const [approved, setApproved] = useState(false);

  // Card fields
  const [cardNumber, setCardNumber] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const [cardExpiration, setCardExpiration] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const [installments, setInstallments] = useState(1);
  const [cpf, setCpf] = useState("");

  const pixMutation = useMutation({
    mutationFn: async () => {
      const r = await createPayment({ data: { token, method: "pix" } });
      return r.payment as MpPayment;
    },
    onSuccess: (p) => {
      setPayment(p);
      if (p.orderPaymentStatus === "aprovado") setApproved(true);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao gerar Pix"),
  });

  const cardMutation = useMutation({
    mutationFn: async () => {
      if (!data.mercadoPagoPublicKey) throw new Error("Cartão indisponível.");
      const [month, year] = cardExpiration.split("/").map((v) => v.trim());
      if (!cardNumber || !cardholderName || !month || !year || !securityCode || !cpf) {
        throw new Error("Preencha os dados do cartão e CPF.");
      }
      if (!isValidCpf(cpf)) throw new Error("CPF inválido.");
      await loadMercadoPagoSdk();
      if (!window.MercadoPago) throw new Error("SDK Mercado Pago indisponível.");
      const mp = new window.MercadoPago(data.mercadoPagoPublicKey);
      const cardToken = await mp.createCardToken({
        cardNumber: cardNumber.replace(/\s/g, ""),
        cardholderName,
        cardExpirationMonth: month.padStart(2, "0"),
        cardExpirationYear: year.length === 2 ? `20${year}` : year,
        securityCode,
        identificationType: "CPF",
        identificationNumber: onlyDigits(cpf),
      });
      const r = await createPayment({
        data: {
          token,
          method: "credit_card",
          payer: { cpf },
          card: {
            token: cardToken.id,
            paymentMethodId: cardBrand(cardNumber),
            installments,
          },
        },
      });
      return r.payment as MpPayment;
    },
    onSuccess: (p) => {
      setPayment(p);
      if (p.orderPaymentStatus === "aprovado") {
        setApproved(true);
        toast.success("Pagamento aprovado!");
      } else if (p.orderPaymentStatus === "recusado") {
        toast.error("Pagamento recusado pelo Mercado Pago.");
      } else {
        toast.info("Pagamento em processamento.");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao processar cartão"),
  });

  // Auto-polling for Pix
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!payment || payment.method !== "pix" || approved) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await checkPayment({ data: { token } });
        if (r.payment) setPayment(r.payment as MpPayment);
        if (r.orderPaymentStatus === "aprovado") {
          setApproved(true);
          toast.success("Pagamento confirmado!");
        }
      } catch {
        // ignore transient errors during polling
      }
    }, 6000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [payment, approved, checkPayment, token]);

  const expirationCountdown = useMemo(() => {
    if (!payment?.expiresAt) return null;
    const diff = new Date(payment.expiresAt).getTime() - Date.now();
    if (diff <= 0) return "expirado";
    const min = Math.floor(diff / 60000);
    const sec = Math.floor((diff % 60000) / 1000);
    return `${min}m${String(sec).padStart(2, "0")}s`;
  }, [payment]);

  if (approved) {
    return (
      <Shell>
        <StatusCard
          tone="success"
          title="Pagamento confirmado!"
          message={`Obrigado, ${data.customerName.split(" ")[0]}! Seu pedido foi recebido e nossa equipe já foi notificada.`}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-5">
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="font-display text-[11px] uppercase tracking-widest text-brown-deep/50">
            Resumo do pedido
          </div>
          <div className="mt-1 text-base font-medium">{data.serviceTitle}</div>
          <div className="text-sm text-brown-deep/60">Cliente: {data.customerName}</div>
          <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm text-brown-deep/60">Total</span>
            <strong className="font-display text-2xl text-orange-brand">
              {money(data.amountCents, data.currency)}
            </strong>
          </div>
          <div className="mt-1 text-[11px] text-brown-deep/40">Ref. {data.reference}</div>
        </div>

        {!data.mercadoPagoEnabled && (
          <StatusCard
            tone="warning"
            title="Pagamento indisponível"
            message="O processador de pagamento está temporariamente fora do ar. Entre em contato com o Instituto Empuria."
          />
        )}

        {data.mercadoPagoEnabled && (
          <>
            <div className="flex gap-1 rounded-md bg-muted/50 p-1">
              {allowPix && (
                <TabBtn active={tab === "pix"} onClick={() => setTab("pix")} icon={QrCode} label="Pix" />
              )}
              {allowCard && (
                <TabBtn
                  active={tab === "card"}
                  onClick={() => setTab("card")}
                  icon={CreditCard}
                  label="Cartão"
                />
              )}
            </div>

            {tab === "pix" && (
              <div className="space-y-3 text-center">
                {payment?.method === "pix" && payment.qrCode ? (
                  <>
                    {payment.qrCodeBase64 && (
                      <div className="flex justify-center">
                        <img
                          src={`data:image/png;base64,${payment.qrCodeBase64}`}
                          alt="QR Code Pix"
                          className="h-auto w-full max-w-[240px] rounded-lg border border-border bg-white p-2"
                        />
                      </div>
                    )}
                    <div className="rounded-md bg-muted/40 p-3 text-left">
                      <Label className="font-display text-[10px] uppercase tracking-wider">
                        Pix copia e cola
                      </Label>
                      <div className="mt-1 flex items-start gap-2">
                        <code className="line-clamp-3 min-w-0 flex-1 break-all font-mono text-[10px] text-brown-deep/70">
                          {payment.qrCode}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(payment.qrCode!);
                            toast.success("Copiado");
                          }}
                          className="shrink-0 text-orange-brand"
                          aria-label="Copiar"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {expirationCountdown && (
                      <p className="text-xs text-brown-deep/60">
                        Pix válido por mais{" "}
                        <strong className="font-mono tabular-nums text-orange-brand">
                          {expirationCountdown}
                        </strong>
                      </p>
                    )}
                    <p className="inline-flex items-center gap-2 text-xs text-brown-deep/60">
                      <Loader2 className="h-3 w-3 animate-spin" /> Aguardando confirmação...
                    </p>
                  </>
                ) : (
                  <Button
                    onClick={() => pixMutation.mutate()}
                    disabled={pixMutation.isPending}
                    className="w-full bg-orange-brand text-offwhite hover:bg-red-brand"
                  >
                    {pixMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Gerar Pix"
                    )}
                  </Button>
                )}
              </div>
            )}

            {tab === "card" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="CPF">
                    <Input
                      value={cpf}
                      onChange={(e) => setCpf(formatCpf(e.target.value))}
                      placeholder="123.456.789-09"
                      inputMode="numeric"
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
                <Field label="Número do cartão">
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
                <div className="grid grid-cols-2 gap-3">
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
                </div>
                <p className="text-[11px] text-brown-deep/50">
                  Os dados do cartão são tokenizados pelo Mercado Pago. O Empuria recebe apenas o
                  token criptografado.
                </p>
                <Button
                  onClick={() => cardMutation.mutate()}
                  disabled={cardMutation.isPending || !data.mercadoPagoPublicKey}
                  className="w-full bg-orange-brand text-offwhite hover:bg-red-brand"
                >
                  {cardMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `Pagar ${money(data.amountCents, data.currency)}`
                  )}
                </Button>
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-center gap-2 pt-2 text-[11px] text-brown-deep/50">
          <ShieldCheck className="h-3.5 w-3.5" />
          Pagamento processado pelo Mercado Pago · conexão segura
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-offwhite px-4 py-8 text-brown-deep">
      <div className="w-full max-w-md">
        <header className="mb-6 text-center">
          <div className="font-display text-xs uppercase tracking-[0.3em] text-orange-brand">
            Instituto Empuria
          </div>
          <h1 className="mt-1 font-display text-xl uppercase tracking-tight">Pagamento seguro</h1>
        </header>
        {children}
        <footer className="mt-10 text-center text-[11px] text-brown-deep/40">
          © Instituto Empuria · Suporte:{" "}
          <a className="underline" href="mailto:contato@empuria.com">
            contato@empuria.com
          </a>
        </footer>
      </div>
    </div>
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

function TabBtn({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded py-2 font-display text-xs uppercase tracking-wider transition-colors ${
        active ? "bg-offwhite shadow-sm" : "text-brown-deep/60"
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function StatusCard({
  tone,
  title,
  message,
}: {
  tone: "success" | "error" | "warning";
  title: string;
  message: string;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? AlertCircle : AlertCircle;
  const color =
    tone === "success"
      ? "text-emerald-600 bg-emerald-50 border-emerald-200"
      : tone === "error"
        ? "text-red-brand bg-red-brand/10 border-red-brand/30"
        : "text-amber-700 bg-amber-50 border-amber-200";
  return (
    <div className={`rounded-lg border p-5 text-center ${color}`}>
      <Icon className="mx-auto h-10 w-10" />
      <h2 className="mt-3 font-display text-lg">{title}</h2>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}
