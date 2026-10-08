import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { checkEmail, createCheckoutIntent } from "@/lib/checkout/checkout.functions";
import { SlotPicker } from "./SlotPicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

type CheckoutService = {
  id: string;
  slug: string;
  title: string;
  price_cents: number;
  currency: string;
  online_price_cents?: number | null;
  online_currency?: string | null;
  kind: "airport" | "tour" | "consulting" | "banking" | "meeting" | null;
  requires_slot: boolean;
};
type Step = "data" | "contact" | "done";

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(cents / 100);
}

export function CheckoutModal({
  service,
  open,
  onOpenChange,
}: {
  service: CheckoutService | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const check = useServerFn(checkEmail);
  const createIntent = useServerFn(createCheckoutIntent);
  const [step, setStep] = useState<Step>("data");
  const [loading, setLoading] = useState(false);
  const [slotId, setSlotId] = useState<string | undefined>();
  const [arrivalDate, setArrivalDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [terminal, setTerminal] = useState("");
  const [bagsCount, setBagsCount] = useState(1);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
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
    setOrderId(null);
  }, [open]);

  const dataStepValid = useMemo(() => {
    if (!service) return false;
    if (service.kind === "airport") return !!arrivalDate && !!arrivalTime && !!flightNumber;
    if (service.requires_slot) return !!slotId;
    return true;
  }, [service, arrivalDate, arrivalTime, flightNumber, slotId]);

  const onEmailBlur = async () => {
    const trimmed = email.trim();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) return;
    setCheckingEmail(true);
    try {
      const result = await check({ data: { email: trimmed } });
      setEmailExists(result.exists);
    } catch {
      setEmailExists(null);
    } finally {
      setCheckingEmail(false);
    }
  };

  const submit = async () => {
    if (!service) return;
    if (!name || !whatsapp || !email || !password || password.length < 6) {
      toast.error("Preencha todos os campos (senha mínima de 6 caracteres)");
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
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw new Error("Confirme seu e-mail antes de continuar");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error("Senha incorreta. Tente novamente.");
      }
      const result = await createIntent({
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
      setOrderId(result.orderId);
      setStep("done");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao registrar pedido");
    } finally {
      setLoading(false);
    }
  };

  if (!service) return null;
  const amount = money(
    service.online_price_cents ?? service.price_cents,
    service.online_currency ?? service.currency,
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-offwhite text-brown-deep">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl uppercase tracking-tight">
            {service.title}
          </DialogTitle>
          <p className="font-body text-sm text-brown-deep/60">{amount} · solicitação de serviço</p>
        </DialogHeader>
        {step !== "done" && (
          <div className="mb-2 flex items-center gap-2 font-display text-[11px] uppercase tracking-widest text-brown-deep/50">
            <StepDot active={step === "data"} done={step !== "data"} label="1. Dados" />
            <StepDot active={step === "contact"} done={false} label="2. Conta" />
          </div>
        )}
        {step === "data" && (
          <div className="space-y-3">
            {service.kind === "airport" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Data de chegada">
                    <Input
                      type="date"
                      value={arrivalDate}
                      onChange={(event) => setArrivalDate(event.target.value)}
                    />
                  </Field>
                  <Field label="Horário previsto">
                    <Input
                      type="time"
                      value={arrivalTime}
                      onChange={(event) => setArrivalTime(event.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Número do voo">
                  <Input
                    value={flightNumber}
                    onChange={(event) => setFlightNumber(event.target.value)}
                    placeholder="LA8084"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Terminal">
                    <Input
                      value={terminal}
                      onChange={(event) => setTerminal(event.target.value)}
                      placeholder="T4"
                    />
                  </Field>
                  <Field label="Malas">
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={bagsCount}
                      onChange={(event) => setBagsCount(Number(event.target.value || 0))}
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
                Sem agendamento prévio: nosso time entrará em contato após o pedido.
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
                onChange={(event) => setName(event.target.value)}
                placeholder="Como aparece no passaporte"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="WhatsApp">
                <PhoneInput value={whatsapp} onChange={(value) => setWhatsapp(value ?? "")} />
              </Field>
              <Field label="E-mail">
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
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
                  onChange={(event) => setPassword(event.target.value)}
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
                    Registrar pedido <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
        {step === "done" && (
          <div className="space-y-4 py-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <Check className="h-7 w-7 text-green-700" />
            </div>
            <h3 className="font-display text-xl">Pedido registrado</h3>
            <p className="text-sm text-brown-deep/70">
              Recebemos sua solicitação. Nossa equipe dará sequência ao atendimento e ao pagamento.
            </p>
            {orderId && <p className="text-xs text-brown-deep/50">Pedido #{orderId.slice(0, 8)}</p>}
            <Button
              onClick={() => {
                onOpenChange(false);
                navigate({ to: "/portal" });
              }}
              className="w-full bg-orange-brand text-offwhite hover:bg-red-brand"
            >
              Ir para o Portal
            </Button>
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
