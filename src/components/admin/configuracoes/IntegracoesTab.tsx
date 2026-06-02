import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BentoCard } from "@/components/admin/BentoCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CalendarDays,
  Copy,
  CreditCard,
  Crown,
  Loader2,
  MessageCircle,
  RotateCw,
} from "lucide-react";
import {
  getHublaAdminOverview,
  saveHublaSettings,
  testHublaConfiguration,
} from "@/lib/hubla/hubla.functions";

const PLANNED_INTEGRATIONS = [
  {
    key: "mercadopago",
    name: "Mercado Pago",
    icon: CreditCard,
    accent: "text-sky-600",
    description: "Pagamentos, Pix, checkout e confirmacao automatica de pedidos.",
  },
  {
    key: "whatsapp",
    name: "WhatsApp / Uazapi",
    icon: MessageCircle,
    accent: "text-emerald-600",
    description: "Notificacoes, automacoes e conversas operacionais.",
  },
  {
    key: "google-agenda",
    name: "Google Agenda",
    icon: CalendarDays,
    accent: "text-indigo-600",
    description: "Sincronizacao de consultas, compromissos e follow-ups.",
  },
] as const;

function emptyToNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export function IntegracoesTab() {
  const fetchOverview = useServerFn(getHublaAdminOverview);
  const saveHubla = useServerFn(saveHublaSettings);
  const testHubla = useServerFn(testHublaConfiguration);
  const [enabled, setEnabled] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);

  const overviewQ = useQuery({
    queryKey: ["hubla-admin-overview"],
    queryFn: async () => {
      const data = await fetchOverview();
      setEnabled(!!data.setting.is_enabled);
      return data;
    },
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = useMemo(
    () => `${origin}${overviewQ.data?.webhookUrl ?? "/api/webhooks/hubla"}`,
    [origin, overviewQ.data?.webhookUrl],
  );

  const saveMutation = useMutation({
    mutationFn: (form: FormData) =>
      saveHubla({
        data: {
          is_enabled: enabled,
          checkout_url: emptyToNull(form.get("checkout_url")),
          post_purchase_url: emptyToNull(form.get("post_purchase_url")),
          webhook_secret: emptyToNull(form.get("webhook_secret")),
          product_id: emptyToNull(form.get("product_id")),
          offer_id: emptyToNull(form.get("offer_id")),
          whatsapp_group_url: emptyToNull(form.get("whatsapp_group_url")),
        },
      }),
    onSuccess: () => {
      toast.success("Configuracao Hubla salva");
      setConfigOpen(false);
      overviewQ.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar Hubla"),
  });

  const testMutation = useMutation({
    mutationFn: () => testHubla(),
    onSuccess: (result) => {
      if (result.ok) toast.success("Configuracao minima da Hubla esta pronta");
      else toast.error(`Faltando: ${result.missing.join(", ")}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao testar Hubla"),
  });

  const setting = overviewQ.data?.setting;
  const events = overviewQ.data?.events ?? [];
  const errorCount = overviewQ.data?.errorCount ?? 0;
  const hasCheckout = Boolean(setting?.checkout_url);
  const hasSecret = Boolean(setting?.webhook_secret);
  const statusLabel = errorCount > 0 ? "Erro" : enabled ? "Ativa" : "Inativa";
  const statusClass =
    errorCount > 0
      ? "bg-red-100 text-red-800"
      : enabled
        ? "bg-emerald-100 text-emerald-800"
        : "bg-slate-200 text-slate-700";
  const webhookLabel =
    errorCount > 0
      ? "erro"
      : enabled && hasSecret && setting?.last_event_at
        ? "funcionando"
        : hasSecret
          ? "aguardando evento"
          : "aguardando configuracao";

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <IntegrationCard
          icon={Crown}
          iconClassName="text-amber-500"
          name="Hubla"
          description="Assinaturas do Clube do Imigrante"
          badge={<Badge className={statusClass}>{statusLabel}</Badge>}
          details={[
            ["Status", statusLabel],
            ["Checkout", hasCheckout ? "configurado" : "nao configurado"],
            ["Webhook", webhookLabel],
            ["Ultimo evento", formatRelativeDate(setting?.last_event_at)],
          ]}
          actions={
            <>
              <Button type="button" size="sm" onClick={() => setConfigOpen(true)}>
                Configurar
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEventsOpen(true)}>
                Ver eventos
              </Button>
            </>
          }
          loading={overviewQ.isLoading}
        />

        {PLANNED_INTEGRATIONS.map((integration) => (
          <IntegrationCard
            key={integration.key}
            icon={integration.icon}
            iconClassName={integration.accent}
            name={integration.name}
            description={integration.description}
            badge={<Badge variant="outline">Planejado</Badge>}
            details={[
              ["Status", "nao configurada"],
              ["Checkout", "nao aplicavel"],
              ["Webhook", "aguardando"],
              ["Ultimo evento", "aguardando"],
            ]}
            actions={
              <Button type="button" size="sm" variant="outline" disabled>
                Em breve
              </Button>
            }
          />
        ))}
      </div>

      <HublaConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        enabled={enabled}
        setEnabled={setEnabled}
        webhookUrl={webhookUrl}
        setting={setting}
        saveMutation={saveMutation}
        testMutation={testMutation}
      />

      <HublaEventsDialog open={eventsOpen} onOpenChange={setEventsOpen} events={events} />
    </div>
  );
}

function IntegrationCard({
  icon: Icon,
  iconClassName,
  name,
  description,
  badge,
  details,
  actions,
  loading,
}: {
  icon: React.ElementType;
  iconClassName: string;
  name: string;
  description: string;
  badge: React.ReactNode;
  details: Array<[string, string]>;
  actions: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <BentoCard className="flex min-h-[280px] flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-admin-border bg-admin-bg">
          <Icon className={`h-5 w-5 ${iconClassName}`} />
        </div>
        {badge}
      </div>

      <div className="mt-4">
        <h3 className="font-display text-xl font-bold text-admin-ink">{name}</h3>
        <p className="mt-1 min-h-10 text-sm leading-relaxed text-admin-ink-muted">{description}</p>
      </div>

      <div className="mt-5 space-y-2 text-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-admin-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando status...
          </div>
        ) : (
          details.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <span className="text-admin-ink-muted">{label}</span>
              <span className="max-w-[150px] truncate text-right font-medium text-admin-ink">
                {value}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="mt-auto flex flex-wrap gap-2 pt-5">{actions}</div>
    </BentoCard>
  );
}

function HublaConfigDialog({
  open,
  onOpenChange,
  enabled,
  setEnabled,
  webhookUrl,
  setting,
  saveMutation,
  testMutation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  webhookUrl: string;
  setting:
    | {
        checkout_url: string | null;
        post_purchase_url: string | null;
        webhook_secret: string | null;
        product_id: string | null;
        offer_id: string | null;
        whatsapp_group_url: string | null;
      }
    | undefined;
  saveMutation: {
    mutate: (form: FormData) => void;
    isPending: boolean;
  };
  testMutation: {
    mutate: () => void;
    isPending: boolean;
  };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-admin-border bg-admin-surface text-admin-ink sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Configurar Hubla</DialogTitle>
          <DialogDescription className="text-admin-ink-muted">
            Dados tecnicos da assinatura do Clube do Imigrante e webhook de conciliacao.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4 lg:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate(new FormData(e.currentTarget));
          }}
        >
          <div className="flex items-center justify-between rounded-xl border border-admin-border bg-admin-surface-2 p-4 lg:col-span-2">
            <div>
              <Label className="font-display text-sm uppercase tracking-wide">
                Ativar integracao
              </Label>
              <p className="mt-1 text-xs text-admin-ink-muted">
                Webhooks so serao aceitos quando a integracao estiver ativa e com segredo.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <Field label="Checkout fixo Hubla">
            <Input
              name="checkout_url"
              type="url"
              placeholder="https://..."
              defaultValue={setting?.checkout_url ?? ""}
            />
          </Field>
          <Field label="URL pos-compra Empuria">
            <Input
              name="post_purchase_url"
              placeholder="/clube/sucesso"
              defaultValue={setting?.post_purchase_url ?? "/clube/sucesso"}
            />
          </Field>
          <Field label="Segredo do webhook">
            <Input
              name="webhook_secret"
              type="password"
              placeholder={
                setting?.webhook_secret
                  ? "Preenchido - deixe em branco para manter"
                  : "Token secreto"
              }
            />
          </Field>
          <Field label="URL do webhook">
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly />
              <Button
                type="button"
                variant="outline"
                className="shrink-0 gap-2"
                onClick={() => {
                  navigator.clipboard.writeText(webhookUrl);
                  toast.success("URL do webhook copiada");
                }}
              >
                <Copy className="h-4 w-4" />
                Copiar
              </Button>
            </div>
          </Field>
          <Field label="ID do produto Hubla">
            <Input name="product_id" defaultValue={setting?.product_id ?? ""} />
          </Field>
          <Field label="ID da oferta Hubla">
            <Input name="offer_id" defaultValue={setting?.offer_id ?? ""} />
          </Field>
          <Field label="Link do grupo WhatsApp">
            <Input
              name="whatsapp_group_url"
              type="url"
              placeholder="https://chat.whatsapp.com/..."
              defaultValue={setting?.whatsapp_group_url ?? ""}
            />
          </Field>

          <div className="flex flex-wrap items-center justify-end gap-2 lg:col-span-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="gap-2"
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
              Testar
            </Button>
            <Button type="submit" disabled={saveMutation.isPending} className="min-w-44">
              {saveMutation.isPending ? "Salvando..." : "Salvar configuracoes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HublaEventsDialog({
  open,
  onOpenChange,
  events,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: Array<{
    id: string;
    event_type: string;
    buyer_email: string | null;
    status: string;
    created_at: string;
    error_message: string | null;
  }>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-admin-border bg-admin-surface text-admin-ink sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Eventos Hubla</DialogTitle>
          <DialogDescription className="text-admin-ink-muted">
            Ultimos webhooks recebidos e status de conciliacao.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto rounded-xl border border-admin-border bg-admin-surface-2">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-admin-ink-muted">
              <tr className="border-b border-admin-border">
                <th className="px-4 py-3">Evento</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Recebido</th>
                <th className="px-4 py-3">Erro</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-admin-ink-muted">
                    Nenhum evento recebido ainda.
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={event.id} className="border-b border-admin-border last:border-0">
                    <td className="px-4 py-3 text-admin-ink">{event.event_type}</td>
                    <td className="px-4 py-3 text-admin-ink-muted">{event.buyer_email ?? "-"}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{event.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-admin-ink-muted">
                      {new Date(event.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="max-w-[260px] truncate px-4 py-3 text-red-700">
                      {event.error_message ?? "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
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

function formatRelativeDate(value: string | null | undefined) {
  if (!value) return "aguardando";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "aguardando";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return "agora";
  if (diffMinutes < 60) return `${diffMinutes} min atras`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} h atras`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 8) return `${diffDays} d atras`;

  return date.toLocaleDateString("pt-BR");
}
