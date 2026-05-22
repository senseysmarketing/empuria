import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { createCheckoutIntent, confirmMockPayment } from "@/lib/checkout/checkout.functions";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, QrCode, Copy, Check, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

export type ShopService = {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  description: string | null;
  kind: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
};

export function UpsellSheet({
  service,
  open,
  onOpenChange,
}: {
  service: ShopService | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const createIntent = useServerFn(createCheckoutIntent);
  const confirm = useServerFn(confirmMockPayment);
  const [loading, setLoading] = useState(false);
  const [intent, setIntent] = useState<{
    orderId: string;
    reference: string;
    amountCents: number;
    mockPix: { copyPaste: string };
  } | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setIntent(null);
      setQr(null);
    }
  }, [open]);

  useEffect(() => {
    if (!intent) return;
    QRCode.toDataURL(intent.mockPix.copyPaste, { width: 240, margin: 1 }).then(setQr);
  }, [intent]);

  const buyNow = async () => {
    if (!service) return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      toast.error("Sessão expirada");
      return;
    }
    setLoading(true);
    try {
      const profile = await supabase.from("profiles").select("full_name, phone").eq("id", data.user.id).single();
      const res = await createIntent({
        data: {
          serviceSlug: service.slug,
          contact: {
            name: profile.data?.full_name ?? data.user.email ?? "Membro",
            whatsapp: profile.data?.phone ?? "—",
          },
          serviceData: {},
        },
      });
      setIntent(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar compra");
    } finally {
      setLoading(false);
    }
  };

  const simulate = async () => {
    if (!intent) return;
    setLoading(true);
    try {
      await confirm({ data: { orderId: intent.orderId } });
      toast.success("Pagamento confirmado!");
      onOpenChange(false);
      setTimeout(() => navigate({ to: "/portal/servicos" }), 400);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  };

  if (!service) return null;
  const priceEUR = (service.price_cents / 100).toFixed(2);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="bg-admin-surface text-admin-ink border-admin-border overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl text-admin-ink">{service.title}</SheetTitle>
        </SheetHeader>

        {service.image_url && (
          <div className="aspect-video rounded-xl overflow-hidden mt-4 bg-admin-surface-2">
            <img src={service.image_url} alt={service.title} className="w-full h-full object-cover" />
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div className="text-3xl font-display font-bold text-admin-accent">€ {priceEUR}</div>
          {service.short_description && (
            <p className="text-sm text-admin-ink-soft font-body">{service.short_description}</p>
          )}
          {service.description && (
            <div className="text-sm text-admin-ink-muted font-body whitespace-pre-line">{service.description}</div>
          )}
        </div>

        {!intent ? (
          <div className="mt-6 space-y-3">
            <div className="bg-admin-surface-2 border border-admin-border rounded-xl p-4 text-xs text-admin-ink-muted font-body">
              Ao clicar em <strong className="text-admin-ink">Comprar agora</strong>, geramos sua ordem e exibimos as formas de pagamento.
            </div>
            <Button
              onClick={buyNow}
              disabled={loading}
              className="w-full bg-orange-brand hover:bg-red-brand text-offwhite h-12 text-base"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <><ShoppingBag className="h-4 w-4 mr-2" /> Comprar agora · € {priceEUR}</>
              )}
            </Button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="text-center">
              {qr ? (
                <img src={qr} alt="QR PIX" className="mx-auto rounded-lg border border-admin-border" />
              ) : (
                <div className="h-[240px] flex items-center justify-center"><QrCode className="h-10 w-10 text-admin-ink-muted" /></div>
              )}
            </div>
            <div className="bg-admin-surface-2 border border-admin-border rounded-xl p-3">
              <div className="text-[10px] uppercase tracking-widest font-display text-admin-ink-muted mb-1">PIX Copia e Cola</div>
              <div className="flex gap-2 items-center">
                <code className="flex-1 text-[10px] font-mono text-admin-ink-soft truncate">{intent.mockPix.copyPaste}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(intent.mockPix.copyPaste); toast.success("Copiado"); }}
                  className="text-admin-accent"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <Button
              onClick={simulate}
              disabled={loading}
              className="w-full bg-orange-brand hover:bg-red-brand text-offwhite"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <><Check className="h-4 w-4 mr-2" /> Simular pagamento aprovado</>
              )}
            </Button>
            <p className="text-[11px] text-admin-ink-muted text-center italic">
              Modo simulação · integração real conectada em breve.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
