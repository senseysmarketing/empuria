import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { submitConsultoriaLead } from "@/lib/leads/public.functions";
import { toast } from "sonner";
import { SuccessFinale } from "./SuccessFinale";

type Country = "espanha" | "brasil" | "europa" | "outro";
type Visa = "residencia" | "cidadania" | "relocation" | "outros";
type Timeline = "ate_3m" | "3_6m" | "6_12m" | "mais_12m";
type Budget = "ate_2k" | "2_5k" | "5_10k" | "mais_10k";

interface Answers {
  current_country: Country | null;
  target_visa: Visa | null;
  timeline: Timeline | null;
  budget_range: Budget | null;
  full_name: string;
  email: string;
  phone: string;
  message: string;
}

const empty: Answers = {
  current_country: null,
  target_visa: null,
  timeline: null,
  budget_range: null,
  full_name: "",
  email: "",
  phone: "",
  message: "",
};

export function ConsultoriaWizardModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(empty);
  const [submitted, setSubmitted] = useState<{ firstName: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = useServerFn(submitConsultoriaLead);

  const totalSteps = 4;
  const progress = ((submitted ? totalSteps : step) / totalSteps) * 100;

  const reset = () => {
    setStep(0);
    setAnswers(empty);
    setSubmitted(null);
    setLoading(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) setTimeout(reset, 250);
    onOpenChange(v);
  };

  const next = () => setStep((s) => Math.min(s + 1, totalSteps - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async () => {
    if (!answers.current_country || !answers.target_visa || !answers.timeline || !answers.budget_range) return;
    setLoading(true);
    try {
      const res = await submit({
        data: {
          full_name: answers.full_name,
          email: answers.email,
          phone: answers.phone,
          current_country: answers.current_country,
          target_visa: answers.target_visa,
          timeline: answers.timeline,
          budget_range: answers.budget_range,
          message: answers.message || null,
        },
      });
      setSubmitted({ firstName: res.firstName });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar — tente novamente");
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl p-0 overflow-hidden bg-offwhite border-brown/10 [&>button]:text-brown/60">
        {/* Progress bar */}
        <div className="h-1 bg-brown/10 w-full overflow-hidden">
          <motion.div
            className="h-full bg-orange-brand"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>

        <div className="px-8 py-10 min-h-[420px] relative">
          <AnimatePresence mode="wait">
            {submitted ? (
              <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <SuccessFinale firstName={submitted.firstName} onClose={() => handleClose(false)} />
              </motion.div>
            ) : (
              <motion.div
                key={`step-${step}`}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="space-y-6"
              >
                <div className="text-xs font-display uppercase tracking-[0.3em] text-orange-brand">
                  Passo {step + 1} de {totalSteps}
                </div>

                {step === 0 && (
                  <StepBlock title="Onde você está morando agora?">
                    {[
                      { v: "espanha", label: "Já estou na Espanha" },
                      { v: "brasil", label: "Ainda estou no Brasil" },
                      { v: "europa", label: "Outro país da Europa" },
                      { v: "outro", label: "Outro país" },
                    ].map((o) => (
                      <BigChoice
                        key={o.v}
                        selected={answers.current_country === o.v}
                        onClick={() => {
                          setAnswers({ ...answers, current_country: o.v as Country });
                          setTimeout(next, 180);
                        }}
                      >
                        {o.label}
                      </BigChoice>
                    ))}
                  </StepBlock>
                )}

                {step === 1 && (
                  <StepBlock title="Qual é a sua principal necessidade hoje?">
                    {[
                      { v: "residencia", label: "Visto de Residência" },
                      { v: "cidadania", label: "Cidadania" },
                      { v: "relocation", label: "Relocation completo" },
                      { v: "outros", label: "Outros" },
                    ].map((o) => (
                      <BigChoice
                        key={o.v}
                        selected={answers.target_visa === o.v}
                        onClick={() => {
                          setAnswers({ ...answers, target_visa: o.v as Visa });
                          setTimeout(next, 180);
                        }}
                      >
                        {o.label}
                      </BigChoice>
                    ))}
                  </StepBlock>
                )}

                {step === 2 && (
                  <StepBlock title="Prazo & orçamento para os trâmites">
                    <div className="space-y-4">
                      <div>
                        <Label className="text-xs uppercase tracking-wider text-brown/60 mb-2 block">
                          Quando você quer começar?
                        </Label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { v: "ate_3m", label: "Em até 3 meses" },
                            { v: "3_6m", label: "3 a 6 meses" },
                            { v: "6_12m", label: "6 a 12 meses" },
                            { v: "mais_12m", label: "+12 meses" },
                          ].map((o) => (
                            <PillChoice
                              key={o.v}
                              selected={answers.timeline === o.v}
                              onClick={() => setAnswers({ ...answers, timeline: o.v as Timeline })}
                            >
                              {o.label}
                            </PillChoice>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs uppercase tracking-wider text-brown/60 mb-2 block">
                          Orçamento reservado para honorários
                        </Label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { v: "ate_2k", label: "Até €2.000" },
                            { v: "2_5k", label: "€2.000 — €5.000" },
                            { v: "5_10k", label: "€5.000 — €10.000" },
                            { v: "mais_10k", label: "Acima de €10.000" },
                          ].map((o) => (
                            <PillChoice
                              key={o.v}
                              selected={answers.budget_range === o.v}
                              onClick={() => setAnswers({ ...answers, budget_range: o.v as Budget })}
                            >
                              {o.label}
                            </PillChoice>
                          ))}
                        </div>
                      </div>
                    </div>
                  </StepBlock>
                )}

                {step === 3 && (
                  <StepBlock title="Perfeito. Como podemos te contatar?">
                    <p className="text-sm text-brown/70 -mt-2">
                      Nossos especialistas vão analisar seu caso e responder em até 24h.
                    </p>
                    <div className="grid gap-3">
                      <div>
                        <Label className="text-xs uppercase tracking-wider text-brown/60">Nome completo</Label>
                        <Input
                          value={answers.full_name}
                          onChange={(e) => setAnswers({ ...answers, full_name: e.target.value })}
                          placeholder="Seu nome"
                          maxLength={120}
                          className="mt-1 bg-offwhite border-brown/20"
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs uppercase tracking-wider text-brown/60">E-mail</Label>
                          <Input
                            type="email"
                            value={answers.email}
                            onChange={(e) => setAnswers({ ...answers, email: e.target.value })}
                            placeholder="voce@email.com"
                            maxLength={255}
                            className="mt-1 bg-offwhite border-brown/20"
                          />
                        </div>
                        <div>
                          <Label className="text-xs uppercase tracking-wider text-brown/60">WhatsApp</Label>
                          <Input
                            value={answers.phone}
                            onChange={(e) => setAnswers({ ...answers, phone: e.target.value })}
                            placeholder="+55 11 99999-9999"
                            maxLength={30}
                            className="mt-1 bg-offwhite border-brown/20"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs uppercase tracking-wider text-brown/60">
                          Quer contar algo a mais? (opcional)
                        </Label>
                        <Textarea
                          value={answers.message}
                          onChange={(e) => setAnswers({ ...answers, message: e.target.value })}
                          placeholder="Conte brevemente seu cenário, profissão, família..."
                          maxLength={1000}
                          rows={3}
                          className="mt-1 bg-offwhite border-brown/20"
                        />
                      </div>
                    </div>
                  </StepBlock>
                )}

                {/* Navigation */}
                <div className="flex items-center justify-between pt-2">
                  <Button
                    variant="ghost"
                    onClick={back}
                    disabled={step === 0}
                    className="text-brown/70 hover:text-brown disabled:opacity-0"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
                  </Button>

                  {step === 2 && (
                    <Button
                      onClick={next}
                      disabled={!answers.timeline || !answers.budget_range}
                      className="bg-orange-brand hover:bg-yellow-brand hover:text-brown text-offwhite font-display uppercase tracking-widest text-xs"
                    >
                      Continuar <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  )}

                  {step === 3 && (
                    <Button
                      onClick={onSubmit}
                      disabled={
                        loading ||
                        answers.full_name.trim().length < 2 ||
                        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.email) ||
                        answers.phone.trim().length < 6
                      }
                      className="bg-orange-brand hover:bg-yellow-brand hover:text-brown text-offwhite font-display uppercase tracking-widest text-xs"
                    >
                      {loading ? "Enviando..." : "Enviar aplicação"}
                      <Check className="w-4 h-4 ml-1" />
                    </Button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <h2 className="font-display font-bold text-2xl md:text-3xl text-brown leading-tight">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function BigChoice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-5 py-4 rounded-xl border-2 transition-all font-body text-base ${
        selected
          ? "border-orange-brand bg-orange-brand/10 text-brown shadow-warm"
          : "border-brown/15 bg-offwhite hover:border-orange-brand/50 hover:bg-orange-brand/5 text-brown/90"
      }`}
    >
      {children}
    </button>
  );
}

function PillChoice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-3 rounded-lg border-2 text-sm font-body transition-all ${
        selected
          ? "border-orange-brand bg-orange-brand text-offwhite"
          : "border-brown/15 bg-offwhite hover:border-orange-brand/50 text-brown/90"
      }`}
    >
      {children}
    </button>
  );
}
