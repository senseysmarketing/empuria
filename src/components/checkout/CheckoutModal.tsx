import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  checkEmail,
  createCheckoutIntent,
  confirmMockPayment,
} from "@/lib/checkout/checkout.functions";
import { SlotPicker } from "./SlotPicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Check, Copy, QrCode } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

type ServiceKind = "airport" | "tour" | "consulting" | "banking" | "meeting";
type CheckoutService = {
  id: string;
  slug: string;
  title: string;
  price_cents: number;
  currency: string;
  kind: ServiceKind;
  requires_slot: boolean;
  short_description?: string | null;
};

type Step = "data" | "contact" | "payment" | "done";

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
  const confirm = useServerFn(confirmMockPayment);

  const [step, setStep] = useState<Step>("data");
  const [loading, setLoading] = useState(false);

  // Service data
  const [slotId, setSlotId] = useState<string | undefined>();
  const [arrivalDate, setArrivalDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [terminal, setTerminal] = useState("");
  const [bagsCount, setBagsCount] = useState<number>(1);

  // Contact
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  // Payment
  const [intent, setIntent] = useState<{
    orderId: string;
    reference: string;
    amountCents: number;
    currency: string;
    mockPix: { copyPaste: string };
  } | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<"pix" | "card">("pix");

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
      setQrUrl(null);
      setTab("pix");
    }
  }, [open]);

  useEffect(() => {
    if (!intent) return;
    QRCode.toDataURL(intent.mockPix.copyPaste, { width: 240, margin: 1 }).then(setQrUrl);
  }, [intent]);

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

  const dataStepValid = useMemo(() => {
    if (!service) return false;
    if (service.kind === "airport") {
      return !!arrivalDate && !!arrivalTime && !!flightNumber;
    }
    if (service.requires_slot) return !!slotId;
    return true;
  }, [service, arrivalDate, arrivalTime, flightNumber, slotId]);

  const submit = async () => {
    if (!service) return;
    if (!name || !whatsapp || !email || !password || password.length < 6) {
      toast.error("Preencha todos os campos (senha mínima de 6 caracteres)");
      return;
    }
    setLoading(true);
    try {
      // 1. Auth (signup or signin) on client
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
        // Auto-sign-in if email confirmation off (Lovable Cloud default)
        const { error: siErr } = await supabase.auth.signInWithPassword({ email, password });
        if (siErr) throw new Error("Confirme seu e-mail antes de continuar");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error("Senha incorreta. Tente novamente.");
      }

      // 2. Create checkout intent (server-authenticated)
      const res = await createIntent({
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
      });
      setIntent(res);
      setStep("payment");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao processar");
    } finally {
      setLoading(false);
    }
  };

  const simulatePayment = async () => {
    if (!intent) return;
    setLoading(true);
    try {
      await confirm({ data: { orderId: intent.orderId } });
      toast.success("Pagamento aprovado!");
      setStep("done");
      setTimeout(() => {
        onOpenChange(false);
        navigate({ to: "/portal" });
      }, 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  };

  if (!service) return null;
  const priceEUR = (service.price_cents / 100).toFixed(2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-offwhite text-brown-deep border-border">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-tight text-2xl">
            {service.title}
          </DialogTitle>
          <p className="text-sm text-brown-deep/60 font-body">
            € {priceEUR} · pagamento único
          </p>
        </DialogHeader>

        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-display text-brown-deep/50 mb-2">
          <StepDot active={step === "data"} done={step !== "data"} label="1. Dados" />
          <StepDot active={step === "contact"} done={step === "payment" || step === "done"} label="2. Conta" />
          <StepDot active={step === "payment"} done={step === "done"} label="3. Pagamento" />
        </div>

        {step === "data" && (
          <div className="space-y-3">
            {service.kind === "airport" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Data de chegada</Label>
                    <Input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>Horário previsto</Label>
                    <Input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Número do voo</Label>
                  <Input value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} placeholder="LA8084" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Terminal (opcional)</Label>
                    <Input value={terminal} onChange={(e) => setTerminal(e.target.value)} placeholder="T4" />
                  </div>
                  <div>
                    <Label>Quantidade de malas</Label>
                    <Input type="number" min={0} max={20} value={bagsCount} onChange={(e) => setBagsCount(parseInt(e.target.value || "0"))} />
                  </div>
                </div>
              </>
            )}
            {service.requires_slot && (
              <SlotPicker serviceId={service.id} value={slotId} onChange={setSlotId} />
            )}
            {!service.requires_slot && service.kind !== "airport" && (
              <p className="text-sm text-brown-deep/70 font-body">
                Sem agendamento prévio: nosso time entra em contato após o pagamento para conduzir o atendimento.
              </p>
            )}
            <Button
              disabled={!dataStepValid}
              onClick={() => setStep("contact")}
              className="w-full bg-orange-brand hover:bg-red-brand text-offwhite mt-2"
            >
              Continuar <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {step === "contact" && (
          <div className="space-y-3">
            <div>
              <Label>Nome completo</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como aparece no passaporte" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>WhatsApp</Label>
                <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+55 11 99999-9999" />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailExists(null); }}
                  onBlur={onEmailBlur}
                  placeholder="seu@email.com"
                />
              </div>
            </div>
            {checkingEmail && (
              <p className="text-xs text-brown-deep/50 font-body inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Verificando e-mail...
              </p>
            )}
            {emailExists !== null && (
              <div className="bg-muted/40 border border-border rounded-md p-3 animate-in fade-in slide-in-from-top-1">
                <Label className="text-xs text-orange-brand uppercase tracking-wider font-display">
                  {emailExists
                    ? "Bem-vindo de volta! Insira sua senha para vincular esta compra à sua conta"
                    : "Crie uma senha para acessar seu Passaporte Empuria"}
                </Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2"
                  placeholder="••••••"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("data")} className="flex-1">Voltar</Button>
              <Button
                onClick={submit}
                disabled={loading || !name || !whatsapp || !email || !password || emailExists === null}
                className="flex-1 bg-orange-brand hover:bg-red-brand text-offwhite"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Comprar Agora <ArrowRight className="h-4 w-4" /></>}
              </Button>
            </div>
            <p className="text-[11px] text-brown-deep/50 font-body text-center">
              Ao clicar em Comprar Agora você confirma os dados e gera o pagamento.
            </p>
          </div>
        )}

        {step === "payment" && intent && (
          <div className="space-y-4">
            <div className="flex gap-1 bg-muted/50 rounded-md p-1">
              <button
                onClick={() => setTab("pix")}
                className={`flex-1 py-2 text-xs font-display uppercase tracking-wider rounded ${tab === "pix" ? "bg-offwhite shadow-sm" : "text-brown-deep/60"}`}
              >
                PIX
              </button>
              <button
                onClick={() => setTab("card")}
                className={`flex-1 py-2 text-xs font-display uppercase tracking-wider rounded ${tab === "card" ? "bg-offwhite shadow-sm" : "text-brown-deep/60"}`}
              >
                Cartão
              </button>
            </div>

            {tab === "pix" ? (
              <div className="space-y-3 text-center">
                {qrUrl ? (
                  <img src={qrUrl} alt="QR PIX" className="mx-auto rounded-lg border border-border" />
                ) : (
                  <div className="h-[240px] flex items-center justify-center"><QrCode className="h-10 w-10 text-brown-deep/30" /></div>
                )}
                <div className="bg-muted/50 rounded-md p-3 text-left">
                  <Label className="text-[10px] uppercase tracking-wider font-display">PIX Copia e Cola</Label>
                  <div className="flex gap-2 items-center mt-1">
                    <code className="flex-1 text-[10px] font-mono text-brown-deep/70 truncate">{intent.mockPix.copyPaste}</code>
                    <button onClick={() => { navigator.clipboard.writeText(intent.mockPix.copyPaste); toast.success("Copiado"); }} className="text-orange-brand">
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div><Label>Número do cartão</Label><Input placeholder="0000 0000 0000 0000" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Validade</Label><Input placeholder="MM/AA" /></div>
                  <div><Label>CVV</Label><Input placeholder="123" /></div>
                </div>
              </div>
            )}

            <div className="text-center text-xs text-brown-deep/50 font-body italic">
              Pagamento em modo de simulação. Integração real será conectada depois.
            </div>
            <Button
              onClick={simulatePayment}
              disabled={loading}
              className="w-full bg-orange-brand hover:bg-red-brand text-offwhite"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simular pagamento aprovado"}
            </Button>
          </div>
        )}

        {step === "done" && (
          <div className="py-8 text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
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

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span className={`flex-1 text-center pb-1 border-b-2 ${active ? "border-orange-brand text-orange-brand" : done ? "border-green-600/40 text-green-700/70" : "border-border"}`}>
      {label}
    </span>
  );
}
