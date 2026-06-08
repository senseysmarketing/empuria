import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Banknote, Copy, Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getWiseAdminOverview,
  saveWiseSettings,
  testWiseConnection,
  type WiseSetting,
} from "@/lib/wise/wise.functions";

function empty(value: FormDataEntryValue | null) {
  const t = String(value ?? "").trim();
  return t ? t : null;
}

export function WiseIntegrationCard() {
  const fetchOverview = useServerFn(getWiseAdminOverview);
  const save = useServerFn(saveWiseSettings);
  const test = useServerFn(testWiseConnection);

  const [enabled, setEnabled] = useState(false);
  const [environment, setEnvironment] = useState<"sandbox" | "live">("sandbox");
  const [mode, setMode] = useState<"webhook_only" | "manual_only" | "webhook_and_manual">(
    "webhook_and_manual",
  );
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ["wise-admin-overview"],
    queryFn: async () => {
      const data = await fetchOverview();
      setEnabled(!!data.setting.is_enabled);
      setEnvironment((data.setting.wise_environment as "sandbox" | "live") ?? "sandbox");
      setMode(
        (data.setting.wise_confirmation_mode as
          | "webhook_only"
          | "manual_only"
          | "webhook_and_manual") ?? "webhook_and_manual",
      );
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: (form: FormData) =>
      save({
        data: {
          is_enabled: enabled,
          wise_environment: environment,
          wise_api_token: empty(form.get("wise_api_token")),
          wise_profile_id: empty(form.get("wise_profile_id")),
          wise_balance_id_eur: empty(form.get("wise_balance_id_eur")),
          wise_beneficiary_name: empty(form.get("wise_beneficiary_name")),
          wise_iban: empty(form.get("wise_iban")),
          wise_bic: empty(form.get("wise_bic")),
          wise_default_payment_url: empty(form.get("wise_default_payment_url")),
          wise_webhook_public_key: empty(form.get("wise_webhook_public_key")),
          wise_confirmation_mode: mode,
        },
      }),
    onSuccess: () => {
      toast.success("Wise salvo");
      setOpen(false);
      q.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar Wise"),
  });

  const testMutation = useMutation({
    mutationFn: () => test(),
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao testar Wise"),
  });

  const setting = q.data?.setting as WiseSetting | undefined;
  const webhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/public/webhooks/wise` : "";

  return (
    <>
      <BentoCard className="flex min-h-[280px] flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-admin-border bg-admin-bg">
            <Banknote className="h-5 w-5 text-violet-600" />
          </div>
          {enabled ? (
            <Badge className="bg-emerald-100 text-emerald-800">Ativo · EUR</Badge>
          ) : (
            <Badge variant="outline">Inativo</Badge>
          )}
        </div>
        <div className="mt-4">
          <h3 className="font-display text-xl font-bold text-admin-ink">Wise (EUR)</h3>
          <p className="mt-1 min-h-10 text-sm leading-relaxed text-admin-ink-muted">
            Provedor principal de pagamentos em euro · links Wise + IBAN
          </p>
        </div>
        <div className="mt-5 space-y-2 text-sm">
          {q.isLoading ? (
            <div className="flex items-center gap-2 text-admin-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </div>
          ) : (
            <>
              <Row label="Ambiente" value={setting?.wise_environment ?? "sandbox"} />
              <Row label="Token" value={setting?.wise_api_token ? "configurado" : "vazio"} />
              <Row label="Profile" value={setting?.wise_profile_id ?? "—"} />
              <Row label="IBAN" value={setting?.wise_iban ? "configurado" : "vazio"} />
              <Row
                label="Webhook"
                value={
                  setting?.wise_webhook_public_key
                    ? setting?.wise_last_event_at
                      ? "ativo"
                      : "aguardando"
                    : "sem chave"
                }
              />
            </>
          )}
        </div>
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            Configurar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Testar"}
          </Button>
        </div>
      </BentoCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-admin-border bg-admin-surface text-admin-ink sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Configurar Wise (EUR)</DialogTitle>
            <DialogDescription className="text-admin-ink-muted">
              Provedor principal de pagamentos em euro do Instituto Empuria.
            </DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-4 lg:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveMutation.mutate(new FormData(e.currentTarget));
            }}
          >
            <div className="lg:col-span-2 flex items-center justify-between rounded-lg border border-admin-border bg-admin-surface-muted/30 p-4">
              <div>
                <div className="font-display text-sm font-semibold">Ativar Wise</div>
                <div className="text-xs text-admin-ink-muted">
                  Pedidos em EUR usarao Wise como provedor principal de pagamento.
                </div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <Field label="Ambiente">
              <Select
                value={environment}
                onValueChange={(v) => setEnvironment(v as "sandbox" | "live")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Sandbox (teste)</SelectItem>
                  <SelectItem value="live">Producao</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Modo de confirmacao">
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webhook_and_manual">
                    Webhook + conciliacao manual
                  </SelectItem>
                  <SelectItem value="webhook_only">Apenas webhook</SelectItem>
                  <SelectItem value="manual_only">Apenas manual (sem API)</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="API Token Wise">
              <Input
                name="wise_api_token"
                type="password"
                placeholder={
                  setting?.wise_api_token
                    ? "Preenchido · deixe em branco para manter"
                    : "Token gerado em wise.com → Settings → API tokens"
                }
              />
            </Field>
            <Field label="Profile ID">
              <Input
                name="wise_profile_id"
                placeholder="ex: 12345678"
                defaultValue={setting?.wise_profile_id ?? ""}
              />
            </Field>
            <Field label="Balance ID (EUR)">
              <Input
                name="wise_balance_id_eur"
                placeholder="opcional"
                defaultValue={setting?.wise_balance_id_eur ?? ""}
              />
            </Field>
            <Field label="Beneficiario (titular da conta)">
              <Input
                name="wise_beneficiary_name"
                placeholder="Instituto Empuria"
                defaultValue={setting?.wise_beneficiary_name ?? ""}
              />
            </Field>
            <Field label="IBAN">
              <Input
                name="wise_iban"
                placeholder="ES00 0000 0000 0000 0000 0000"
                defaultValue={setting?.wise_iban ?? ""}
              />
            </Field>
            <Field label="BIC / SWIFT">
              <Input
                name="wise_bic"
                placeholder="TRWIBEB1XXX"
                defaultValue={setting?.wise_bic ?? ""}
              />
            </Field>
            <Field label="Link Wise fallback (opcional)">
              <Input
                name="wise_default_payment_url"
                type="url"
                placeholder="https://wise.com/pay/me/..."
                defaultValue={setting?.wise_default_payment_url ?? ""}
              />
            </Field>

            <div className="lg:col-span-2">
              <Label className="font-display text-[11px] uppercase tracking-wider">
                Webhook URL (registre em Wise → Settings → Webhooks)
              </Label>
              <div className="mt-1 flex gap-2">
                <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl);
                    toast.success("URL copiada");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="lg:col-span-2">
              <Field label="Chave publica RSA do webhook (PEM)">
                <Textarea
                  name="wise_webhook_public_key"
                  rows={5}
                  placeholder="-----BEGIN PUBLIC KEY-----..."
                  defaultValue={setting?.wise_webhook_public_key ?? ""}
                  className="font-mono text-xs"
                />
              </Field>
              <p className="mt-1 text-xs text-admin-ink-muted">
                Disponivel em Wise → Settings → Webhooks. Sem essa chave o webhook ainda eh
                aceito porem marcado como sem assinatura valida.
              </p>
            </div>

            <div className="lg:col-span-2 mt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={testMutation.isPending}
                onClick={() => testMutation.mutate()}
              >
                {testMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Testar conexao"
                )}
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Salvar"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-admin-ink-muted">{label}</span>
      <span className="max-w-[160px] truncate text-right font-medium text-admin-ink">
        {value}
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="font-display text-[11px] uppercase tracking-wider">{label}</Label>
      {children}
    </div>
  );
}
