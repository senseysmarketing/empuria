import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  BellOff,
  Bot,
  CalendarClock,
  Copy,
  Eye,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Timer,
  Workflow,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  cancelCrmAutomationPendingAction,
  duplicateCrmAutomationFlow,
  listCrmAutomationWorkspace,
  saveCrmAutomationFlow,
  updateCrmAutomationFlowStatus,
} from "@/lib/admin/crm-automations.functions";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/admin/automacoes")({
  component: AutomacoesCrmPage,
});

type Step = {
  id?: string;
  position: number;
  step_type: "send_whatsapp" | "delay" | "condition" | "action" | "end";
  title: string;
  config: Record<string, unknown>;
};

type Flow = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  trigger_type: "lead_created" | "pipeline_stage_entered" | "inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  stop_rules: Record<string, unknown>;
  schedule_window: Record<string, unknown>;
  metrics: Record<string, unknown>;
  steps: Step[];
  activeExecutions: number;
  updated_at: string;
};

type PendingActionView = {
  id: string;
  run_at: string;
  leads?: { full_name?: string | null; phone?: string | null } | null;
  crm_automation_flows?: { name?: string | null } | null;
  crm_automation_steps?: { title?: string | null; step_type?: string | null } | null;
};

type AutomationLogView = {
  id: string;
  event_type: string;
  message?: string | null;
  created_at: string;
  leads?: { full_name?: string | null } | null;
  crm_automation_flows?: { name?: string | null } | null;
  crm_automation_steps?: { title?: string | null } | null;
};

type Workspace = {
  flows: Flow[];
  pendingActions: PendingActionView[];
  logs: AutomationLogView[];
  metrics: {
    activeFlows: number;
    nextSends: number;
    messagesSentToday: number;
    repliesToday: number;
    errorsToday: number;
    stoppedByReply: number;
  };
  permissions: {
    canManage: boolean;
    canPause: boolean;
    canCancelPending: boolean;
  };
};

const defaultSteps: Step[] = [
  {
    position: 1,
    step_type: "send_whatsapp",
    title: "Mensagem inicial",
    config: {
      message:
        "Oi, {{primeiro_nome}}, tudo bem? Aqui e do Instituto Empuria. Vi seu interesse e queria entender melhor em que etapa voce esta.",
    },
  },
  { position: 2, step_type: "delay", title: "Aguardar 1 dia", config: { amount: 1, unit: "days" } },
  { position: 3, step_type: "condition", title: "Se nao respondeu", config: { condition: "no_reply" } },
  {
    position: 4,
    step_type: "send_whatsapp",
    title: "Retomada",
    config: {
      message:
        "Oi, {{primeiro_nome}}. Passando para saber se voce conseguiu ver minha mensagem anterior. Posso te ajudar com os proximos passos?",
    },
  },
  { position: 5, step_type: "end", title: "Encerrar", config: {} },
];

