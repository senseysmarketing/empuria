import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Banknote, CheckCircle2, ChevronDown, Copy, Download, Loader2, Zap } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchWiseEurBankDetails,
  getWiseAdminOverview,
  listWiseProfileBalances,
  saveWiseSettings,
  testWiseConnection,
  testWisePaymentCreation,
  type WiseSetting,
  type WiseWebhookSubscription,
} from "@/lib/wise/wise.functions";

const WEBHOOK_URL_FALLBACK = "https://institutoempuria.net/api/public/webhooks/wise";

const WEBHOOK_CATALOG: Array<{
  key: WiseWebhookSubscription["key"];
  name: string;
  wiseLabel: string;
  required: boolean;
  hint: string;
}> = [
  {
    key: "balances#credit",
    name: "Empuria - Depositos na conta",
    wiseLabel: "Eventos de deposito na conta",
    required: true,
    hint: "Obrigatorio: aprova pagamentos automaticamente quando EUR cai no saldo.",
  },
  {
    key: "transfers#state-change",
    name: "Empuria - Atualizacoes de transferencia",
    wiseLabel: "Atualizacoes sobre transferencias",
    required: false,
    hint: "Recomendado: acompanha mudancas de estado de transferencias.",
  },
  {
    key: "transfers#active-cases",
    name: "Empuria - Problemas com transferencia",
    wiseLabel: "Problemas com as transferencias",
    required: false,
    hint: "Opcional: alertas operacionais quando algo precisa de atencao.",
  },
];

type ProfileOption = { id: string; type: string; name: string | null };
type BalanceOption = { id: string; currency: string; name: string | null };
type BankDetails = {
  iban: string | null;
  bic: string | null;
  beneficiaryName: string | null;
  beneficiaryAddress: string | null;
  bankName: string | null;
  bankAddress: string | null;
};

