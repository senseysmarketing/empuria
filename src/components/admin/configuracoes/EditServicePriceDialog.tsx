import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  updateServicePrice,
  createServiceImageUploadUrl,
} from "@/lib/admin/service-prices.functions";
import { getServiceImage } from "@/lib/service-images";
import { Loader2, Save, Upload, RotateCcw } from "lucide-react";

export type ServiceRow = {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  description: string | null;
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
  image_url: string | null;
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
  const uploadUrlFn = useServerFn(createServiceImageUploadUrl);

  const [title, setTitle] = useState("");
  const [shortDesc, setShortDesc] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("0,00");
  const [isActive, setIsActive] = useState(true);
  const [requiresSlot, setRequiresSlot] = useState(false);
  const [requiresDocuments, setRequiresDocuments] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!service) return;
    setTitle(service.title ?? "");
    setShortDesc(service.short_description ?? "");
    setDescription(service.description ?? "");
    setImageUrl(service.image_url ?? null);
    setPriceInput(centsToInput(service.online_price_cents ?? service.price_cents));
    setIsActive(Boolean(service.is_active));
    setRequiresSlot(Boolean(service.requires_slot));
    setRequiresDocuments(Boolean(service.requires_documents));
    setDuration(Number(service.duration_minutes ?? 0));
    setNote(service.display_price_note ?? "");
  }, [service]);

  const handleFile = async (file: File) => {
    if (!service) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Use JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Imagem máxima de 4 MB.");
      return;
    }
    try {
      setUploading(true);
      const signed = await uploadUrlFn({
        data: {
          service_id: service.id,
          filename: file.name,
          content_type: file.type,
        },
      });
      if (!signed.uploadUrl) throw new Error("Falha ao gerar URL de upload");
      const res = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Falha ao enviar imagem");
      setImageUrl(signed.publicUrl);
      toast.success("Imagem enviada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar imagem");
    } finally {
      setUploading(false);
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!service) throw new Error("Serviço inválido");
      const priceNumber = Number(String(priceInput).replace(",", "."));
      const cents = Math.round((Number.isFinite(priceNumber) ? priceNumber : 0) * 100);

      if (!title.trim()) throw new Error("Informe um título.");
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
          title: title.trim(),
          short_description: shortDesc.trim() || null,
          description: description.trim() || null,
          image_url: imageUrl,
          online_price_cents: cents,
          online_currency: "EUR",
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

  const previewSrc = imageUrl || getServiceImage({ image_url: null, kind: service?.kind ?? null });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {service?.title ?? "Editar serviço"}
          </DialogTitle>
          <DialogDescription>
            Ajuste o conteúdo público, imagem de capa, valor e regras de venda.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Imagem de capa */}
          <div className="space-y-2">
            <Label>Imagem de capa</Label>
            <div className="flex gap-4">
              <div className="h-28 w-40 overflow-hidden rounded-lg border border-admin-border bg-admin-surface-2">
                <img src={previewSrc} alt="Capa" className="h-full w-full object-cover" />
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {imageUrl ? "Trocar imagem" : "Enviar imagem"}
                </Button>
                {imageUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-2 text-admin-ink-muted"
                    onClick={() => setImageUrl(null)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Voltar para padrão
                  </Button>
                )}
                <p className="text-xs text-admin-ink-muted">JPG, PNG ou WEBP até 4 MB.</p>
              </div>
            </div>
          </div>

          {/* Identidade */}
          <div className="space-y-2">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>

          <div className="space-y-2">
            <Label>Descrição curta</Label>
            <Textarea
              value={shortDesc}
              onChange={(e) => setShortDesc(e.target.value)}
              maxLength={280}
              rows={2}
              placeholder="Resumo de uma linha exibido no card do serviço."
            />
          </div>

          <div className="space-y-2">
            <Label>Descrição completa</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
              rows={5}
              placeholder="Detalhes exibidos na página do serviço."
            />
          </div>

          {/* Preço */}
          <div className="space-y-2">
            <Label>Valor cobrado no site (EUR)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-admin-ink-muted">€</span>
              <Input
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="0,00"
                className="pl-7"
              />
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