function AutomacoesCrmPage() {
  const fetchWorkspace = useServerFn(listCrmAutomationWorkspace);
  const saveFlow = useServerFn(saveCrmAutomationFlow);
  const updateStatus = useServerFn(updateCrmAutomationFlowStatus);
  const duplicateFlow = useServerFn(duplicateCrmAutomationFlow);
  const cancelPending = useServerFn(cancelCrmAutomationPendingAction);
  const qc = useQueryClient();
  const [editingFlow, setEditingFlow] = useState<Flow | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, isError, error } = useQuery<Workspace>({
    queryKey: ["crm-automations-workspace"],
    queryFn: () => fetchWorkspace() as Promise<Workspace>,
    staleTime: 20_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["crm-automations-workspace"] });

  const statusMutation = useMutation({
    mutationFn: (payload: { id: string; status: Flow["status"] }) => updateStatus({ data: payload }),
    onSuccess: () => {
      toast.success("Status atualizado.");
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao atualizar status"),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateFlow({ data: { id } }),
    onSuccess: () => {
      toast.success("Fluxo duplicado em pausa.");
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao duplicar fluxo"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      cancelPending({ data: { id, reason: "Cancelado manualmente na central de automacoes." } }),
    onSuccess: () => {
      toast.success("Envio pendente cancelado.");
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao cancelar envio"),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: FlowFormState) => saveFlow({ data: payload }),
    onSuccess: () => {
      toast.success("Fluxo salvo.");
      setCreating(false);
      setEditingFlow(null);
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao salvar fluxo"),
  });

  const empty = !isLoading && !data?.flows.length;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-admin-border bg-admin-surface">
              <Workflow className="h-5 w-5 text-admin-accent" />
            </div>
            <div>
              <h1 className="font-display text-4xl font-bold tracking-tight">
                Automações CRM & WhatsApp
              </h1>
              <p className="text-sm text-admin-ink-muted">
                Fluxos automaticos com controle humano, logs e protecoes anti-spam.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refresh} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
          <Button
            onClick={() => setCreating(true)}
            disabled={!data?.permissions.canManage}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> Novo fluxo
          </Button>
        </div>
      </header>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={error instanceof Error ? error.message : "Erro ao carregar automacoes."} />
      ) : data ? (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-6">
            <Kpi icon={Bot} label="Fluxos ativos" value={data.metrics.activeFlows} />
            <Kpi icon={CalendarClock} label="Proximos envios" value={data.metrics.nextSends} />
            <Kpi icon={Send} label="Enviadas hoje" value={data.metrics.messagesSentToday} />
            <Kpi icon={MessageCircle} label="Respostas hoje" value={data.metrics.repliesToday} />
            <Kpi icon={BellOff} label="Paradas por resposta" value={data.metrics.stoppedByReply} />
            <Kpi icon={XCircle} label="Erros hoje" value={data.metrics.errorsToday} tone="danger" />
          </section>

          <Tabs defaultValue="fluxos" className="space-y-4">
            <TabsList className="bg-admin-surface border border-admin-border">
              <TabsTrigger value="fluxos">Fluxos</TabsTrigger>
              <TabsTrigger value="envios">Próximos envios</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>

            <TabsContent value="fluxos" className="mt-0">
              {empty ? (
                <EmptyState onCreate={() => setCreating(true)} canCreate={data.permissions.canManage} />
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {data.flows.map((flow) => (
                    <FlowCard
                      key={flow.id}
                      flow={flow}
                      permissions={data.permissions}
                      onEdit={() => setEditingFlow(flow)}
                      onDuplicate={() => duplicateMutation.mutate(flow.id)}
                      onStatus={(status) => statusMutation.mutate({ id: flow.id, status })}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="envios" className="mt-0">
              <PendingList
                items={data.pendingActions}
                canCancel={data.permissions.canCancelPending}
                onCancel={(id) => cancelMutation.mutate(id)}
              />
            </TabsContent>

            <TabsContent value="logs" className="mt-0">
              <LogsList items={data.logs} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}

      <FlowEditorDialog
        open={creating || Boolean(editingFlow)}
        flow={editingFlow}
        canManage={Boolean(data?.permissions.canManage)}
        saving={saveMutation.isPending}
        onClose={() => {
          setCreating(false);
          setEditingFlow(null);
        }}
        onSave={(payload) => saveMutation.mutate(payload)}
      />
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Bot;
  label: string;
  value: number;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-admin-ink-muted">{label}</span>
        <Icon className={tone === "danger" ? "h-4 w-4 text-red-brand" : "h-4 w-4 text-admin-accent"} />
      </div>
      <div className="mt-3 font-display text-3xl font-bold text-admin-ink">{value}</div>
    </div>
  );
}

function FlowCard({
  flow,
  permissions,
  onEdit,
  onDuplicate,
  onStatus,
}: {
  flow: Flow;
  permissions: Workspace["permissions"];
  onEdit: () => void;
  onDuplicate: () => void;
  onStatus: (status: Flow["status"]) => void;
}) {
  const sent = Number(flow.metrics?.sent ?? 0);
  const replies = Number(flow.metrics?.replies ?? 0);
  const responseRate = sent > 0 ? Math.round((replies / sent) * 100) : 0;
  const nextSend = flow.steps.find((step) => step.step_type === "send_whatsapp");

  return (
    <article className="rounded-xl border border-admin-border bg-admin-surface p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-xl font-semibold text-admin-ink">
              {flow.name}
            </h2>
            <StatusBadge status={flow.status} />
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-admin-ink-muted">
            {flow.description || triggerLabel(flow.trigger_type)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={onEdit} className="gap-2">
            <Eye className="h-4 w-4" /> Editar
          </Button>
          <Button size="sm" variant="outline" onClick={onDuplicate} disabled={!permissions.canManage}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
        <MiniMetric label="Gatilho" value={triggerLabel(flow.trigger_type)} />
        <MiniMetric label="Etapas" value={flow.steps.length} />
        <MiniMetric label="Execuções ativas" value={flow.activeExecutions} />
        <MiniMetric label="Resposta" value={`${responseRate}%`} />
      </div>

      <div className="mt-4 rounded-lg border border-admin-border bg-admin-bg p-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-admin-ink-muted">
          <Workflow className="h-4 w-4" /> Builder
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {flow.steps.map((step, index) => (
            <div key={step.id ?? index} className="flex items-center gap-2">
              <StepPill step={step} />
              {index < flow.steps.length - 1 && <span className="text-admin-ink-muted">→</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-admin-ink-muted">
          Próximo bloco de envio: {nextSend?.title ?? "não configurado"}
        </div>
        <div className="flex gap-2">
          {flow.status === "active" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!permissions.canPause}
              onClick={() => onStatus("paused")}
              className="gap-2"
            >
              <PauseCircle className="h-4 w-4" /> Pausar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={!permissions.canManage}
              onClick={() => onStatus("active")}
              className="gap-2"
            >
              <PlayCircle className="h-4 w-4" /> Ativar
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!permissions.canManage}
            onClick={() => onStatus("archived")}
            className="gap-2"
          >
            <Archive className="h-4 w-4" /> Arquivar
          </Button>
        </div>
      </div>
    </article>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-admin-border bg-admin-bg p-3">
      <div className="text-[11px] uppercase tracking-wide text-admin-ink-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-admin-ink">{value}</div>
    </div>
  );
}

function StepPill({ step }: { step: Step }) {
  const Icon =
    step.step_type === "send_whatsapp"
      ? MessageCircle
      : step.step_type === "delay"
        ? Timer
        : step.step_type === "condition"
          ? ShieldCheck
          : step.step_type === "action"
            ? Settings2
            : Activity;
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-admin-border bg-admin-surface px-2 text-xs text-admin-ink">
      <Icon className="h-3.5 w-3.5 text-admin-accent" />
      {step.title}
    </span>
  );
}

type FlowFormState = {
  id?: string;
  name: string;
  description?: string;
  status: Flow["status"];
  trigger_type: Flow["trigger_type"];
  trigger_config: Record<string, unknown>;
  stop_rules: Record<string, unknown>;
  schedule_window: Record<string, unknown>;
  steps: Step[];
};

function FlowEditorDialog({
  open,
  flow,
  canManage,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  flow: Flow | null;
  canManage: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: FlowFormState) => void;
}) {
  const initial = useMemo<FlowFormState>(
    () => ({
      id: flow?.id,
      name: flow?.name ?? "Novo fluxo WhatsApp",
      description: flow?.description ?? "",
      status: flow?.status ?? "paused",
      trigger_type: flow?.trigger_type ?? "lead_created",
      trigger_config: flow?.trigger_config ?? {},
      stop_rules: {
        stop_on_reply: true,
        stop_on_final_stage: true,
        avoid_conflicts: true,
        max_messages_per_lead: 4,
        min_minutes_between_messages: 15,
        ...(flow?.stop_rules ?? {}),
      },
      schedule_window: {
        timezone: "Europe/Madrid",
        weekdays: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "18:00",
        ...(flow?.schedule_window ?? {}),
      },
      steps: flow?.steps?.length ? flow.steps : defaultSteps,
    }),
    [flow],
  );
  const [draft, setDraft] = useState(initial);

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const updateStep = (index: number, patch: Partial<Step>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, idx) => (idx === index ? { ...step, ...patch } : step)),
    }));
  };

  const addStep = () => {
    setDraft((current) => ({
      ...current,
      steps: [
        ...current.steps,
        {
          position: current.steps.length + 1,
          step_type: "send_whatsapp",
          title: "Nova mensagem",
          config: { message: "Oi, {{primeiro_nome}}." },
        },
      ],
    }));
  };

  const removeStep = (index: number) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps
        .filter((_, idx) => idx !== index)
        .map((step, idx) => ({ ...step, position: idx + 1 })),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{flow ? "Editar fluxo" : "Novo fluxo"}</DialogTitle>
          <DialogDescription>
            Monte a régua em blocos. Fluxos salvos em pausa não executam até serem ativados.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nome">
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  disabled={!canManage}
                />
              </Field>
              <Field label="Gatilho">
                <Select
                  value={draft.trigger_type}
                  onValueChange={(value) =>
                    setDraft({ ...draft, trigger_type: value as Flow["trigger_type"] })
                  }
                  disabled={!canManage}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lead_created">Lead criado</SelectItem>
                    <SelectItem value="pipeline_stage_entered">Etapa do funil</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Descrição">
              <Textarea
                value={draft.description ?? ""}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                disabled={!canManage}
                rows={2}
              />
            </Field>

            <div className="space-y-3 rounded-xl border border-admin-border bg-admin-bg p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg font-semibold">Builder do fluxo</h3>
                  <p className="text-xs text-admin-ink-muted">
                    A execução segue a ordem dos blocos de cima para baixo.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addStep} disabled={!canManage}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {draft.steps.map((step, index) => (
                <div key={`${step.id ?? "new"}-${index}`} className="rounded-lg border border-admin-border bg-admin-surface p-3">
                  <div className="grid gap-3 md:grid-cols-[150px_1fr_120px]">
                    <Select
                      value={step.step_type}
                      onValueChange={(value) => updateStep(index, { step_type: value as Step["step_type"] })}
                      disabled={!canManage}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="send_whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="delay">Aguardar</SelectItem>
                        <SelectItem value="condition">Condição</SelectItem>
                        <SelectItem value="action">Ação</SelectItem>
                        <SelectItem value="end">Fim</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={step.title}
                      onChange={(event) => updateStep(index, { title: event.target.value })}
                      disabled={!canManage}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removeStep(index)}
                      disabled={!canManage || draft.steps.length <= 1}
                    >
                      Remover
                    </Button>
                  </div>
                  <StepConfigEditor
                    step={step}
                    disabled={!canManage}
                    onChange={(config) => updateStep(index, { config })}
                  />
                </div>
              ))}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-admin-border bg-admin-surface p-4">
              <h3 className="font-display text-lg font-semibold">Status</h3>
              <Select
                value={draft.status}
                onValueChange={(value) => setDraft({ ...draft, status: value as Flow["status"] })}
                disabled={!canManage}
              >
                <SelectTrigger className="mt-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paused">Pausado</SelectItem>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="archived">Arquivado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-xl border border-admin-border bg-admin-surface p-4">
              <h3 className="font-display text-lg font-semibold">Proteções</h3>
              <div className="mt-3 space-y-3">
                <Field label="Máx. mensagens por lead">
                  <Input
                    type="number"
                    min={1}
                    value={Number(draft.stop_rules.max_messages_per_lead ?? 4)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        stop_rules: {
                          ...draft.stop_rules,
                          max_messages_per_lead: Number(event.target.value),
                        },
                      })
                    }
                    disabled={!canManage}
                  />
                </Field>
                <Field label="Intervalo mínimo (min)">
                  <Input
                    type="number"
                    min={1}
                    value={Number(draft.stop_rules.min_minutes_between_messages ?? 15)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        stop_rules: {
                          ...draft.stop_rules,
                          min_minutes_between_messages: Number(event.target.value),
                        },
                      })
                    }
                    disabled={!canManage}
                  />
                </Field>
              </div>
            </div>

            <div className="rounded-xl border border-admin-border bg-admin-surface p-4">
              <h3 className="font-display text-lg font-semibold">Janela de envio</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Input
                  value={String(draft.schedule_window.start ?? "09:00")}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      schedule_window: { ...draft.schedule_window, start: event.target.value },
                    })
                  }
                  disabled={!canManage}
                />
                <Input
                  value={String(draft.schedule_window.end ?? "18:00")}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      schedule_window: { ...draft.schedule_window, end: event.target.value },
                    })
                  }
                  disabled={!canManage}
                />
              </div>
            </div>
          </aside>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button disabled={!canManage || saving} onClick={() => onSave(draft)}>
            {saving ? "Salvando..." : "Salvar fluxo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepConfigEditor({
  step,
  disabled,
  onChange,
}: {
  step: Step;
  disabled: boolean;
  onChange: (config: Record<string, unknown>) => void;
}) {
  if (step.step_type === "send_whatsapp") {
    return (
      <div className="mt-3">
        <Label className="text-xs uppercase tracking-wide text-admin-ink-muted">Mensagem</Label>
        <Textarea
          className="mt-1"
          value={String(step.config.message ?? "")}
          onChange={(event) => onChange({ ...step.config, message: event.target.value })}
          disabled={disabled}
          rows={4}
        />
      </div>
    );
  }
  if (step.step_type === "delay") {
    return (
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <Field label="Tempo">
          <Input
            type="number"
            min={1}
            value={Number(step.config.amount ?? 1)}
            onChange={(event) => onChange({ ...step.config, amount: Number(event.target.value) })}
            disabled={disabled}
          />
        </Field>
        <Field label="Unidade">
          <Select
            value={String(step.config.unit ?? "days")}
            onValueChange={(value) => onChange({ ...step.config, unit: value })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">Minutos</SelectItem>
              <SelectItem value="hours">Horas</SelectItem>
              <SelectItem value="days">Dias</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
    );
  }
  if (step.step_type === "action") {
    return (
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <Field label="Ação">
          <Select
            value={String(step.config.action ?? "none")}
            onValueChange={(value) => onChange({ ...step.config, action: value })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Registrar log</SelectItem>
              <SelectItem value="move_stage">Mover etapa</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Etapa">
          <Input
            value={String(step.config.stage ?? "")}
            onChange={(event) => onChange({ ...step.config, stage: event.target.value })}
            disabled={disabled || step.config.action !== "move_stage"}
            placeholder="em_contato"
          />
        </Field>
      </div>
    );
  }
  return (
    <p className="mt-3 rounded-md border border-admin-border bg-admin-bg p-3 text-xs text-admin-ink-muted">
      Este bloco usa a regra padrao da automacao.
    </p>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs uppercase tracking-wide text-admin-ink-muted">{label}</span>
      {children}
    </label>
  );
}

function PendingList({
  items,
  canCancel,
  onCancel,
}: {
  items: PendingActionView[];
  canCancel: boolean;
  onCancel: (id: string) => void;
}) {
  if (!items.length) {
    return <PanelEmpty icon={CalendarClock} message="Nenhum envio pendente agora." />;
  }
  return (
    <div className="rounded-xl border border-admin-border bg-admin-surface">
      {items.map((item) => (
        <div key={item.id} className="flex flex-col gap-3 border-b border-admin-border p-4 last:border-0 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="font-medium text-admin-ink">
              {item.leads?.full_name ?? "Lead"} - {item.crm_automation_flows?.name ?? "Fluxo"}
            </div>
            <div className="text-xs text-admin-ink-muted">
              {item.crm_automation_steps?.title ?? "Etapa"} - {formatDate(item.run_at)}
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={!canCancel} onClick={() => onCancel(String(item.id))}>
            Cancelar envio
          </Button>
        </div>
      ))}
    </div>
  );
}

function LogsList({ items }: { items: AutomationLogView[] }) {
  if (!items.length) return <PanelEmpty icon={Activity} message="Nenhum log registrado ainda." />;
  return (
    <div className="rounded-xl border border-admin-border bg-admin-surface">
      {items.map((item) => (
        <div key={item.id} className="grid gap-2 border-b border-admin-border p-4 last:border-0 lg:grid-cols-[180px_1fr_180px]">
          <Badge variant="outline" className="w-fit">
            {eventLabel(item.event_type)}
          </Badge>
          <div>
            <div className="font-medium text-admin-ink">{item.message || "Evento registrado"}</div>
            <div className="text-xs text-admin-ink-muted">
              {item.crm_automation_flows?.name ?? "Fluxo"} - {item.leads?.full_name ?? "Lead"}
            </div>
          </div>
          <div className="text-xs text-admin-ink-muted lg:text-right">{formatDate(item.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate, canCreate }: { onCreate: () => void; canCreate: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-admin-border bg-admin-surface p-10 text-center">
      <Bot className="mx-auto h-9 w-9 text-admin-accent" />
      <h2 className="mt-3 font-display text-2xl font-semibold">Nenhum fluxo criado</h2>
      <p className="mx-auto mt-1 max-w-xl text-sm text-admin-ink-muted">
        Crie uma régua simples para novos leads e mantenha a equipe no controle dos envios.
      </p>
      <Button className="mt-4 gap-2" onClick={onCreate} disabled={!canCreate}>
        <Plus className="h-4 w-4" /> Criar primeiro fluxo
      </Button>
    </div>
  );
}

function PanelEmpty({ icon: Icon, message }: { icon: typeof Activity; message: string }) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-surface p-8 text-center text-sm text-admin-ink-muted">
      <Icon className="mx-auto mb-2 h-5 w-5 text-admin-accent" />
      {message}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-3 xl:grid-cols-3">
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-32 animate-pulse rounded-xl border border-admin-border bg-admin-surface" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-brand/30 bg-red-brand/10 p-5 text-sm text-red-brand">
      {message}
    </div>
  );
}

function StatusBadge({ status }: { status: Flow["status"] }) {
  const label = status === "active" ? "Ativo" : status === "paused" ? "Pausado" : "Arquivado";
  return <Badge className={status === "active" ? "bg-green-700 text-white" : ""}>{label}</Badge>;
}

function triggerLabel(trigger: Flow["trigger_type"]) {
  if (trigger === "lead_created") return "Lead criado";
  if (trigger === "pipeline_stage_entered") return "Etapa do funil";
  if (trigger === "inbound_message") return "Mensagem recebida";
  return "Manual";
}

function eventLabel(event: string) {
  const map: Record<string, string> = {
    flow_entered: "Entrou no fluxo",
    message_sent: "Mensagem enviada",
    delay_created: "Aguardando",
    lead_replied: "Lead respondeu",
    automation_stopped: "Interrompida",
    send_error: "Erro",
    schedule_window_rescheduled: "Reagendada",
    anti_spam_rescheduled: "Anti-spam",
    flow_saved: "Fluxo salvo",
    flow_status_changed: "Status alterado",
  };
  return map[event] ?? event;
}

function formatDate(value?: string | null) {
  if (!value) return "aguardando";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