export function WiseIntegrationCard() {
  const fetchOverview = useServerFn(getWiseAdminOverview);
  const save = useServerFn(saveWiseSettings);
  const testFn = useServerFn(testWiseConnection);
  const balancesFn = useServerFn(listWiseProfileBalances);
  const bankFn = useServerFn(fetchWiseEurBankDetails);
  const testPaymentFn = useServerFn(testWisePaymentCreation);

  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<"webhook_only" | "manual_only" | "webhook_and_manual">(
    "webhook_and_manual",
  );

  // Step 1 - Token
  const [tokenInput, setTokenInput] = useState("");
  const [tokenChanged, setTokenChanged] = useState(false);

  // Step 2 - Profile
  const [profiles, setProfiles] = useState<ProfileOption[] | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileType, setProfileType] = useState<string | null>(null);

  // Step 3 - Balance
  const [balances, setBalances] = useState<BalanceOption[] | null>(null);
  const [balanceId, setBalanceId] = useState<string | null>(null);

  // Step 4 - Bank
  const [beneficiary, setBeneficiary] = useState("");
  const [beneficiaryAddress, setBeneficiaryAddress] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [bankAddress, setBankAddress] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");

  // Step 5 - Webhooks
  const [subs, setSubs] = useState<WiseWebhookSubscription[]>(
    WEBHOOK_CATALOG.map((w) => ({ key: w.key, enabled: w.required })),
  );

  // Advanced
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [publicKey, setPublicKey] = useState("");

  const q = useQuery({
    queryKey: ["wise-admin-overview"],
    queryFn: async () => {
      const data = await fetchOverview();
      const s = data.setting as WiseSetting;
      setEnabled(!!s.is_enabled);
      setMode(
        (s.wise_confirmation_mode as
          | "webhook_only"
          | "manual_only"
          | "webhook_and_manual") ?? "webhook_and_manual",
      );
      setProfileId(s.wise_profile_id ?? null);
      setProfileName(s.wise_profile_name ?? null);
      setProfileType(s.wise_profile_type ?? null);
      setBalanceId(s.wise_balance_id_eur ?? null);
      setBeneficiary(s.wise_beneficiary_name ?? "");
      setBeneficiaryAddress(s.wise_beneficiary_address ?? "");
      setIban(s.wise_iban ?? "");
      setBic(s.wise_bic ?? "");
      setBankAddress(s.wise_bank_address ?? "");
      setFallbackUrl(s.wise_default_payment_url ?? "");
      setPublicKey(s.wise_webhook_public_key ?? "");
      const existing = Array.isArray(s.wise_webhook_subscriptions)
        ? s.wise_webhook_subscriptions
        : [];
      setSubs(
        WEBHOOK_CATALOG.map((w) => {
          const found = existing.find((x) => x.key === w.key);
          return { key: w.key, enabled: found ? !!found.enabled : w.required };
        }),
      );
      return data;
    },
  });

  const setting = q.data?.setting as WiseSetting | undefined;
  const hasToken = !!setting?.wise_api_token || tokenChanged;
  const tokenForApi = tokenChanged ? tokenInput.trim() || undefined : undefined;

  // Reset transient state when dialog opens
  useEffect(() => {
    if (open) {
      setTokenInput("");
      setTokenChanged(false);
      setProfiles(null);
      setBalances(null);
    }
  }, [open]);

  const testMutation = useMutation({
    mutationFn: () => testFn({ data: { token: tokenForApi } }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.message);
        setProfiles([]);
        return;
      }
      toast.success(r.message);
      setProfiles(r.profiles);
      // auto-select if exactly one business profile
      if (r.profiles.length === 1) selectProfile(r.profiles[0]);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao testar Wise"),
  });

  function selectProfile(p: ProfileOption) {
    setProfileId(p.id);
    setProfileName(p.name);
    setProfileType(p.type);
    setBalances(null);
    setBalanceId(null);
  }

  const balancesMutation = useMutation({
    mutationFn: () => {
      if (!profileId) throw new Error("Selecione um profile primeiro.");
      return balancesFn({ data: { profileId, token: tokenForApi } });
    },
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.message);
        setBalances([]);
        return;
      }
      toast.success(r.message);
      setBalances(r.balances);
      const eur = r.balances.find((b) => b.currency === "EUR");
      if (eur) setBalanceId(eur.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao buscar saldos"),
  });

  const bankMutation = useMutation({
    mutationFn: () => {
      if (!profileId) throw new Error("Selecione um profile primeiro.");
      return bankFn({ data: { profileId, token: tokenForApi } });
    },
    onSuccess: (r) => {
      if (!r.ok || !r.details) {
        toast.message(r.message);
        return;
      }
      const d = r.details as BankDetails;
      if (d.beneficiaryName) setBeneficiary(d.beneficiaryName);
      if (d.beneficiaryAddress) setBeneficiaryAddress(d.beneficiaryAddress);
      if (d.iban) setIban(d.iban);
      if (d.bic) setBic(d.bic);
      if (d.bankAddress) setBankAddress(d.bankAddress);
      toast.success("Dados bancarios EUR carregados.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao buscar dados bancarios"),
  });

  const requiredOk = useMemo(
    () => subs.find((s) => s.key === "balances#credit")?.enabled === true,
    [subs],
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          is_enabled: enabled,
          wise_api_token: tokenChanged ? tokenInput.trim() || null : null,
          wise_profile_id: profileId,
          wise_profile_name: profileName,
          wise_profile_type: profileType,
          wise_balance_id_eur: balanceId,
          wise_balance_currency: "EUR",
          wise_beneficiary_name: beneficiary.trim() || null,
          wise_beneficiary_address: beneficiaryAddress.trim() || null,
          wise_iban: iban.trim() || null,
          wise_bic: bic.trim() || null,
          wise_bank_address: bankAddress.trim() || null,
          wise_default_payment_url: fallbackUrl.trim() || null,
          wise_webhook_public_key: publicKey.trim() || null,
          wise_webhook_subscriptions: subs,
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

  const testPaymentMutation = useMutation({
    mutationFn: () => testPaymentFn(),
    onSuccess: (r) => {
      if (r.ok && r.link) {
        toast.success("Link Wise gerado via API! Abrindo em nova aba...");
        window.open(r.link, "_blank", "noopener");
      } else if (r.fallbackUrl) {
        // API doesn't expose Quick Pay creation — open the manually configured
        // Quick Pay link, which is the official Wise flow.
        toast.success("OK · abrindo Quick Pay manual (caminho oficial Wise)");
        window.open(r.fallbackUrl, "_blank", "noopener");
      } else {
        // No fallback configured: tell the user exactly what to do.
        toast.error(
          "Wise nao expoe API publica para gerar link de pagamento. Configure o Link Quick Pay manualmente.",
          { duration: 8000 },
        );
      }
      q.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao testar pagamento"),
  });

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/public/webhooks/wise`
      : WEBHOOK_URL_FALLBACK;

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
            Provedor principal de pagamentos em euro · token Wise + webhook de deposito
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
              <Row label="Token" value={setting?.wise_api_token ? "configurado" : "vazio"} />
              <Row label="Profile" value={setting?.wise_profile_name ?? setting?.wise_profile_id ?? "—"} />
              <Row label="Saldo EUR" value={setting?.wise_balance_id_eur ? "selecionado" : "—"} />
              <Row label="IBAN" value={setting?.wise_iban ? "configurado" : "vazio"} />
              <Row
                label="Webhook"
                value={
                  setting?.wise_last_event_at
                    ? "ativo"
                    : (setting?.wise_webhook_subscriptions ?? []).some(
                          (w) => w.key === "balances#credit" && w.enabled,
                        )
                      ? "aguardando evento"
                      : "nao configurado"
                }
              />
              <Row
                label="Link Quick Pay"
                value={setting?.wise_default_payment_url ? "configurado" : "nao configurado"}
              />
            </>
          )}
          {!setting?.wise_default_payment_url && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Cole abaixo o seu <span className="font-semibold">Link Quick Pay reutilizavel</span>{" "}
                (Wise → Solicitar pagamento → copie o link aberto). O Empuria adiciona valor, moeda
                e referencia EMP-XXXX automaticamente em cada pedido.
              </span>
            </div>
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
            disabled={testPaymentMutation.isPending || !setting?.wise_api_token || !setting?.wise_profile_id}
            onClick={() => testPaymentMutation.mutate()}
          >
            {testPaymentMutation.isPending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="mr-2 h-3.5 w-3.5" />
            )}
            Testar criacao de pagamento
          </Button>
        </div>
      </BentoCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-admin-border bg-admin-surface text-admin-ink sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Configurar Wise (EUR)</DialogTitle>
            <DialogDescription className="text-admin-ink-muted">
              Cole o API Token e siga os passos. O Empuria descobre o resto via API da Wise.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Ativar */}
            <div className="flex items-center justify-between rounded-lg border border-admin-border bg-admin-surface-muted/30 p-4">
              <div>
                <div className="font-display text-sm font-semibold">Ativar Wise</div>
                <div className="text-xs text-admin-ink-muted">
                  Pedidos em EUR usarao Wise como provedor principal de pagamento.
                </div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {/* Step 1 - Token */}
            <Step
              n={1}
              title="API Token"
              done={hasToken && (profiles?.length ?? 0) > 0}
              desc="Gere em wise.com → Settings → API tokens (use o token live)."
            >
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder={
                    setting?.wise_api_token
                      ? "Preenchido · digite novo apenas se quiser substituir"
                      : "Cole aqui o API Token da Wise Business"
                  }
                  value={tokenInput}
                  onChange={(e) => {
                    setTokenInput(e.target.value);
                    setTokenChanged(true);
                  }}
                />
                <Button
                  type="button"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || (!hasToken && !tokenInput.trim())}
                >
                  {testMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Conectar e testar"
                  )}
                </Button>
              </div>
            </Step>

            {/* Step 2 - Profile */}
            <Step
              n={2}
              title="Profile Wise"
              done={!!profileId}
              desc="Escolha o profile Business (Empuria Hub)."
            >
              {profiles === null ? (
                <p className="text-xs text-admin-ink-muted">
                  {profileId
                    ? `Atual: ${profileName ?? profileId} (${profileType ?? "?"})`
                    : "Clique em Conectar e testar acima."}
                </p>
              ) : profiles.length === 0 ? (
                <p className="text-xs text-amber-600">Nenhum profile retornado pela Wise.</p>
              ) : (
                <div className="space-y-2">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectProfile(p)}
                      className={`flex w-full items-center justify-between rounded-md border p-2 text-left text-sm transition ${
                        profileId === p.id
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-admin-border hover:bg-admin-surface-muted/30"
                      }`}
                    >
                      <span>
                        <span className="font-medium">{p.name ?? "(sem nome)"}</span>
                        <span className="ml-2 text-xs text-admin-ink-muted">{p.type}</span>
                      </span>
                      <span className="font-mono text-[11px] text-admin-ink-muted">{p.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </Step>

            {/* Step 3 - Balance */}
            <Step
              n={3}
              title="Saldo EUR"
              done={!!balanceId}
              desc="Selecione o saldo em EUR do profile."
            >
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!profileId || balancesMutation.isPending}
                  onClick={() => balancesMutation.mutate()}
                >
                  {balancesMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Buscar saldos"
                  )}
                </Button>
                {balances === null ? (
                  <p className="text-xs text-admin-ink-muted">
                    {balanceId
                      ? `Atual: balance ${balanceId} (EUR)`
                      : "Aguardando consulta."}
                  </p>
                ) : balances.length === 0 ? (
                  <p className="text-xs text-amber-600">Nenhum saldo retornado.</p>
                ) : (
                  <div className="space-y-2">
                    {balances.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setBalanceId(b.id)}
                        className={`flex w-full items-center justify-between rounded-md border p-2 text-left text-sm transition ${
                          balanceId === b.id
                            ? "border-emerald-500 bg-emerald-50"
                            : "border-admin-border hover:bg-admin-surface-muted/30"
                        }`}
                      >
                        <span className="font-medium">{b.currency}</span>
                        <span className="font-mono text-[11px] text-admin-ink-muted">{b.id}</span>
                      </button>
                    ))}
                    {!balances.find((b) => b.currency === "EUR") && (
                      <p className="text-xs text-amber-600">
                        Saldo EUR nao encontrado. Abra um saldo EUR na Wise antes de concluir.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </Step>

            {/* Step 4 - Bank details */}
            <Step
              n={4}
              title="Dados bancarios EUR"
              done={!!(beneficiary && iban && bic)}
              desc="Usado em /pagar/:token como fallback de transferencia."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="sm:col-span-2"
                  disabled={!profileId || bankMutation.isPending}
                  onClick={() => bankMutation.mutate()}
                >
                  {bankMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Buscar IBAN/BIC EUR da Wise
                    </>
                  )}
                </Button>
                <Field label="Beneficiario">
                  <Input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} />
                </Field>
                <Field label="IBAN">
                  <Input value={iban} onChange={(e) => setIban(e.target.value)} />
                </Field>
                <Field label="BIC / SWIFT">
                  <Input value={bic} onChange={(e) => setBic(e.target.value)} />
                </Field>
                <Field label="Endereco do banco">
                  <Input value={bankAddress} onChange={(e) => setBankAddress(e.target.value)} />
                </Field>
                <Field label="Endereco do beneficiario (opcional)">
                  <Input
                    value={beneficiaryAddress}
                    onChange={(e) => setBeneficiaryAddress(e.target.value)}
                  />
                </Field>
                <Field label="Link Quick Pay (recomendado · principal)">
                  <Input
                    type="url"
                    placeholder="https://wise.com/pay/me/..."
                    value={fallbackUrl}
                    onChange={(e) => setFallbackUrl(e.target.value)}
                  />
                  <p className="text-[11px] leading-snug text-admin-ink-muted">
                    Wise → Solicitar pagamento → Criar link reutilizavel em EUR. Cole o
                    {" "}<span className="font-mono">https://wise.com/pay/me/...</span> aqui.
                    Esse e o caminho oficial — a API publica da Wise nao expoe geracao de link.
                  </p>
                </Field>
              </div>
            </Step>

            {/* Step 5 - Webhooks */}
            <Step n={5} title="Webhooks na Wise" done={requiredOk} desc="Crie cada webhook em Wise → Developer Tools → Webhooks com a mesma URL abaixo.">
              <div className="space-y-3">
                <div>
                  <Label className="font-display text-[11px] uppercase tracking-wider">
                    URL canonica do webhook
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

                <div className="space-y-2">
                  {WEBHOOK_CATALOG.map((w) => {
                    const checked = subs.find((s) => s.key === w.key)?.enabled ?? false;
                    return (
                      <label
                        key={w.key}
                        className="flex items-start gap-3 rounded-md border border-admin-border p-3"
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={checked}
                          onCheckedChange={(v) =>
                            setSubs((prev) =>
                              prev.map((s) =>
                                s.key === w.key ? { ...s, enabled: !!v } : s,
                              ),
                            )
                          }
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{w.name}</span>
                            {w.required ? (
                              <Badge className="bg-red-100 text-red-700">obrigatorio</Badge>
                            ) : (
                              <Badge variant="outline">opcional</Badge>
                            )}
                          </div>
                          <div className="text-xs text-admin-ink-muted">
                            Na Wise selecione: <span className="font-medium">{w.wiseLabel}</span>
                          </div>
                          <div className="mt-1 text-xs text-admin-ink-muted">{w.hint}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {!requiredOk && (
                  <p className="text-xs text-amber-600">
                    O webhook de depositos na conta e obrigatorio para conciliacao automatica.
                  </p>
                )}
              </div>
            </Step>

            {/* Confirmacao */}
            <div>
              <Label className="font-display text-[11px] uppercase tracking-wider">
                Modo de confirmacao
              </Label>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webhook_and_manual">Webhook + conciliacao manual</SelectItem>
                  <SelectItem value="webhook_only">Apenas webhook</SelectItem>
                  <SelectItem value="manual_only">Apenas manual (sem API)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Avancado */}
            <div className="rounded-lg border border-dashed border-admin-border p-3">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between text-sm font-medium text-admin-ink"
              >
                <span>Avancado · validacao criptografica (opcional)</span>
                <ChevronDown
                  className={`h-4 w-4 transition ${showAdvanced ? "rotate-180" : ""}`}
                />
              </button>
              {showAdvanced && (
                <div className="mt-3 space-y-2">
                  <Label className="font-display text-[11px] uppercase tracking-wider">
                    Chave publica RSA do webhook (PEM)
                  </Label>
                  <Textarea
                    rows={5}
                    placeholder="-----BEGIN PUBLIC KEY-----..."
                    value={publicKey}
                    onChange={(e) => setPublicKey(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-admin-ink-muted">
                    Opcional. Sem chave os eventos sao aceitos mas marcados como sem assinatura
                    validada. A Wise nao expoe essa chave na UI visual de webhooks; use apenas se
                    sua conta tiver a chave publicada em Developer Tools.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Salvar configuracao"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Step({
  n,
  title,
  desc,
  done,
  children,
}: {
  n: number;
  title: string;
  desc: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-admin-border bg-admin-surface-muted/20 p-4">
      <div className="mb-3 flex items-start gap-3">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            done ? "bg-emerald-500 text-white" : "bg-admin-bg text-admin-ink"
          }`}
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : n}
        </div>
        <div>
          <div className="font-display text-sm font-semibold">{title}</div>
          <div className="text-xs text-admin-ink-muted">{desc}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-admin-ink-muted">{label}</span>
      <span className="max-w-[180px] truncate text-right font-medium text-admin-ink">{value}</span>
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
