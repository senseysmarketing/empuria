import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { updateServicePrice } from "@/lib/admin/service-prices.functions";
import { Loader2, Save } from "lucide-react";

export type ServiceRow = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  kind: string | null;
  price_cents: number;
  currency: string;
  online_price_cents: number | null;
  online_currency: string | null;
  display_price_note: string | null;
  is_active: boolean;
  requires_slot: boolean;
  requires_documents: boolean;
  duration_minutes: number | null;
};

function centsToInput(cents: number | null | undefined) {
  return ((cents ?? 0) / 100).toFixed(2).replace(".", ",");
}

type Props = {
  service: ServiceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
};

export function EditServicePriceDialog({ service, open, onOpenChange, onSaved }: Props) {
  const updateFn = useServerFn(updateServicePrice);

  const [priceInput, setPriceInput] = useState("0,00");
  const [isActive, setIsActive] = useState(true);
  const [requiresSlot, setRequiresSlot] = useState(false);
  const [requiresDocuments, setRequiresDocuments] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!service) return;
    setPriceInput(centsToInput(service.online_price_cents ?? service.price_cents));
    setIsActive(Boolean(service.is_active));
    setRequiresSlot(Boolean(service.requires_slot));
    setRequiresDocuments(Boolean(service.requires_documents));
    setDuration(Number(service.duration_minutes ?? 0));
    setNote(service.display_price_note ?? "");
  }, [service]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!service) throw new Error("Serviço inválido");
      const priceNumber = Number(String(priceInput).replace(",", "."));
      const cents = Math.round((Number.isFinite(priceNumber) ? priceNumber : 0) * 100);

      if (requiresSlot && (!duration || duration <= 0)) {
        throw new Error("Informe uma duração maior que zero para serviços com agendamento.");
      }
      if (isActive && cents === 0) {
        const ok = window.confirm(
          "Este serviço está ativo com valor R$ 0,00. Deseja salvar mesmo assim?",
        );
        if (!ok) throw new Error("Salvamento cancelado.");
      }

      return updateFn({
        data: {
          id: service.id,
          online_price_cents: cents,
          online_currency: "BRL",
          display_price_note: note.trim() || null,
          is_active: isActive,
          requires_slot: requiresSlot,
          requires_documents: requiresDocuments,
          duration_minutes: requiresSlot ? Number(duration) : null,
        },
      });
    },
    onSuccess: async () => {
      toast.success("Serviço atualizado");
      await onSaved();
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : "Erro ao salvar serviço";
      if (msg !== "Salvamento cancelado.") toast.error(msg);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {service?.title ?? "Editar serviço"}
          </DialogTitle>
          <DialogDescription>
            Ajuste o valor cobrado no site e as regras de venda deste serviço.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label>Valor cobrado no site (BRL)</Label>
            <div className="grid grid-cols-[1fr_84px] gap-2">
              <Input
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="0,00"
              />
              <Input value="BRL" readOnly />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-admin-border px-3 py-2">
            <div>
              <Label className="text-sm">Status</Label>
              <p className="text-xs text-admin-ink-muted">
                Serviços inativos não aparecem no site.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-admin-ink-muted">{isActive ? "Ativo" : "Inativo"}</span>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-admin-border p-3">
            <Label className="text-sm">Regras de venda</Label>
            <label className="flex items-start gap-3">
              <Checkbox
                checked={requiresSlot}
                onCheckedChange={(v) => setRequiresSlot(Boolean(v))}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm text-admin-ink">Exige agendamento</div>
                <div className="text-xs text-admin-ink-muted">
                  O cliente escolhe um horário disponível no checkout.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3">
              <Checkbox
                checked={requiresDocuments}
                onCheckedChange={(v) => setRequiresDocuments(Boolean(v))}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm text-admin-ink">Exige documentos</div>
                <div className="text-xs text-admin-ink-muted">
                  Gera checklist documental no portal após o pagamento.
                </div>
              </div>
            </label>

            {requiresSlot && (
              <div className="space-y-1 pt-2">
                <Label className="text-xs text-admin-ink-muted">Duração estimada (minutos)</Label>
                <Input
                  type="number"
                  min={0}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value || 0))}
                />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label>Nota pública</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: valor promocional por tempo limitado"
              maxLength={180}
            />
            <p className="text-xs text-admin-ink-muted">
              Aparece publicamente no card do serviço quando preenchida.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="gap-2">
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
