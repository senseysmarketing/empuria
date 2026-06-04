import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { checkEmail } from "@/lib/checkout/checkout.functions";
import { confirmTicketPurchase } from "@/lib/events/tickets.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Check, Copy, QrCode } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

type Step = "contact" | "payment" | "done";

export function EventCheckoutModal({
  open,
  onOpenChange,
  event,
  tier,
  qty,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  event: { id: string; title: string };
  tier: { id: string; name: string; price_cents: number };
  qty: number;
}) {
  const navigate = useNavigate();
  const check = useServerFn(checkEmail);
  const confirm = useServerFn(confirmTicketPurchase);

  const [step, setStep] = useState<Step>("contact");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const total = tier.price_cents * qty;
  const isFree = total === 0;
  const totalEUR = (total / 100).toFixed(2);
  const reference = `EVT-${tier.id.slice(0, 6).toUpperCase()}`;
  const pixPayload = `00020126580014BR.GOV.BCB.PIX0114+551199999999952040000530398654${totalEUR.length.toString().padStart(2, "0")}${totalEUR}5802BR5910EMPURIA6009SAO PAULO62${(reference.length + 4).toString().padStart(2, "0")}05${reference.length.toString().padStart(2, "0")}${reference}6304MOCK`;

  useEffect(() => {
    if (!open) {
      setStep("contact"); setName(""); setWhatsapp(""); setEmail("");
      setPassword(""); setEmailExists(null); setQrUrl(null);
    }
  }, [open]);

  useEffect(() => {
    if (step === "payment" && !isFree) {
      QRCode.toDataURL(pixPayload, { width: 240, margin: 1 }).then(setQrUrl);
    }
  }, [step, isFree, pixPayload]);

  const onEmailBlur = async () => {
    const e = email.trim();
    if (!e || !/^\S+@\S+\.\S+$/.test(e)) return;
    setCheckingEmail(true);
    try {
      const res = await check({ data: { email: e } });
      setEmailExists(res.exists);
    } catch { setEmailExists(null); }
    finally { setCheckingEmail(false); }
  };

  const submit = async () => {
    if (!name || !whatsapp || !email || !password || password.length < 6) {
      toast.error("Preencha todos os campos (senha mínima de 6)");
      return;
    }
    setLoading(true);
    try {
      if (emailExists === false) {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/portal`, data: { full_name: name } },
        });
        if (error) throw error;
        const { error: siErr } = await supabase.auth.signInWithPassword({ email, password });
        if (siErr) throw new Error("Confirme seu e-mail antes de continuar");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error("Senha incorreta");
      }

      if (isFree) {
        await confirm({ data: { tierId: tier.id, qty, contact: { name, whatsapp } } });
        setStep("done");
        setTimeout(() => { onOpenChange(false); navigate({ to: "/portal/ingressos" }); }, 1500);
      } else {
        setStep("payment");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setLoading(false); }
  };

  const simulatePayment = async () => {
    setLoading(true);
    try {
      await confirm({ data: { tierId: tier.id, qty, contact: { name, whatsapp } } });
      toast.success("Ingresso(s) garantido(s)!");
      setStep("done");
      setTimeout(() => { onOpenChange(false); navigate({ to: "/portal/ingressos" }); }, 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-offwhite text-brown-deep max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-tight text-2xl">{event.title}</DialogTitle>
          <p className="text-sm text-brown-deep/60">{tier.name} × {qty} · {isFree ? "Gratuito" : `€ ${totalEUR}`}</p>
        </DialogHeader>

        {step === "contact" && (
          <div className="space-y-3">
            <div><Label>Nome completo</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>WhatsApp</Label><Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+34..." /></div>
              <div><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailExists(null); }} onBlur={onEmailBlur} /></div>
            </div>
            {checkingEmail && <p className="text-xs"><Loader2 className="inline h-3 w-3 animate-spin" /> Verificando...</p>}
            {emailExists !== null && (
              <div className="bg-muted/40 border rounded-md p-3">
                <Label className="text-xs uppercase tracking-wider text-orange-brand font-display">
                  {emailExists ? "Bem-vindo de volta! Sua senha:" : "Crie uma senha para seu Passaporte:"}
                </Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2" />
              </div>
            )}
            <Button
              onClick={submit}
              disabled={loading || !name || !whatsapp || !email || !password || emailExists === null}
              className="w-full bg-orange-brand hover:bg-red-brand text-offwhite"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{isFree ? "Confirmar Reserva" : "Comprar Agora"} <ArrowRight className="h-4 w-4" /></>}
            </Button>
          </div>
        )}

        {step === "payment" && !isFree && (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              {qrUrl ? <img src={qrUrl} alt="QR PIX" className="w-full max-w-[220px] h-auto rounded-lg border border-brown/15 bg-white p-2" /> : <QrCode className="h-10 w-10 opacity-30" />}
            </div>
            <div className="bg-muted/50 rounded-md p-3 text-left overflow-hidden">
              <Label className="text-[10px] uppercase tracking-wider font-display">PIX Copia e Cola</Label>
              <div className="flex gap-2 items-start mt-1">
                <code className="flex-1 min-w-0 text-[10px] font-mono break-all line-clamp-2">{pixPayload}</code>
                <button onClick={() => { navigator.clipboard.writeText(pixPayload); toast.success("Copiado"); }} className="text-orange-brand shrink-0">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="text-xs text-brown-deep/50 italic">Pagamento em modo de simulação.</p>
            <Button onClick={simulatePayment} disabled={loading} className="w-full bg-orange-brand hover:bg-red-brand text-offwhite">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simular pagamento aprovado"}
            </Button>
          </div>
        )}

        {step === "done" && (
          <div className="py-8 text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center"><Check className="h-7 w-7 text-green-700" /></div>
            <h3 className="font-display text-xl">{isFree ? "Reserva confirmada!" : "Pagamento aprovado!"}</h3>
            <p className="text-sm text-brown-deep/60">Seu Passaporte é o ingresso. Redirecionando...</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
