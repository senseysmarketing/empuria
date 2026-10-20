import { useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CalendarDays,
  Copy,
  CreditCard,
  Loader2,
  MessageCircle,
  QrCode,
  RotateCw,
  Unplug,
} from "lucide-react";
import {
  getMercadoPagoAdminOverview,
  saveMercadoPagoSettings,
  testMercadoPagoConfiguration,
} from "@/lib/mercadopago/mercadopago.functions";
import {
  disconnectUazapiInstance,
  generateUazapiQrCode,
  getUazapiAdminOverview,
  refreshUazapiStatus,
} from "@/lib/uazapi/uazapi.functions";

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
  test_public_key: string | null;
  test_access_token: string | null;
  test_webhook_secret: string | null;
  prod_public_key: string | null;
  prod_access_token: string | null;
  prod_webhook_secret: string | null;
  default_currency: "BRL" | "EUR" | "USD";
  statement_descriptor: string;
  pix_enabled: boolean;
  boleto_enabled: boolean;
  card_enabled: boolean;
  pix_expiration_minutes: number;
  boleto_expiration_days: number;
  last_event_at: string | null;
};

type UazapiSetting = {
  is_enabled: boolean;
  has_instance: boolean;
  has_webhook: boolean;
  last_event_at: string | null;
  uazapi_connection_status: "disconnected" | "connecting" | "connected" | "hibernated" | "error";
  uazapi_profile_name: string | null;
  uazapi_phone: string | null;
  uazapi_webhook_configured_at: string | null;
  uazapi_last_qr_at: string | null;
};

