import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { refreshWisePaymentStatus } from "@/lib/wise/wise.functions";

type Props = {
  orderId: string;
  amountCents: number;
  currency: string;
  reference: string;
  paymentUrl: string | null;
  iban: string | null;
  bic: string | null;
  beneficiaryName: string | null;
  onApproved?: () => void;
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(cents / 100);
}

function copy(text: string, label = "Copiado") {
  navigator.clipboard.writeText(text);
  toast.success(label);
}

export function WisePaymentPanel({
  orderId,
  amountCents,
  currency,
  reference,
  paymentUrl,
  iban,
  bic,
  beneficiaryName,
  onApproved,
}: Props) {
  const refresh = useServerFn(refreshWisePaymentStatus);
  const [approved, setApproved] = useState(false);
  const [wiseStatus, setWiseStatus] = useState<string>("waiting_payment");
  const [bankOpen, setBankOpen] = useState(!paymentUrl); // open by default only when no Wise URL

  const checkMutation = useMutation({
    mutationFn: () => refresh({ data: { orderId } }),
    onSuccess: (r) => {
      setWiseStatus(r.wiseStatus ?? "waiting_payment");
      if (r.paymentStatus === "aprovado") {
        setApproved(true);
        toast.success("Pagamento confirmado!");
        onApproved?.();
      } else if (r.wiseStatus === "underpaid") {
        toast.warning("Recebemos um valor menor que o esperado. Equipe ja foi notificada.");
      } else if (r.wiseStatus === "overpaid") {
        toast.warning("Recebemos um valor maior que o esperado. Equipe ja foi notificada.");
      } else {
        toast.info("Ainda nao localizamos seu pagamento. Pode levar alguns minutos.");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao verificar"),
  });

  // Poll every 10s, stop after 30 tries or when approved/hidden
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (approved) return;
    let count = 0;
    const tick = async () => {
      if (document.hidden) return;
      count += 1;
      try {
        const r = await refresh({ data: { orderId } });
        setWiseStatus(r.wiseStatus ?? "waiting_payment");
        if (r.paymentStatus === "aprovado") {
          setApproved(true);
          toast.success("Pagamento confirmado!");
          onApproved?.();
          if (pollRef.current) window.clearInterval(pollRef.current);
        }
      } catch {
        /* ignore */
      }
      if (count >= 30 && pollRef.current) window.clearInterval(pollRef.current);
    };
    pollRef.current = window.setInterval(tick, 10000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [orderId, refresh, approved, onApproved]);

  if (approved) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center text-emerald-700">
        <CheckCircle2 className="mx-auto h-10 w-10" />
        <h3 className="mt-3 font-display text-lg">Pagamento confirmado!</h3>
        <p className="mt-1 text-sm">Pedido recebido. Nossa equipe ja foi notificada.</p>
      </div>
    );
  }

  const hasBank = !!(iban || bic);
  const statusBanner =
    wiseStatus === "underpaid"
      ? { tone: "amber", text: "Recebemos um valor menor que o esperado. Aguarde nossa equipe." }
      : wiseStatus === "overpaid"
        ? { tone: "amber", text: "Recebemos um valor maior que o esperado. Aguarde nossa equipe." }
        : null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
        <div className="font-display text-[11px] uppercase tracking-widest text-brown-deep/60">
          Total a pagar
        </div>
        <div className="mt-1 font-display text-3xl text-orange-brand">
          {money(amountCents, currency)}
        </div>
        <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-orange-brand/10 px-3 py-1 text-[11px] uppercase tracking-widest text-orange-brand">
          Referencia · {reference}
        </div>
      </div>

      {statusBanner && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-center text-sm text-amber-800">
          {statusBanner.text}
        </div>
      )}

      {paymentUrl ? (
        <>
          <a href={paymentUrl} target="_blank" rel="noopener noreferrer" className="block">
            <Button
              size="lg"
              className="h-12 w-full bg-orange-brand text-base text-offwhite hover:bg-red-brand"
            >
              <Wallet className="mr-2 h-5 w-5" /> Pagar com Wise
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </a>
          <p className="text-center text-xs text-brown-deep/60">
            Voce sera direcionado para a Wise. Use a referencia <strong>{reference}</strong> para
            identificarmos seu pagamento.
          </p>
        </>
      ) : hasBank ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-center text-xs text-amber-800">
          Pagamento por transferencia bancaria em EUR. Use os dados abaixo.
        </div>
      ) : (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-center text-xs text-red-800">
          Pagamento Wise indisponivel no momento. Entre em contato com a equipe.
        </div>
      )}

      {hasBank && (
        <div className="rounded-lg border border-dashed border-border bg-muted/20">
          <button
            type="button"
            onClick={() => setBankOpen((v) => !v)}
            className="flex w-full items-center justify-between p-4 text-left"
          >
            <span className="font-display text-[11px] uppercase tracking-widest text-brown-deep/70">
              {paymentUrl ? "Ou faca uma transferencia bancaria" : "Dados bancarios EUR"}
            </span>
            <ChevronDown
              className={`h-4 w-4 text-brown-deep/60 transition ${bankOpen ? "rotate-180" : ""}`}
            />
          </button>
          {bankOpen && (
            <div className="border-t border-border/60 px-4 pb-4 pt-2 text-sm">
              {beneficiaryName && (
                <Row label="Beneficiario" value={beneficiaryName} onCopy={() => copy(beneficiaryName)} />
              )}
              {iban && <Row label="IBAN" value={iban} onCopy={() => copy(iban)} mono />}
              {bic && <Row label="BIC/SWIFT" value={bic} onCopy={() => copy(bic)} mono />}
              <Row
                label="Valor"
                value={money(amountCents, currency)}
                onCopy={() => copy(String(amountCents / 100))}
              />
              <Row label="Referencia" value={reference} onCopy={() => copy(reference)} mono />
              <p className="mt-3 text-[11px] text-brown-deep/60">
                Inclua a referencia <strong>{reference}</strong> na transferencia para conciliacao
                automatica.
              </p>
            </div>
          )}
        </div>
      )}

      <Button
        variant="outline"
        className="w-full"
        disabled={checkMutation.isPending}
        onClick={() => checkMutation.mutate()}
      >
        {checkMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        Ja paguei, verificar agora
      </Button>

      <p className="text-center text-[11px] text-brown-deep/50">
        Pagamento em EUR processado pela Wise · conexao segura
      </p>
    </div>
  );
}

function Row({
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
        <Label className="font-display text-[10px] uppercase tracking-wider text-brown-deep/60">
          {label}
        </Label>
        <div className={`break-all text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="mt-4 shrink-0 text-orange-brand"
        aria-label="Copiar"
      >
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
}
