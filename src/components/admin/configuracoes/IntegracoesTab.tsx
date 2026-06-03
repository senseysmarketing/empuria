import { useMemo, useState, type ElementType, type ReactNode } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  getMercadoPagoAdminOverview,
  saveMercadoPagoSettings,
  testMercadoPagoConfiguration,
} from "@/lib/mercadopago/mercadopago.functions";

type IntegrationEvent = {
  id: string;
  event_type: string;
  buyer_email: string | null;
  status: string;
  created_at: string;
  error_message: string | null;
};

type MercadoPagoSetting = {
  is_enabled: boolean;
  environment: "test" | "production";
  public_key: string | null;
  access_token: string | null;
  webhook_secret: string | null;
  default_currency: "BRL" | "EUR" | "USD";
  statement_descriptor: string;
  pix_enabled: boolean;
  boleto_enabled: boolean;
  card_enabled: boolean;
  pix_expiration_minutes: number;
  boleto_expiration_days: number;
  last_event_at: string | null;
};

const PLANNED_INTEGRATIONS = [
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

function numberFromForm(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function IntegracoesTab() {
  const fetchHublaOverview = useServerFn(getHublaAdminOverview);
  const saveHubla = useServerFn(saveHublaSettings);
  const testHubla = useServerFn(testHublaConfiguration);
  const fetchMpOverview = useServerFn(getMercadoPagoAdminOverview);
  const saveMp = useServerFn(saveMercadoPagoSettings);
  const testMp = useServerFn(testMercadoPagoConfiguration);

  const [hublaEnabled, setHublaEnabled] = useState(false);
  const [hublaConfigOpen, setHublaConfigOpen] = useState(false);
  const [hublaEventsOpen, setHublaEventsOpen] = useState(false);
  const [mpEnabled, setMpEnabled] = useState(false);
  const [mpConfigOpen, setMpConfigOpen] = useState(false);
  const [mpEventsOpen, setMpEventsOpen] = useState(false);
  const [mpEnvironment, setMpEnvironment] = useState<"test" | "production">("test");
  const [mpPixEnabled, setMpPixEnabled] = useState(true);
  const [mpBoletoEnabled, setMpBoletoEnabled] = useState(true);
  const [mpCardEnabled, setMpCardEnabled] = useState(false);

  const hublaQ = useQuery({
    queryKey: ["hubla-admin-overview"],
    queryFn: async () => {
      const data = await fetchHublaOverview();
      setHublaEnabled(!!data.setting.is_enabled);
      return data;
    },
  });

  const mpQ = useQuery({
    queryKey: ["mercadopago-admin-overview"],
    queryFn: async () => {
      const data = await fetchMpOverview();
      setMpEnabled(!!data.setting.is_enabled);
      setMpEnvironment(data.setting.environment);
      setMpPixEnabled(!!data.setting.pix_enabled);
      setMpBoletoEnabled(!!data.setting.boleto_enabled);
      setMpCardEnabled(!!data.setting.card_enabled);
      return data;
    },
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const hublaWebhookUrl = useMemo(
    () => `${origin}${hublaQ.data?.webhookUrl ?? "/api/webhooks/hubla"}`,
    [origin, hublaQ.data?.webhookUrl],
  );
  const mpWebhookUrl = useMemo(
    () => `${origin}${mpQ.data?.webhookUrl ?? "/api/webhooks/mercadopago"}`,
    [origin, mpQ.data?.webhookUrl],
  );

  const saveHublaMutation = useMutation({
    mutationFn: (form: FormData) =>
      saveHubla({
        data: {
          is_enabled: hublaEnabled,
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
      setHublaConfigOpen(false);
      hublaQ.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar Hubla"),
  });

  const saveMpMutation = useMutation({
    mutationFn: (form: FormData) =>
      saveMp({
        data: {
          is_enabled: mpEnabled,
          environment: mpEnvironment,
          public_key: emptyToNull(form.get("public_key")),
          access_token: emptyToNull(form.get("access_token")),
          webhook_secret: emptyToNull(form.get("webhook_secret")),
          default_currency: "BRL",
          statement_descriptor:
            String(form.get("statement_descriptor") ?? "")
              .trim()
              .toUpperCase() || "EMPURIA",
          pix_enabled: mpPixEnabled,
          boleto_enabled: mpBoletoEnabled,
          card_enabled: mpCardEnabled,
          pix_expiration_minutes: numberFromForm(form.get("pix_expiration_minutes"), 30),
          boleto_expiration_days: numberFromForm(form.get("boleto_expiration_days"), 3),
        },
      }),
    onSuccess: () => {
      toast.success("Configuracao Mercado Pago salva");
      setMpConfigOpen(false);
      mpQ.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar Mercado Pago"),
  });

  const testHublaMutation = useMutation({
    mutationFn: () => testHubla(),
    onSuccess: (result) => {
      if (result.ok) toast.success("Configuracao minima da Hubla esta pronta");
      else toast.error(`Faltando: ${result.missing.join(", ")}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao testar Hubla"),
  });

  const testMpMutation = useMutation({
    mutationFn: () => testMp(),
    onSuccess: (result) => {
      if (result.ok) toast.success(result.message);
      else
        toast.error(
          result.missing.length ? `Faltando: ${result.missing.join(", ")}` : result.message,
        );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao testar Mercado Pago"),
  });

  const hublaSetting = hublaQ.data?.setting;
  const hublaEvents = (hublaQ.data?.events ?? []) as IntegrationEvent[];
  const hublaErrorCount = hublaQ.data?.errorCount ?? 0;
  const hublaStatus = cardStatus(hublaEnabled, hublaErrorCount);
  const hublaWebhook = webhookStatus({
    enabled: hublaEnabled,
    hasSecret: Boolean(hublaSetting?.webhook_secret),
    lastEventAt: hublaSetting?.last_event_at,
    errorCount: hublaErrorCount,
  });

  const mpSetting = mpQ.data?.setting as MercadoPagoSetting | undefined;
  const mpEvents = (mpQ.data?.events ?? []) as IntegrationEvent[];
  const mpErrorCount = mpQ.data?.errorCount ?? 0;
  const mpStatus = cardStatus(mpEnabled, mpErrorCount);
  const mpWebhook = webhookStatus({
    enabled: mpEnabled,
    hasSecret: Boolean(mpSetting?.webhook_secret),
    lastEventAt: mpSetting?.last_event_at,
    errorCount: mpErrorCount,
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <IntegrationCard
          icon={Crown}
          iconClassName="text-amber-500"
          name="Hubla"
          description="Assinaturas do Clube do Imigrante"
          badge={<Badge className={hublaStatus.className}>{hublaStatus.label}</Badge>}
          details={[
            ["Status", hublaStatus.label],
            ["Checkout", hublaSetting?.checkout_url ? "configurado" : "nao configurado"],
            ["Webhook", hublaWebhook],
            ["Ultimo evento", formatRelativeDate(hublaSetting?.last_event_at)],
          ]}
          actions={
            <>
              <Button type="button" size="sm" onClick={() => setHublaConfigOpen(true)}>
                Configurar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setHublaEventsOpen(true)}
              >
                Ver eventos
              </Button>
            </>
          }
          loading={hublaQ.isLoading}
        />

        <IntegrationCard
          icon={CreditCard}
          iconClassName="text-sky-600"
          name="Mercado Pago"
          description="Pix, boleto e cartao no checkout interno"
          badge={<Badge className={mpStatus.className}>{mpStatus.label}</Badge>}
          details={[
            ["Status", mpStatus.label],
            [
              "Checkout",
              mpSetting?.public_key && mpSetting?.access_token ? "configurado" : "nao configurado",
            ],
            ["Webhook", mpWebhook],
            ["Ultimo evento", formatRelativeDate(mpSetting?.last_event_at)],
          ]}
          actions={
            <>
              <Button type="button" size="sm" onClick={() => setMpConfigOpen(true)}>
                Configurar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setMpEventsOpen(true)}
              >
                Ver eventos
              </Button>
            </>
          }
          loading={mpQ.isLoading}
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
        open={hublaConfigOpen}
        onOpenChange={setHublaConfigOpen}
        enabled={hublaEnabled}
        setEnabled={setHublaEnabled}
        webhookUrl={hublaWebhookUrl}
        setting={hublaSetting}
        saveMutation={saveHublaMutation}
        testMutation={testHublaMutation}
      />

      <EventsDialog
        open={hublaEventsOpen}
        onOpenChange={setHublaEventsOpen}
        title="Eventos Hubla"
        description="Ultimos webhooks recebidos e status de conciliacao."
        events={hublaEvents}
      />

      <MercadoPagoConfigDialog
        open={mpConfigOpen}
        onOpenChange={setMpConfigOpen}
        enabled={mpEnabled}
        setEnabled={setMpEnabled}
        environment={mpEnvironment}
        setEnvironment={setMpEnvironment}
        pixEnabled={mpPixEnabled}
        setPixEnabled={setMpPixEnabled}
        boletoEnabled={mpBoletoEnabled}
        setBoletoEnabled={setMpBoletoEnabled}
        cardEnabled={mpCardEnabled}
        setCardEnabled={setMpCardEnabled}
        webhookUrl={mpWebhookUrl}
        setting={mpSetting}
        saveMutation={saveMpMutation}
        testMutation={testMpMutation}
      />

      <EventsDialog
        open={mpEventsOpen}
        onOpenChange={setMpEventsOpen}
        title="Eventos Mercado Pago"
        description="Ultimos webhooks recebidos, reconsultas e erros de conciliacao."
        events={mpEvents}
      />
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
  icon: ElementType;
  iconClassName: string;
  name: string;
  description: string;
  badge: ReactNode;
  details: Array<[string, string]>;
  actions: ReactNode;
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
  saveMutation: { mutate: (form: FormData) => void; isPending: boolean };
  testMutation: { mutate: () => void; isPending: boolean };
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
          <SwitchPanel
            title="Ativar integracao"
            description="Webhooks so serao aceitos quando a integracao estiver ativa e com segredo."
            checked={enabled}
            onCheckedChange={setEnabled}
          />

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
          <ReadonlyWebhookField webhookUrl={webhookUrl} />
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

          <DialogActions saveMutation={saveMutation} testMutation={testMutation} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MercadoPagoConfigDialog({
  open,
  onOpenChange,
  enabled,
  setEnabled,
  environment,
  setEnvironment,
  pixEnabled,
  setPixEnabled,
  boletoEnabled,
  setBoletoEnabled,
  cardEnabled,
  setCardEnabled,
  webhookUrl,
  setting,
  saveMutation,
  testMutation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  environment: "test" | "production";
  setEnvironment: (value: "test" | "production") => void;
  pixEnabled: boolean;
  setPixEnabled: (value: boolean) => void;
  boletoEnabled: boolean;
  setBoletoEnabled: (value: boolean) => void;
  cardEnabled: boolean;
  setCardEnabled: (value: boolean) => void;
  webhookUrl: string;
  setting: MercadoPagoSetting | undefined;
  saveMutation: { mutate: (form: FormData) => void; isPending: boolean };
  testMutation: { mutate: () => void; isPending: boolean };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-admin-border bg-admin-surface text-admin-ink sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Configurar Mercado Pago</DialogTitle>
          <DialogDescription className="text-admin-ink-muted">
            Credenciais do checkout transparente, webhook e metodos de pagamento.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4 lg:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate(new FormData(e.currentTarget));
          }}
        >
          <SwitchPanel
            title="Ativar Mercado Pago"
            description="Pix, boleto e cartao ficam disponiveis no checkout somente quando a integracao estiver ativa."
            checked={enabled}
            onCheckedChange={setEnabled}
          />

          <Field label="Ambiente">
            <Select
              value={environment}
              onValueChange={(value) => setEnvironment(value as "test" | "production")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="test">Teste</SelectItem>
                <SelectItem value="production">Producao</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Public Key">
            <Input
              name="public_key"
              placeholder="APP_USR-..."
              defaultValue={setting?.public_key ?? ""}
            />
          </Field>
          <Field label="Access Token">
            <Input
              name="access_token"
              type="password"
              placeholder={
                setting?.access_token ? "Preenchido - deixe em branco para manter" : "APP_USR-..."
              }
            />
          </Field>
          <Field label="Segredo do webhook">
            <Input
              name="webhook_secret"
              type="password"
              placeholder={
                setting?.webhook_secret
                  ? "Preenchido - deixe em branco para manter"
                  : "Secret signature"
              }
            />
          </Field>
          <ReadonlyWebhookField webhookUrl={webhookUrl} />
          <Field label="Descriptor da fatura">
            <Input
              name="statement_descriptor"
              maxLength={22}
              defaultValue={setting?.statement_descriptor ?? "EMPURIA"}
            />
          </Field>
          <Field label="Moeda padrao">
            <Input value="BRL" readOnly />
          </Field>
          <Field label="Expiracao Pix (minutos)">
            <Input
              name="pix_expiration_minutes"
              type="number"
              min={5}
              max={1440}
              defaultValue={setting?.pix_expiration_minutes ?? 30}
            />
          </Field>
          <Field label="Expiracao boleto (dias)">
            <Input
              name="boleto_expiration_days"
              type="number"
              min={1}
              max={30}
              defaultValue={setting?.boleto_expiration_days ?? 3}
            />
          </Field>

          <div className="grid gap-3 lg:col-span-2 md:grid-cols-3">
            <InlineSwitch title="Pix" checked={pixEnabled} onCheckedChange={setPixEnabled} />
            <InlineSwitch
              title="Boleto"
              checked={boletoEnabled}
              onCheckedChange={setBoletoEnabled}
            />
            <InlineSwitch title="Cartao" checked={cardEnabled} onCheckedChange={setCardEnabled} />
          </div>

          <DialogActions saveMutation={saveMutation} testMutation={testMutation} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EventsDialog({
  open,
  onOpenChange,
  title,
  description,
  events,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  events: IntegrationEvent[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-admin-border bg-admin-surface text-admin-ink sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{title}</DialogTitle>
          <DialogDescription className="text-admin-ink-muted">{description}</DialogDescription>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SwitchPanel({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-admin-border bg-admin-surface-2 p-4 lg:col-span-2">
      <div>
        <Label className="font-display text-sm uppercase tracking-wide">{title}</Label>
        <p className="mt-1 text-xs text-admin-ink-muted">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function InlineSwitch({
  title,
  checked,
  onCheckedChange,
}: {
  title: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-admin-border bg-admin-surface-2 p-4">
      <Label className="font-display text-sm uppercase tracking-wide">{title}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function ReadonlyWebhookField({ webhookUrl }: { webhookUrl: string }) {
  return (
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
  );
}

function DialogActions({
  saveMutation,
  testMutation,
}: {
  saveMutation: { isPending: boolean };
  testMutation: { mutate: () => void; isPending: boolean };
}) {
  return (
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
  );
}

function cardStatus(enabled: boolean, errorCount: number) {
  if (errorCount > 0) return { label: "Erro", className: "bg-red-100 text-red-800" };
  if (enabled) return { label: "Ativa", className: "bg-emerald-100 text-emerald-800" };
  return { label: "Inativa", className: "bg-slate-200 text-slate-700" };
}

function webhookStatus({
  enabled,
  hasSecret,
  lastEventAt,
  errorCount,
}: {
  enabled: boolean;
  hasSecret: boolean;
  lastEventAt?: string | null;
  errorCount: number;
}) {
  if (errorCount > 0) return "erro";
  if (enabled && hasSecret && lastEventAt) return "funcionando";
  if (hasSecret) return "aguardando evento";
  return "aguardando configuracao";
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