const PLANNED_INTEGRATIONS = [
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
  const fetchMpOverview = useServerFn(getMercadoPagoAdminOverview);
  const saveMp = useServerFn(saveMercadoPagoSettings);
  const testMp = useServerFn(testMercadoPagoConfiguration);
  const fetchUazapiOverview = useServerFn(getUazapiAdminOverview);
  const generateQr = useServerFn(generateUazapiQrCode);
  const refreshWaStatus = useServerFn(refreshUazapiStatus);
  const disconnectWa = useServerFn(disconnectUazapiInstance);

  const [mpEnabled, setMpEnabled] = useState(false);
  const [mpConfigOpen, setMpConfigOpen] = useState(false);
  const [mpEventsOpen, setMpEventsOpen] = useState(false);
  const [mpEnvironment, setMpEnvironment] = useState<"test" | "production">("test");
  const [mpPixEnabled, setMpPixEnabled] = useState(true);
  const [mpBoletoEnabled, setMpBoletoEnabled] = useState(true);
  const [mpCardEnabled, setMpCardEnabled] = useState(false);
  const [waConfigOpen, setWaConfigOpen] = useState(false);
  const [waEventsOpen, setWaEventsOpen] = useState(false);
  const [waQrCode, setWaQrCode] = useState<string | null>(null);
  const [waPairCode, setWaPairCode] = useState<string | null>(null);
  const [waActionError, setWaActionError] = useState<string | null>(null);
  const [profileRetry, setProfileRetry] = useState(0);

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

  const waQ = useQuery({
    queryKey: ["uazapi-admin-overview"],
    queryFn: () => fetchUazapiOverview(),
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const mpWebhookUrl = useMemo(
    () => `${origin}${mpQ.data?.webhookUrl ?? "/api/webhooks/mercadopago"}`,
    [origin, mpQ.data?.webhookUrl],
  );

  const saveMpMutation = useMutation({
    mutationFn: (form: FormData) =>
      saveMp({
        data: {
          is_enabled: mpEnabled,
          environment: mpEnvironment,
          test_public_key: emptyToNull(form.get("test_public_key")),
          test_access_token: emptyToNull(form.get("test_access_token")),
          test_webhook_secret: emptyToNull(form.get("test_webhook_secret")),
          prod_public_key: emptyToNull(form.get("prod_public_key")),
          prod_access_token: emptyToNull(form.get("prod_access_token")),
          prod_webhook_secret: emptyToNull(form.get("prod_webhook_secret")),
          default_currency: "BRL",
          statement_descriptor:
            String(form.get("statement_descriptor") ?? "")
              .trim()
              .toUpperCase() || "EMPURIA",
          pix_enabled: mpPixEnabled,
          boleto_enabled: mpBoletoEnabled,
          card_enabled: mpCardEnabled,
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

  const generateQrMutation = useMutation({
    mutationFn: () => generateQr(),
    onSuccess: (result) => {
      setWaActionError(null);
      setWaQrCode(result.qrcode ?? null);
      setWaPairCode(result.paircode ?? null);
      toast.success(result.message);
      waQ.refetch();
    },
    onError: (e) => setWaActionError(e instanceof Error ? e.message : "Erro ao gerar QR Code"),
  });

  const refreshWaMutation = useMutation({
    mutationFn: () => refreshWaStatus(),
    onSuccess: (result) => {
      setWaActionError(null);
      setWaQrCode((current) =>
        result.status === "connecting" ? (result.qrcode ?? current) : null,
      );
      setWaPairCode((current) =>
        result.status === "connecting" ? (result.paircode ?? current) : null,
      );
      toast.success(
        result.status === "connected" ? "WhatsApp conectado" : "Status do WhatsApp atualizado",
      );
      waQ.refetch();
    },
    onError: (e) => setWaActionError(e instanceof Error ? e.message : "Erro ao atualizar status"),
  });

  const disconnectWaMutation = useMutation({
    mutationFn: () => disconnectWa(),
    onSuccess: () => {
      setWaActionError(null);
      setWaQrCode(null);
      setWaPairCode(null);
      toast.success("WhatsApp desconectado");
      waQ.refetch();
    },
    onError: (e) =>
      setWaActionError(e instanceof Error ? e.message : "Erro ao desconectar WhatsApp"),
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

  const waSetting = waQ.data?.setting as UazapiSetting | undefined;
  const waEvents = (waQ.data?.events ?? []) as IntegrationEvent[];
  const waErrorCount = waQ.data?.errorCount ?? 0;
  const waStatus = cardStatus(Boolean(waSetting?.is_enabled), waErrorCount);
  const waConnection = connectionStatus(waSetting?.uazapi_connection_status);
  const waWebhook = webhookStatus({
    enabled: Boolean(waSetting?.is_enabled),
    hasSecret: Boolean(waSetting?.has_webhook),
    lastEventAt: waSetting?.last_event_at,
    errorCount: waErrorCount,
  });
  const refetchWa = waQ.refetch;

  useEffect(() => {
    if (!waConfigOpen || waSetting?.uazapi_connection_status !== "connecting") return;
    const timer = window.setInterval(() => {
      refreshWaStatus()
        .then((result) => {
          setWaQrCode((current) =>
            result.status === "connecting" ? (result.qrcode ?? current) : null,
          );
          setWaPairCode((current) =>
            result.status === "connecting" ? (result.paircode ?? current) : null,
          );
          void refetchWa();
        })
        .catch(() => undefined);
    }, 12000);
    return () => window.clearInterval(timer);
  }, [waConfigOpen, waSetting?.uazapi_connection_status, refreshWaStatus, refetchWa]);

  useEffect(() => {
    if (!waConfigOpen) {
      setProfileRetry(0);
      return;
    }
    if (
      waSetting?.uazapi_connection_status !== "connected" ||
      (waSetting.uazapi_profile_name && waSetting.uazapi_phone) ||
      profileRetry >= 4
    )
      return;
    const timer = window.setTimeout(() => {
      void refreshWaStatus()
        .then(() => refetchWa())
        .catch(() => undefined)
        .finally(() => setProfileRetry((count) => count + 1));
    }, [3000, 6000, 12000, 24000][profileRetry]);
    return () => window.clearTimeout(timer);
  }, [
    waConfigOpen,
    waSetting?.uazapi_connection_status,
    waSetting?.uazapi_profile_name,
    waSetting?.uazapi_phone,
    profileRetry,
    refreshWaStatus,
    refetchWa,
  ]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">

        <IntegrationCard
          icon={CreditCard}
          iconClassName="text-sky-600"
          name="Mercado Pago"
          description="Pix, boleto e cartao (BRL) · legado, mantido para pedidos antigos"
          badge={<Badge variant="outline" className="border-amber-400 text-amber-700">Legado · secundario</Badge>}
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

        <IntegrationCard
          icon={MessageCircle}
          iconClassName="text-emerald-600"
          name="WhatsApp / Uazapi"
          description="Inbox, CRM e follow-ups comerciais"
          badge={<Badge className={waStatus.className}>{waStatus.label}</Badge>}
          details={[
            ["Status", waStatus.label],
            ["Instancia", waSetting?.has_instance ? "configurada" : "nao configurada"],
            ["Conexao", waConnection],
            ["Ultimo evento", formatRelativeDate(waSetting?.last_event_at)],
          ]}
          actions={
            <>
              <Button type="button" size="sm" onClick={() => setWaConfigOpen(true)}>
                Conexao WhatsApp
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setWaEventsOpen(true)}
              >
                Ver eventos
              </Button>
            </>
          }
          loading={waQ.isLoading}
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

      <UazapiConfigDialog
        open={waConfigOpen}
        onOpenChange={(open) => {
          setWaConfigOpen(open);
          if (!open) {
            setWaQrCode(null);
            setWaPairCode(null);
            setWaActionError(null);
          }
        }}
        setting={waSetting}
        qrCode={waQrCode}
        pairCode={waPairCode}
        error={waActionError}
        generateQrMutation={generateQrMutation}
        refreshMutation={refreshWaMutation}
        disconnectMutation={disconnectWaMutation}
        webhookStatus={waWebhook}
      />

      <EventsDialog
        open={waEventsOpen}
        onOpenChange={setWaEventsOpen}
        title="Eventos WhatsApp / Uazapi"
        description="Mensagens, conexao da instancia e erros de webhook."
        events={waEvents}
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
          <div className="lg:col-span-2 rounded-lg border border-admin-border bg-admin-surface-muted/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-display text-sm font-semibold text-admin-ink">
                Credenciais de Teste (Sandbox)
              </h4>
              {environment === "test" ? (
                <Badge className="bg-amber-100 text-amber-800">Ambiente ativo</Badge>
              ) : null}
            </div>
            <p className="mb-3 text-xs text-admin-ink-muted">
              Copie do painel Mercado Pago em <strong>Suas integracoes &rarr; sua aplicacao &rarr; Credenciais de teste</strong>.
              Em contas de produtor, a Public Key e o Access Token de teste tambem comecam com <code>APP_USR-</code> -
              isso e normal, o que importa e copiar da aba "Credenciais de teste".
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Public Key (teste)">
                <Input
                  name="test_public_key"
                  placeholder="APP_USR-... (teste)"
                  defaultValue={setting?.test_public_key ?? ""}
                />
              </Field>
              <Field label="Access Token (teste)">
                <Input
                  name="test_access_token"
                  type="password"
                  placeholder={
                    setting?.test_access_token
                      ? "Preenchido - deixe em branco para manter"
                      : "APP_USR-... (teste)"
                  }
                />
              </Field>
              <Field label="Segredo do webhook (teste)">
                <Input
                  name="test_webhook_secret"
                  type="password"
                  placeholder={
                    setting?.test_webhook_secret
                      ? "Preenchido - deixe em branco para manter"
                      : "Secret signature"
                  }
                />
              </Field>
            </div>
          </div>

          <div className="lg:col-span-2 rounded-lg border border-admin-border bg-admin-surface-muted/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-display text-sm font-semibold text-admin-ink">
                Credenciais de Producao
              </h4>
              {environment === "production" ? (
                <Badge className="bg-emerald-100 text-emerald-800">Ambiente ativo</Badge>
              ) : null}
            </div>
            <p className="mb-3 text-xs text-admin-ink-muted">
              Copie do painel Mercado Pago em <strong>Credenciais de producao</strong>. Use apenas
              depois de validar o fluxo no ambiente de teste.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Public Key (producao)">
                <Input
                  name="prod_public_key"
                  placeholder="APP_USR-... (producao)"
                  defaultValue={setting?.prod_public_key ?? ""}
                />
              </Field>
              <Field label="Access Token (producao)">
                <Input
                  name="prod_access_token"
                  type="password"
                  placeholder={
                    setting?.prod_access_token
                      ? "Preenchido - deixe em branco para manter"
                      : "APP_USR-... (producao)"
                  }
                />
              </Field>
              <Field label="Segredo do webhook (producao)">
                <Input
                  name="prod_webhook_secret"
                  type="password"
                  placeholder={
                    setting?.prod_webhook_secret
                      ? "Preenchido - deixe em branco para manter"
                      : "Secret signature"
                  }
                />
              </Field>
            </div>
          </div>

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
          <Field label="Expiracao Pix">
            <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
              PIX válido por 30 minutos
            </div>
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

function UazapiConfigDialog({
  open,
  onOpenChange,
  setting,
  qrCode,
  pairCode,
  error,
  generateQrMutation,
  refreshMutation,
  disconnectMutation,
  webhookStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setting: UazapiSetting | undefined;
  qrCode: string | null;
  pairCode: string | null;
  error: string | null;
  generateQrMutation: { mutate: () => void; isPending: boolean };
  refreshMutation: { mutate: () => void; isPending: boolean };
  disconnectMutation: { mutateAsync: () => Promise<unknown>; isPending: boolean };
  webhookStatus: string;
}) {
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const qrExpired = Boolean(
    setting?.uazapi_last_qr_at &&
    Date.now() - new Date(setting.uazapi_last_qr_at).getTime() > 120000,
  );
  const qrSrc = qrCode && !qrExpired ? qrImageSrc(qrCode) : null;
  const connected = setting?.uazapi_connection_status === "connected";
  const connecting = setting?.uazapi_connection_status === "connecting";
  const busy =
    generateQrMutation.isPending || refreshMutation.isPending || disconnectMutation.isPending;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) onOpenChange(next);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto border-admin-border bg-admin-surface text-admin-ink sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Conexao WhatsApp</DialogTitle>
            <DialogDescription className="text-admin-ink-muted">
              Escaneie o QR Code para conectar o numero. O modo de operacao permanece em
              sugestao/manual.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <StatusTile
              label="Conexao"
              value={connectionStatus(setting?.uazapi_connection_status)}
            />
            <StatusTile label="Webhook" value={webhookStatus} />
            <StatusTile label="Perfil" value={setting?.uazapi_profile_name ?? "Aguardando"} />
            <StatusTile label="Telefone" value={setting?.uazapi_phone ?? "Aguardando"} />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </p>
          )}

          <div className="rounded-xl border border-admin-border bg-admin-surface-2 p-4 text-center">
            <div className="space-y-3">
              <div>
                <Label className="font-display text-sm uppercase tracking-wide">
                  Conexao por QR Code
                </Label>
                <p className="mt-1 text-xs text-admin-ink-muted">
                  {connected
                    ? "Numero conectado. Use Atualizar para conferir o estado real."
                    : "Gere o QR Code e leia no WhatsApp. A conexao so sera confirmada pela Uazapi."}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {!connected && (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => generateQrMutation.mutate()}
                    disabled={busy}
                  >
                    {generateQrMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <QrCode className="h-4 w-4" />
                    )}
                    Gerar QR Code
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => refreshMutation.mutate()}
                  disabled={busy}
                >
                  {refreshMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCw className="h-4 w-4" />
                  )}
                  Atualizar
                </Button>
                {setting?.has_instance && setting.uazapi_connection_status !== "disconnected" && (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => setConfirmDisconnectOpen(true)}
                    disabled={busy}
                  >
                    {disconnectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Unplug className="h-4 w-4" />
                    )}
                    Desconectar
                  </Button>
                )}
              </div>
            </div>

            {(connecting || (pairCode && !connected)) && (
              <div className="mt-5 flex flex-col items-center gap-3">
                <div className="flex h-[min(72vw,280px)] w-[min(72vw,280px)] items-center justify-center rounded-xl border border-admin-border bg-white p-3">
                  {qrSrc ? (
                    <img
                      src={qrSrc}
                      alt="QR Code de conexao Uazapi"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-center text-xs text-admin-ink-muted">
                      {qrExpired ? "QR Code expirado. Gere outro." : "Aguardando QR Code"}
                    </span>
                  )}
                </div>
                <div className="min-w-0 space-y-2 text-sm text-admin-ink-muted">
                  <p>
                    Status atual:{" "}
                    <span className="font-medium text-admin-ink">
                      {connectionStatus(setting?.uazapi_connection_status)}
                    </span>
                  </p>
                  <p>
                    Ultimo QR:{" "}
                    <span className="font-medium text-admin-ink">
                      {formatRelativeDate(setting?.uazapi_last_qr_at)}
                    </span>
                  </p>
                  {pairCode && (
                    <p>
                      Codigo de pareamento:{" "}
                      <span className="font-mono text-admin-ink">{pairCode}</span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmDisconnectOpen}
        onOpenChange={(next) => {
          if (!disconnectMutation.isPending) setConfirmDisconnectOpen(next);
        }}
      >
        <AlertDialogContent className="border-admin-border bg-admin-surface text-admin-ink">
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              A instancia sera desconectada, mas a configuracao sera preservada para reconectar
              depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnectMutation.isPending}
              onClick={async (event) => {
                event.preventDefault();
                if (disconnectMutation.isPending) return;
                try {
                  await disconnectMutation.mutateAsync();
                  setConfirmDisconnectOpen(false);
                } catch {
                  // Keep confirmation open; the parent displays the server error.
                }
              }}
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-surface p-3">
      <div className="text-xs uppercase tracking-wide text-admin-ink-muted">{label}</div>
      <div className="mt-1 truncate font-medium text-admin-ink">{value}</div>
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

function qrImageSrc(value: string) {
  if (value.startsWith("data:") || value.startsWith("http")) return value;
  if (value.trim().startsWith("<svg")) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(value)}`;
  }
  return `data:image/png;base64,${value}`;
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

function connectionStatus(value: UazapiSetting["uazapi_connection_status"] | undefined) {
  if (value === "connected") return "conectado";
  if (value === "connecting") return "conectando";
  if (value === "hibernated") return "sessao em pausa";
  if (value === "error") return "erro";
  return "desconectado";
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
