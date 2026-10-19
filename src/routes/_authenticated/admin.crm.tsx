import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  addCrmLeadNote,
  createCrmFollowup,
  createCrmLead,
  getCrmLeadConversation,
  getCrmLeadDetail,
  listCrmColumnCounts,
  listCrmColumnLeads,
  listCrmWorkspace,
  logCrmWhatsappOpened,
  reorderCrmColumns,
  saveCrmColumn,
  saveCrmDistribution,
  sendCrmFollowupMessage,
  updateCrmFollowupStatus,
  updateCrmLeadColumn,
  updateCrmLeadNotes,
  updateCrmLeadOwner,
} from "@/lib/admin/crm.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Columns3,
  Pencil,
  MessageCircle,
  GripVertical,
  Archive,
  RotateCcw,
  Trash2,
  Plus,
  Send,
  Search,
  Settings2,
  ShieldCheck,
  XCircle,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AdminStatCard, type AdminStatCardTone } from "@/components/admin/AdminStatCard";
import { scoreLead, temperatureChip, temperatureOf } from "@/lib/leads/scoring";
import { CrmAutomationsTab } from "@/components/admin/CrmAutomationsTab";
import { CrmInboxConversations } from "@/components/admin/CrmInboxConversations";

export const Route = createFileRoute("/_authenticated/admin/crm")({
  head: () => ({
    meta: [
      { title: "CRM | Instituto Empuria" },
      { name: "description", content: "Gestão de leads e atendimentos do Instituto Empuria." },
      { property: "og:title", content: "CRM | Instituto Empuria" },
      { property: "og:description", content: "Gestão de leads e atendimentos do Instituto Empuria." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CrmPage,
});

type CrmUser = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role: "admin" | "staff";
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type CrmColumn = {
  id: string;
  key: string;
  label: string;
  type: "system" | "custom";
  position: number;
  is_locked: boolean;
  is_active: boolean;
};

type Lead = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  target_visa: string | null;
  timeline: string | null;
  budget_range: string | null;
  message: string | null;
  notes: string | null;
  source: string | null;
  assigned_to: string;
  assigned_user: CrmUser | null;
  crm_column_id: string | null;
  created_at: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_interaction_at: string | null;
  next_followup_at: string | null;
  qualification_answers: JsonValue;
  qualification_score: number | null;
};

type LeadCardData = Pick<
  Lead,
  | "id"
  | "full_name"
  | "target_visa"
  | "assigned_to"
  | "assigned_user"
  | "crm_column_id"
  | "created_at"
  | "next_followup_at"
  | "qualification_answers"
  | "qualification_score"
>;

type LeadSearchResult = Pick<
  Lead,
  "id" | "full_name" | "email" | "phone" | "target_visa" | "source" | "assigned_to"
>;

type Followup = {
  id: string;
  lead_id: string;
  assigned_to: string;
  due_at: string;
  status: "pending" | "done" | "skipped" | "canceled";
  type: string;
  template_key: string | null;
  mode: "manual" | "suggestion" | "automatic";
  message_preview: string | null;
  created_at: string;
  completed_at: string | null;
  sent_at: string | null;
  canceled_reason: string | null;
  lead: Lead | null;
  assigned_user: CrmUser | null;
};

type Activity = {
  id: string;
  lead_id: string;
  kind: string;
  payload: JsonValue;
  created_at: string;
};

type Distribution = {
  mode: "fixed" | "round_robin";
  fixed_user_id: string | null;
} | null;

type DistributionMember = {
  user_id: string;
  is_active: boolean;
};

type Workspace = {
  columns: CrmColumn[];
  archivedColumns: CrmColumn[];
  distribution: Distribution;
  distributionMembers: DistributionMember[];
  users: CrmUser[];
  currentUserId: string;
  whatsappMode: "sugestao" | "automatico" | "desativado";
  metrics: { mine: number; followups: number; inbox: number; late: number };
};

type LeadPage = {
  items: LeadCardData[];
  totalCount: number;
  nextCursor: { createdAt: string; id: string } | null;
};

const FOLLOWUP_TEMPLATE_OPTIONS = [
  {
    key: "primeiro_contato_2h",
    type: "primeiro_contato",
    label: "Primeiro contato",
    message: (lead: Pick<Lead, "full_name">) =>
      `Oi, ${firstName(lead.full_name)}, tudo bem? Vi seu interesse pelo Instituto Empuria e queria entender melhor em qual etapa voce esta no seu plano de imigracao.`,
  },
  {
    key: "sem_resposta_24h",
    type: "sem_resposta",
    label: "Sem resposta 24h",
    message: (lead: Pick<Lead, "full_name">) =>
      `Oi, ${firstName(lead.full_name)}. Passando so para saber se voce conseguiu ver minha mensagem anterior. Posso te ajudar com os proximos passos?`,
  },
  {
    key: "documentacao",
    type: "documentacao",
    label: "Documentos",
    message: (lead: Pick<Lead, "full_name">) =>
      `Oi, ${firstName(lead.full_name)}. Para avancarmos com sua analise, ainda preciso que voce me envie os documentos combinados. Posso te lembrar quais sao?`,
  },
  {
    key: "pre_reuniao",
    type: "pre_reuniao",
    label: "Reuniao",
    message: (lead: Pick<Lead, "full_name">) =>
      `Oi, ${firstName(lead.full_name)}. Passando para confirmar nossa conversa marcada. Se precisar ajustar o horario, me avise por aqui.`,
  },
  {
    key: "retomada_final",
    type: "retomada",
    label: "Retomada final",
    message: (lead: Pick<Lead, "full_name">) =>
      `Oi, ${firstName(lead.full_name)}. Como nao consegui retorno, vou deixar seu atendimento pausado por enquanto. Se quiser retomar seu plano, e so me chamar por aqui.`,
  },
] as const;

function CrmPage() {
  const fetchWorkspace = useServerFn(listCrmWorkspace);
  const moveLead = useServerFn(updateCrmLeadColumn);
  const qc = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("funil");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [inboxConversationId, setInboxConversationId] = useState<string | null>(null);
  const [draggedLead, setDraggedLead] = useState<LeadCardData | null>(null);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [distributionOpen, setDistributionOpen] = useState(false);
  const [followupLead, setFollowupLead] = useState<Lead | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading, isError, error } = useQuery<Workspace>({
    queryKey: ["crm-workspace"],
    queryFn: () => fetchWorkspace() as Promise<Workspace>,
    staleTime: 20_000,
  });

  const handleDragStart = (event: DragStartEvent) => {
    setDraggedLead((event.active.data.current?.lead as LeadCardData | undefined) ?? null);
  };
  const handleDrop = async (event: DragEndEvent) => {
    setDraggedLead(null);
    const leadId = String(event.active.id);
    const columnId = event.over?.id ? String(event.over.id) : "";
    const sourceColumnId = String(event.active.data.current?.columnId ?? "");
    if (!columnId || !sourceColumnId || sourceColumnId === columnId) return;

    try {
      await moveLead({ data: { leadId, columnId } });
      const column = data?.columns.find((item) => item.id === columnId);
      toast.success(`Lead movido para ${column?.label ?? "nova coluna"}`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["crm-workspace", "column", sourceColumnId] }),
        qc.invalidateQueries({ queryKey: ["crm-workspace", "column", columnId] }),
        qc.invalidateQueries({ queryKey: ["crm-workspace"], exact: true }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao mover lead");
    }
  };

  if (isLoading) return <CrmLoading />;
  if (isError)
    return <CrmError message={error instanceof Error ? error.message : "Erro ao carregar CRM"} />;
  if (!data) return <CrmError message="CRM indisponivel no momento." />;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-4xl font-bold tracking-tight">CRM Empuria</h1>
            <Badge className="bg-admin-accent text-white">
              WhatsApp: {modeLabel(data.whatsappMode)}
            </Badge>
          </div>
          <p className="text-admin-ink-muted mt-1 text-sm">
            Funil operacional com responsavel obrigatorio, inbox WhatsApp e automacoes comerciais.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setNewLeadOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Novo lead
          </Button>
          <Button variant="outline" onClick={() => setColumnsOpen(true)} className="gap-2">
            <Columns3 className="h-4 w-4" /> Colunas
          </Button>
          <Button variant="outline" onClick={() => setDistributionOpen(true)} className="gap-2">
            <Settings2 className="h-4 w-4" /> Distribuicao
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={UserRound} label="Meus leads" value={data.metrics.mine} tone="blue" />
        <Metric
          icon={CalendarClock}
          label="Pendencias do CRM"
          value={data.metrics.followups}
          tone="amber"
        />
        <Metric
          icon={MessageCircle}
          label="Mensagens novas"
          value={data.metrics.inbox}
          tone="green"
        />
        <Metric icon={Clock} label="Leads atrasados" value={data.metrics.late} tone="red" />
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-admin-border bg-admin-surface p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-ink-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, telefone, e-mail, objetivo..."
            className="h-10 bg-admin-bg pl-9"
          />
        </div>
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="h-10 bg-admin-bg lg:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os responsaveis</SelectItem>
            <SelectItem value="mine">Meus leads</SelectItem>
            {data.users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-admin-surface border border-admin-border">
          <TabsTrigger
            value="funil"
            className="data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            Funil
          </TabsTrigger>
          <TabsTrigger
            value="inbox"
            className="data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            Inbox WhatsApp
          </TabsTrigger>
          <TabsTrigger
            value="automacoes"
            className="data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            Automações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="funil" className="mt-0">
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragCancel={() => setDraggedLead(null)}
            onDragEnd={handleDrop}
          >
            <div className="flex gap-4 overflow-x-auto pb-4">
              {data.columns.map((column) => (
                <CrmColumnView
                  key={column.id}
                  column={column}
                  search={debouncedSearch}
                  owner={ownerFilter}
                  users={data.users}
                  onOpen={setSelectedLeadId}
                />
              ))}
            </div>
            {typeof document !== "undefined" &&
              createPortal(
                <DragOverlay zIndex={200} dropAnimation={null}>
                  {draggedLead && (
                    <div className="w-[280px] rotate-1 cursor-grabbing rounded-lg border-2 border-admin-accent bg-admin-surface-2 p-3 shadow-2xl">
                      <LeadCardBody lead={draggedLead} />
                    </div>
                  )}
                </DragOverlay>,
                document.body,
              )}
          </DndContext>
        </TabsContent>

        {activeTab === "inbox" && (
          <TabsContent value="inbox" className="mt-0">
            <CrmInboxConversations
              onOpenLead={setSelectedLeadId}
              selectedConversationId={inboxConversationId}
            />
          </TabsContent>
        )}

        {activeTab === "automacoes" && (
          <TabsContent value="automacoes" className="mt-0">
            <CrmAutomationsTab />
          </TabsContent>
        )}
      </Tabs>

      <LeadDialog
        leadId={selectedLeadId}
        users={data.users}
        columns={data.columns}
        archivedColumns={data.archivedColumns}
        onClose={() => setSelectedLeadId(null)}
        onViewConversation={(conversationId) => {
          setSelectedLeadId(null);
          setInboxConversationId(conversationId);
          setActiveTab("inbox");
        }}
        onCreateFollowup={(lead) => setFollowupLead(lead)}
      />
      <NewLeadDialog open={newLeadOpen} onOpenChange={setNewLeadOpen} users={data.users} />
      <ColumnsDialog
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        columns={data.columns}
        archivedColumns={data.archivedColumns}
        onOpenLead={setSelectedLeadId}
        users={data.users}
      />
      <DistributionDialog open={distributionOpen} onOpenChange={setDistributionOpen} data={data} />
      <FollowupDialog
        lead={followupLead}
        onClose={() => setFollowupLead(null)}
        users={data.users}
      />
    </div>
  );
}

function CrmColumnView({
  column,
  search,
  owner,
  users,
  onOpen,
}: {
  column: CrmColumn;
  search: string;
  owner: string;
  users: CrmUser[];
  onOpen: (leadId: string) => void;
}) {
  const fetchLeads = useServerFn(listCrmColumnLeads);
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage, isError } =
    useInfiniteQuery<LeadPage>({
      queryKey: ["crm-workspace", "column", column.id, search, owner],
      initialPageParam: null as LeadPage["nextCursor"],
      queryFn: ({ pageParam }) =>
        fetchLeads({
          data: {
            columnId: column.id,
            cursor: pageParam as LeadPage["nextCursor"],
            search,
            owner,
          },
        }) as Promise<LeadPage>,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: 20_000,
    });
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const leads = useMemo(
    () =>
      (data?.pages.flatMap((page) => page.items) ?? []).map((lead) => ({
        ...lead,
        assigned_user: usersById.get(lead.assigned_to) ?? null,
      })),
    [data?.pages, usersById],
  );
  const totalCount = data?.pages[0]?.totalCount ?? 0;
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[58vh] w-[280px] min-w-[280px] max-w-[280px] flex-col rounded-xl border border-admin-border bg-admin-surface sm:w-[300px] sm:min-w-[300px] sm:max-w-[300px] ${isOver ? "ring-2 ring-admin-accent bg-admin-accent/5" : ""}`}
    >
      <header className="flex items-center justify-between border-b border-admin-border px-4 py-3">
        <div>
          <h3 className="font-display text-sm uppercase tracking-wider text-admin-ink">
            {column.label}
          </h3>
          <p className="text-xs text-admin-ink-muted">
            {column.type === "system" ? "Padrao" : "Personalizada"}
          </p>
        </div>
        <span className="text-xs tabular-nums text-admin-ink-muted">{totalCount}</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading ? (
          <p className="py-6 text-center text-xs text-admin-ink-muted">Carregando 20 leads...</p>
        ) : isError ? (
          <p className="py-6 text-center text-xs text-red-700">Erro ao carregar esta coluna.</p>
        ) : leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-admin-border p-6 text-center text-xs text-admin-ink-muted">
            Sem leads nesta coluna.
          </div>
        ) : (
          leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              columnId={column.id}
              onClick={() => onOpen(lead.id)}
            />
          ))
        )}
        {hasNextPage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Carregando..." : "Carregar mais 20"}
          </Button>
        )}
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  columnId,
  onClick,
}: {
  lead: LeadCardData;
  columnId: string;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { columnId, lead },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={
        transform && !isDragging
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
      className={`w-full cursor-grab rounded-lg border border-admin-border bg-admin-surface-2 p-3 text-left active:cursor-grabbing ${
        isDragging ? "opacity-25 ring-2 ring-admin-accent" : "hover:border-admin-accent/70"
      }`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      <LeadCardBody lead={lead} />
    </button>
  );
}

function LeadCardBody({ lead }: { lead: LeadCardData }) {
  const temp = leadTemperature(lead);
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-admin-ink">{lead.full_name}</div>
          <div className="truncate text-xs text-admin-ink-muted">
            {lead.target_visa || "Sem objetivo definido"}
          </div>
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${temp.cls}`}
        >
          {temp.label}
        </span>
      </div>
      <div className="mt-3 space-y-1 text-xs text-admin-ink-muted">
        <div className="flex items-center gap-1.5">
          <UsersRound className="h-3.5 w-3.5" />
          <span className="truncate">{lead.assigned_user?.full_name ?? "Sem responsavel"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          <span
            className={
              lead.next_followup_at && new Date(lead.next_followup_at).getTime() < Date.now()
                ? "font-medium text-red-700"
                : ""
            }
          >
            {lead.next_followup_at
              ? `${new Date(lead.next_followup_at).getTime() < Date.now() ? "Atrasado" : "Follow-up"} ${formatDateShort(lead.next_followup_at)}`
              : "Sem follow-up"}
          </span>
        </div>
      </div>
    </>
  );
}

function FollowupsTab({
  followups,
  onOpenLead,
}: {
  followups: Followup[];
  onOpenLead: (lead: Lead) => void;
}) {
  const updateStatus = useServerFn(updateCrmFollowupStatus);
  const sendMessage = useServerFn(sendCrmFollowupMessage);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Followup | null>(null);
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: (payload: {
      followupId: string;
      status: "pending" | "done" | "skipped" | "canceled";
      dueAt?: string;
      messagePreview?: string;
      canceledReason?: string;
    }) => updateStatus({ data: payload }),
    onSuccess: () => {
      toast.success("Follow-up atualizado");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar follow-up"),
  });

  const send = useMutation({
    mutationFn: (followup: Followup) =>
      sendMessage({
        data: {
          followupId: followup.id,
          message: messageDrafts[followup.id] ?? followup.message_preview ?? "",
        },
      }),
    onSuccess: (result) => {
      if (result.delivery === "uazapi") {
        toast.success("Follow-up enviado pela Uazapi e registrado no CRM.");
      } else if (result.whatsappUrl) {
        toast.success("Follow-up registrado. WhatsApp aberto para envio.");
        window.open(result.whatsappUrl, "_blank", "noopener,noreferrer");
      } else {
        toast.success("Follow-up registrado.");
      }
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao enviar follow-up"),
  });

  const pending = followups.filter((item) => item.status === "pending");
  const manualPending = pending.filter((item) => item.mode !== "suggestion");
  const suggestions = pending.filter((item) => item.mode === "suggestion");
  const done = followups
    .filter((item) => item.status === "done")
    .sort(
      (a, b) =>
        new Date(b.completed_at ?? b.due_at).getTime() -
        new Date(a.completed_at ?? a.due_at).getTime(),
    )
    .slice(0, 20);
  const now = Date.now();
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const overdue = manualPending.filter((item) => new Date(item.due_at).getTime() < now);
  const today = manualPending.filter((item) => {
    const due = new Date(item.due_at).getTime();
    return due >= now && due <= todayEnd.getTime();
  });
  const upcoming = manualPending.filter(
    (item) => new Date(item.due_at).getTime() > todayEnd.getTime(),
  );

  const actions = {
    onOpenLead,
    onDraftChange: (id: string, value: string) =>
      setMessageDrafts((old) => ({ ...old, [id]: value })),
    onEdit: setEditing,
    onSend: (item: Followup) => send.mutate(item),
    onDone: (id: string) => mutation.mutate({ followupId: id, status: "done" }),
    onDelay: (id: string) =>
      mutation.mutate({
        followupId: id,
        status: "pending",
        dueAt: addDays(new Date(), 1).toISOString(),
      }),
    onCancel: (id: string) =>
      mutation.mutate({
        followupId: id,
        status: "canceled",
        canceledReason: "Cancelado manualmente pela equipe.",
      }),
    busy: mutation.isPending || send.isPending,
    messageDrafts,
  };

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-5">
        <Metric icon={Clock} label="Atrasados" value={overdue.length} tone="red" />
        <Metric icon={CalendarClock} label="Hoje" value={today.length} tone="amber" />
        <Metric icon={ArrowRight} label="Proximos" value={upcoming.length} tone="blue" />
        <Metric icon={MessageCircle} label="Sugeridos" value={suggestions.length} tone="neutral" />
        <Metric icon={CheckCircle2} label="Concluidos" value={done.length} tone="green" />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <FollowupGroup title="Atrasados" items={overdue} tone="danger" actions={actions} />
        <FollowupGroup title="Hoje" items={today} tone="accent" actions={actions} />
        <FollowupGroup
          title="Automaticos sugeridos"
          items={suggestions}
          tone="suggestion"
          actions={actions}
        />
        <FollowupGroup title="Proximos" items={upcoming} tone="neutral" actions={actions} />
      </div>

      <FollowupGroup
        title="Concluidos recentes"
        items={done}
        tone="done"
        actions={actions}
        readonly
      />

      <EditFollowupMessageDialog
        followup={editing}
        value={editing ? (messageDrafts[editing.id] ?? editing.message_preview ?? "") : ""}
        onChange={(value) =>
          editing && setMessageDrafts((old) => ({ ...old, [editing.id]: value }))
        }
        onClose={() => setEditing(null)}
        onSave={(value) => {
          if (!editing) return;
          mutation.mutate({
            followupId: editing.id,
            status: "pending",
            messagePreview: value,
          });
          setEditing(null);
        }}
      />
    </div>
  );
}

function FollowupGroup({
  title,
  items,
  tone,
  actions,
  readonly,
}: {
  title: string;
  items: Followup[];
  tone: "danger" | "accent" | "suggestion" | "neutral" | "done";
  actions: {
    onOpenLead: (lead: Lead) => void;
    onDraftChange: (id: string, value: string) => void;
    onEdit: (followup: Followup) => void;
    onSend: (followup: Followup) => void;
    onDone: (id: string) => void;
    onDelay: (id: string) => void;
    onCancel: (id: string) => void;
    busy: boolean;
    messageDrafts: Record<string, string>;
  };
  readonly?: boolean;
}) {
  const toneClass = {
    danger: "border-red-500/30",
    accent: "border-admin-accent/40",
    suggestion: "border-amber-500/40",
    neutral: "border-admin-border",
    done: "border-emerald-500/30",
  }[tone];

  return (
    <section className={`rounded-xl border bg-admin-surface ${toneClass}`}>
      <header className="border-b border-admin-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-sm uppercase tracking-wider">{title}</h3>
          <span className="text-xs tabular-nums text-admin-ink-muted">{items.length}</span>
        </div>
      </header>
      <div className="space-y-2 p-3">
        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-admin-ink-muted">Nada por aqui.</p>
        ) : (
          items.map((item) => (
            <FollowupCard key={item.id} item={item} actions={actions} readonly={readonly} />
          ))
        )}
      </div>
    </section>
  );
}

function FollowupCard({
  item,
  actions,
  readonly,
}: {
  item: Followup;
  actions: Parameters<typeof FollowupGroup>[0]["actions"];
  readonly?: boolean;
}) {
  const draft = actions.messageDrafts[item.id] ?? item.message_preview ?? "";
  const isObsolete =
    item.lead?.last_inbound_at &&
    new Date(item.lead.last_inbound_at).getTime() > new Date(item.created_at).getTime();
  const canSend = Boolean(item.lead && draft.trim() && !isObsolete && item.status === "pending");

  return (
    <article className="rounded-lg border border-admin-border bg-admin-surface-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-admin-ink">
            {item.lead?.full_name ?? "Lead removido"}
          </div>
          <div className="mt-1 text-xs text-admin-ink-muted">
            {followupTypeLabel(item.type)} · {formatDateTime(item.due_at)}
          </div>
        </div>
        <Badge variant={item.mode === "suggestion" ? "secondary" : "outline"}>
          {item.mode === "suggestion" ? "sugerido" : item.status}
        </Badge>
      </div>

      <div className="mt-2 text-xs text-admin-ink-muted">
        Responsavel: {item.assigned_user?.full_name ?? item.lead?.assigned_user?.full_name ?? "-"}
      </div>

      {readonly ? (
        <p className="mt-2 line-clamp-3 text-sm text-admin-ink-soft">
          {item.message_preview || "Sem mensagem registrada."}
        </p>
      ) : (
        <Textarea
          value={draft}
          onChange={(event) => actions.onDraftChange(item.id, event.target.value)}
          rows={3}
          className="mt-2 bg-admin-surface text-sm"
          placeholder="Mensagem sugerida para revisar antes do envio."
        />
      )}

      {isObsolete && (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800">
          O lead respondeu depois que este follow-up foi criado. Cancele ou revise antes de agir.
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {item.lead && (
          <Button size="sm" variant="outline" onClick={() => actions.onOpenLead(item.lead!)}>
            Abrir lead
          </Button>
        )}
        {!readonly && (
          <>
            <Button
              size="sm"
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={!canSend || actions.busy}
              onClick={() => actions.onSend(item)}
            >
              <Send className="h-4 w-4" /> Enviar agora
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => actions.onEdit(item)}
            >
              <Pencil className="h-4 w-4" /> Editar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => actions.onDelay(item.id)}
              disabled={actions.busy}
            >
              Adiar 24h
            </Button>
            <Button
              size="sm"
              onClick={() => actions.onDone(item.id)}
              disabled={actions.busy}
              className="gap-2"
            >
              <CheckCircle2 className="h-4 w-4" /> Concluir
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => actions.onCancel(item.id)}
              disabled={actions.busy}
              className="gap-2"
            >
              <XCircle className="h-4 w-4" /> Cancelar
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

function EditFollowupMessageDialog({
  followup,
  value,
  onChange,
  onClose,
  onSave,
}: {
  followup: Followup | null;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  return (
    <Dialog open={Boolean(followup)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-admin-surface sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar mensagem</DialogTitle>
          <DialogDescription>
            Revise a mensagem antes de registrar o envio pelo WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={6}
          className="bg-admin-bg"
        />
        <Button onClick={() => onSave(value)} disabled={!value.trim()}>
          Salvar mensagem
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function LeadDialog({
  leadId,
  users,
  columns,
  archivedColumns,
  onClose,
  onViewConversation,
  onCreateFollowup,
}: {
  leadId: string | null;
  users: Workspace["users"];
  columns: CrmColumn[];
  archivedColumns: CrmColumn[];
  onClose: () => void;
  onViewConversation: (conversationId: string) => void;
  onCreateFollowup: (lead: Lead) => void;
}) {
  const fetchDetail = useServerFn(getCrmLeadDetail);
  const qc = useQueryClient();
  const addNote = useServerFn(addCrmLeadNote);
  const updateOwner = useServerFn(updateCrmLeadOwner);
  const updateColumn = useServerFn(updateCrmLeadColumn);
  const updateNotes = useServerFn(updateCrmLeadNotes);
  const logWa = useServerFn(logCrmWhatsappOpened);
  const findConversation = useServerFn(getCrmLeadConversation);
  const [note, setNote] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const { data: detail, isError } = useQuery<{ lead: Lead; activity: Activity[] }>({
    queryKey: ["crm-workspace", "lead-detail", leadId],
    queryFn: () =>
      fetchDetail({ data: { leadId: leadId! } }) as Promise<{ lead: Lead; activity: Activity[] }>,
    enabled: Boolean(leadId),
    staleTime: 10_000,
  });
  const lead = detail?.lead ?? null;
  const activity = detail?.activity ?? [];

  const noteMutation = useMutation({
    mutationFn: () => addNote({ data: { leadId: lead!.id, body: note } }),
    onSuccess: () => {
      setNote("");
      toast.success("Nota adicionada");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao adicionar nota"),
  });

  const saveNotes = useMutation({
    mutationFn: () =>
      updateNotes({ data: { leadId: lead!.id, notes: notesDraft || lead?.notes || "" } }),
    onSuccess: () => {
      toast.success("Dossie atualizado");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao salvar dossie"),
  });
  const openConversation = useMutation({
    mutationFn: (id: string) => findConversation({ data: { leadId: id } }),
    onSuccess: (result) => {
      if (!result.conversationId) {
        toast.info("Este lead ainda nao possui conversa vinculada no Inbox.");
        return;
      }
      onViewConversation(result.conversationId);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Nao foi possivel abrir o Inbox."),
  });

  if (!leadId) return null;
  if (isError)
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="bg-admin-surface">
          <CrmError message="Erro ao carregar os detalhes deste lead." />
        </DialogContent>
      </Dialog>
    );
  if (!lead)
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="bg-admin-surface">
          <p className="py-8 text-center text-sm text-admin-ink-muted">Carregando detalhes...</p>
        </DialogContent>
      </Dialog>
    );
  const temp = leadTemperature(lead);
  const phoneDigits = lead.phone.replace(/\D/g, "");
  const waText = encodeURIComponent(
    `Ola ${lead.full_name.split(" ")[0]}, aqui e da equipe do Instituto Empuria. Podemos falar sobre seu atendimento?`,
  );
  const waUrl = `https://wa.me/${phoneDigits}?text=${waText}`;
  const archivedColumn = archivedColumns.find((column) => column.id === lead.crm_column_id);

  return (
    <Dialog open={Boolean(lead)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-admin-surface sm:max-w-4xl [&>button]:top-5">
        <Badge className={`absolute right-12 top-4 h-6 whitespace-nowrap ${temp.cls}`}>
          {temp.label}
        </Badge>
        <DialogHeader className="pr-32">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <DialogTitle className="break-words font-display text-2xl">{lead.full_name}</DialogTitle>
              <DialogDescription>
                Criado em {formatDateTime(lead.created_at)} · origem {lead.source || "site"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <section className="rounded-xl border border-admin-border bg-admin-surface-2 p-4">
              <h3 className="mb-3 font-display text-sm uppercase tracking-wider text-admin-ink-muted">
                Resumo e contato
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                <Info label="Telefone" value={lead.phone} />
                <Info label="E-mail" value={lead.email || "Sem e-mail"} />
                <Info label="Objetivo" value={lead.target_visa || "Nao informado"} />
                <Info label="Prazo" value={lead.timeline || "Nao informado"} />
                <Info label="Orcamento" value={lead.budget_range || "Nao informado"} />
                <Info
                  label="Ultima interacao"
                  value={
                    lead.last_interaction_at
                      ? formatDateTime(lead.last_interaction_at)
                      : "Sem registro"
                  }
                />
              </div>
              {lead.message && (
                <p className="mt-3 whitespace-pre-wrap rounded-lg border border-admin-border bg-admin-surface p-3 text-sm">
                  {lead.message}
                </p>
              )}
            </section>

            <section className="rounded-xl border border-admin-border bg-admin-surface-2 p-4">
              <h3 className="mb-3 font-display text-sm uppercase tracking-wider text-admin-ink-muted">
                Dossie interno
              </h3>
              <Textarea
                value={notesDraft || lead.notes || ""}
                onChange={(event) => setNotesDraft(event.target.value)}
                rows={5}
                className="bg-admin-surface"
                placeholder="Anotacoes internas, contexto da conversa e proximos passos."
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" onClick={() => saveNotes.mutate()} disabled={saveNotes.isPending}>
                  Salvar dossie
                </Button>
              </div>
            </section>

            <section className="rounded-xl border border-admin-border bg-admin-surface-2 p-4">
              <h3 className="mb-3 font-display text-sm uppercase tracking-wider text-admin-ink-muted">
                Notas e timeline
              </h3>
              <div className="flex gap-2">
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  className="bg-admin-surface"
                  placeholder="Adicionar nota rapida..."
                />
                <Button
                  onClick={() => noteMutation.mutate()}
                  disabled={!note.trim() || noteMutation.isPending}
                >
                  Adicionar
                </Button>
              </div>
              <ol className="mt-4 space-y-3 border-l border-admin-border pl-4">
                {activity.length === 0 ? (
                  <li className="text-sm text-admin-ink-muted">Sem interacoes registradas.</li>
                ) : (
                  activity.map((item) => (
                    <li key={item.id} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-admin-accent ring-2 ring-admin-surface-2" />
                      <div className="text-xs text-admin-ink-muted">
                        {formatDateTime(item.created_at)}
                      </div>
                      <div className="text-sm text-admin-ink">{formatActivity(item)}</div>
                    </li>
                  ))
                )}
              </ol>
            </section>
          </div>

          <aside className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              disabled={openConversation.isPending}
              onClick={() => openConversation.mutate(lead.id)}
            >
              <MessageCircle className="h-4 w-4" /> Ver conversa no Inbox
            </Button>
            <Button
              className="w-full justify-start gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={async () => {
                window.open(waUrl, "_blank", "noopener,noreferrer");
                try {
                  await logWa({ data: { leadId: lead.id } });
                  qc.invalidateQueries({ queryKey: ["crm-workspace"] });
                } catch {
                  /* non-blocking */
                }
              }}
            >
              <MessageCircle className="h-4 w-4" /> Abrir WhatsApp
            </Button>
            <section className="rounded-xl border border-admin-border bg-admin-surface-2 p-3">
              <label className="text-xs uppercase tracking-wider text-admin-ink-muted">
                Responsavel
              </label>
              <Select
                value={lead.assigned_to}
                onValueChange={async (value) => {
                  await updateOwner({ data: { leadId: lead.id, assignedTo: value } });
                  qc.invalidateQueries({ queryKey: ["crm-workspace"] });
                }}
              >
                <SelectTrigger className="mt-2 bg-admin-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            <section className="rounded-xl border border-admin-border bg-admin-surface-2 p-3">
              <label className="text-xs uppercase tracking-wider text-admin-ink-muted">
                Coluna
              </label>
              {archivedColumn ? (
                <p className="mt-2 text-sm text-admin-ink-muted">
                  {archivedColumn.label} (arquivada). Restaure a coluna para mover este lead.
                </p>
              ) : (
                <Select
                  value={lead.crm_column_id ?? ""}
                  onValueChange={async (value) => {
                    await updateColumn({ data: { leadId: lead.id, columnId: value } });
                    qc.invalidateQueries({ queryKey: ["crm-workspace"] });
                  }}
                >
                  <SelectTrigger className="mt-2 bg-admin-surface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((column) => (
                      <SelectItem key={column.id} value={column.id}>
                        {column.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </section>

            <section className="rounded-xl border border-admin-border bg-admin-surface-2 p-3 text-sm text-admin-ink-muted">
              <div className="flex items-center gap-2 text-admin-ink">
                <ShieldCheck className="h-4 w-4" /> Lead protegido
              </div>
              <p className="mt-2">
                Todo lead precisa ter responsavel admin/staff. Transferencias ficam registradas na
                timeline.
              </p>
            </section>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewLeadDialog({
  open,
  onOpenChange,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: Workspace["users"];
}) {
  const createLeadFn = useServerFn(createCrmLead);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    target_visa: "",
    message: "",
    assigned_to: "__auto",
  });
  const mutation = useMutation({
    mutationFn: () =>
      createLeadFn({
        data: {
          ...form,
          assigned_to: form.assigned_to === "__auto" ? "" : form.assigned_to,
          source: "manual",
        },
      }),
    onSuccess: () => {
      toast.success("Lead criado");
      setForm({
        full_name: "",
        phone: "",
        email: "",
        target_visa: "",
        message: "",
        assigned_to: "__auto",
      });
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro ao criar lead"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-admin-surface sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
          <DialogDescription>
            Se nenhum responsavel for escolhido, a regra ativa de distribuicao sera aplicada.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder="Nome completo"
            className="bg-admin-bg"
          />
          <Input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="WhatsApp"
            className="bg-admin-bg"
          />
          <Input
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="E-mail opcional"
            className="bg-admin-bg"
          />
          <Input
            value={form.target_visa}
            onChange={(e) => setForm({ ...form, target_visa: e.target.value })}
            placeholder="Objetivo / visto"
            className="bg-admin-bg"
          />
          <Select
            value={form.assigned_to}
            onValueChange={(value) => setForm({ ...form, assigned_to: value })}
          >
            <SelectTrigger className="bg-admin-bg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__auto">Usar distribuicao automatica</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder="Mensagem inicial"
            className="bg-admin-bg"
          />
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.full_name.trim() || !form.phone.trim()}
          >
            Criar lead
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ColumnsDialog({
  open,
  onOpenChange,
  columns,
  archivedColumns,
  onOpenLead,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: CrmColumn[];
  archivedColumns: CrmColumn[];
  onOpenLead: (id: string) => void;
  users: CrmUser[];
}) {
  const saveColumnFn = useServerFn(saveCrmColumn);
  const reorderFn = useServerFn(reorderCrmColumns);
  const countFn = useServerFn(listCrmColumnCounts);
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [confirm, setConfirm] = useState<{
    action: "archive" | "delete";
    column: CrmColumn;
  } | null>(null);
  const [viewArchived, setViewArchived] = useState<CrmColumn | null>(null);
  const wasOpen = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );
  useEffect(() => {
    if (open && !wasOpen.current) setOrderedIds(columns.map((column) => column.id));
    wasOpen.current = open;
  }, [open, columns]);
  const countsQ = useQuery({
    queryKey: ["crm-workspace", "column-counts"],
    queryFn: () => countFn(),
    enabled: open,
  });
  const orderedColumns = orderedIds
    .map((id) => columns.find((column) => column.id === id))
    .filter((column): column is CrmColumn => Boolean(column));
  for (const column of columns) if (!orderedIds.includes(column.id)) orderedColumns.push(column);
  const orderChanged =
    orderedColumns.map((column) => column.id).join() !== columns.map((column) => column.id).join();
  const save = useMutation({
    mutationFn: (data: {
      action: "create" | "rename" | "archive" | "restore" | "delete";
      id?: string;
      label?: string;
    }) => saveColumnFn({ data }),
    onSuccess: (result, variables) => {
      if (variables.action === "create") {
        setLabel("");
        setOrderedIds((old) => [...old, result.id]);
      }
      if (variables.action === "rename") setEditingId(null);
      setConfirm(null);
      toast.success(
        variables.action === "archive"
          ? "Coluna arquivada sem mover leads."
          : variables.action === "restore"
            ? "Coluna restaurada."
            : variables.action === "delete"
              ? "Coluna vazia excluida."
              : "Coluna salva.",
      );
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao salvar coluna"),
  });
  const reorder = useMutation({
    mutationFn: () => reorderFn({ data: { ids: orderedColumns.map((column) => column.id) } }),
    onSuccess: () => {
      toast.success("Ordem das colunas salva.");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao ordenar colunas"),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-admin-surface sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configurar colunas</DialogTitle>
            <DialogDescription>
              Arraste pela alca para ordenar. Colunas padrao podem mudar de lugar, mas nao de nome
              ou significado.
            </DialogDescription>
          </DialogHeader>
          <DndContext
            sensors={sensors}
            onDragEnd={({ active, over }) => {
              if (!over || active.id === over.id) return;
              setOrderedIds((old) =>
                arrayMove(old, old.indexOf(String(active.id)), old.indexOf(String(over.id))),
              );
            }}
          >
            <SortableContext
              items={orderedColumns.map((column) => column.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {orderedColumns.map((column) => (
                  <SortableColumnRow
                    key={column.id}
                    column={column}
                    count={countsQ.data?.[column.id] ?? 0}
                    busy={save.isPending}
                    editing={editingId === column.id}
                    editingLabel={editingLabel}
                    onEditingLabel={setEditingLabel}
                    onEdit={() => {
                      setEditingId(column.id);
                      setEditingLabel(column.label);
                    }}
                    onSaveEdit={() =>
                      save.mutate({ action: "rename", id: column.id, label: editingLabel })
                    }
                    onCancelEdit={() => setEditingId(null)}
                    onAction={(action) => setConfirm({ action, column })}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <Button
            variant="outline"
            onClick={() => reorder.mutate()}
            disabled={!orderChanged || reorder.isPending || save.isPending}
          >
            Salvar ordem
          </Button>
          <div className="grid gap-2 border-t border-admin-border pt-4 sm:grid-cols-[1fr_auto]">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Nome da nova coluna"
              maxLength={60}
              className="bg-admin-bg"
            />
            <Button
              onClick={() => save.mutate({ action: "create", label })}
              disabled={label.trim().length < 2 || save.isPending}
            >
              Adicionar
            </Button>
          </div>
          {archivedColumns.length > 0 && (
            <section className="space-y-2 border-t border-admin-border pt-4">
              <h3 className="text-sm font-semibold">Colunas arquivadas</h3>
              {archivedColumns.map((column) => (
                <div
                  key={column.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-admin-border p-3"
                >
                  <span>
                    {column.label}{" "}
                    <span className="text-xs text-admin-ink-muted">
                      · {countsQ.data?.[column.id] ?? 0} lead(s)
                    </span>
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setViewArchived(column)}>
                      Ver leads
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={save.isPending}
                      onClick={() => save.mutate({ action: "restore", id: column.id })}
                    >
                      <RotateCcw className="mr-1 h-4 w-4" /> Restaurar
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(confirm)} onOpenChange={(value) => !value && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === "delete" ? "Excluir coluna vazia?" : "Arquivar coluna?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === "delete"
                ? `A coluna ${confirm.column.label} sera excluida somente se ainda estiver vazia no banco.`
                : `A coluna ${confirm?.column.label} saira do Kanban; seus ${countsQ.data?.[confirm?.column.id ?? ""] ?? 0} lead(s), estagios e historico permanecem intactos.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={save.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={save.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (confirm) save.mutate({ action: confirm.action, id: confirm.column.id });
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={Boolean(viewArchived)}
        onOpenChange={(value) => !value && setViewArchived(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-admin-surface sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Leads em {viewArchived?.label}</DialogTitle>
            <DialogDescription>
              Coluna arquivada; restaure-a para voltar a movimentar os leads.
            </DialogDescription>
          </DialogHeader>
          {viewArchived && (
            <ArchivedColumnLeads
              columnId={viewArchived.id}
              users={users}
              onOpen={(id) => {
                setViewArchived(null);
                onOpenChange(false);
                onOpenLead(id);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SortableColumnRow({
  column,
  count,
  busy,
  editing,
  editingLabel,
  onEditingLabel,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onAction,
}: {
  column: CrmColumn;
  count: number;
  busy: boolean;
  editing: boolean;
  editingLabel: string;
  onEditingLabel: (value: string) => void;
  onEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onAction: (action: "archive" | "delete") => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap items-center gap-2 rounded-lg border border-admin-border bg-admin-surface-2 p-2 ${isDragging ? "opacity-50" : ""}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="cursor-grab touch-none rounded p-1"
        aria-label={`Arrastar ${column.label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-[120px] flex-1">
        {editing ? (
          <Input
            value={editingLabel}
            maxLength={60}
            onChange={(event) => onEditingLabel(event.target.value)}
          />
        ) : (
          <>
            <div className="font-medium">{column.label}</div>
            <div className="text-xs text-admin-ink-muted">
              {column.type === "system" ? "Padrao" : "Personalizada"} · {count} lead(s)
            </div>
          </>
        )}
      </div>
      {editing ? (
        <>
          <Button size="sm" disabled={busy || editingLabel.trim().length < 2} onClick={onSaveEdit}>
            Salvar
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelEdit}>
            Cancelar
          </Button>
        </>
      ) : (
        column.type === "custom" && (
          <>
            <Button size="icon" variant="ghost" aria-label="Renomear coluna" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            {count === 0 ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Excluir coluna vazia"
                onClick={() => onAction("delete")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Arquivar coluna"
                onClick={() => onAction("archive")}
              >
                <Archive className="h-4 w-4" />
              </Button>
            )}
          </>
        )
      )}
    </div>
  );
}

function ArchivedColumnLeads({
  columnId,
  users,
  onOpen,
}: {
  columnId: string;
  users: CrmUser[];
  onOpen: (id: string) => void;
}) {
  const fetchLeads = useServerFn(listCrmColumnLeads);
  const query = useInfiniteQuery<LeadPage>({
    queryKey: ["crm-workspace", "archived-column", columnId],
    initialPageParam: null as LeadPage["nextCursor"],
    queryFn: ({ pageParam }) =>
      fetchLeads({
        data: { columnId, cursor: pageParam as LeadPage["nextCursor"], owner: "all" },
      }) as Promise<LeadPage>,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const usersById = new Map(users.map((user) => [user.id, user]));
  return (
    <div className="space-y-2">
      {query.isLoading && <p>Carregando leads...</p>}
      {query.isError && <p className="text-red-700">Erro ao carregar leads.</p>}
      {query.data?.pages
        .flatMap((page) => page.items)
        .map((lead) => (
          <button
            key={lead.id}
            type="button"
            onClick={() => onOpen(lead.id)}
            className="block w-full rounded-lg border border-admin-border p-3 text-left hover:border-admin-accent"
          >
            <span className="font-medium">{lead.full_name}</span>
            <span className="block text-xs text-admin-ink-muted">
              {usersById.get(lead.assigned_to)?.full_name ?? "Sem responsavel"}
            </span>
          </button>
        ))}
      {query.hasNextPage && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          Carregar mais 20
        </Button>
      )}
    </div>
  );
}

function DistributionDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: Workspace;
}) {
  const saveDistributionFn = useServerFn(saveCrmDistribution);
  const qc = useQueryClient();
  const [mode, setMode] = useState<"fixed" | "round_robin">(data.distribution?.mode ?? "fixed");
  const [fixedUserId, setFixedUserId] = useState(
    data.distribution?.fixed_user_id ?? data.users[0]?.id ?? "",
  );
  const [members, setMembers] = useState<string[]>(
    data.distributionMembers.filter((item) => item.is_active).map((item) => item.user_id).length
      ? data.distributionMembers.filter((item) => item.is_active).map((item) => item.user_id)
      : data.users.map((user) => user.id),
  );
  const mutation = useMutation({
    mutationFn: () => saveDistributionFn({ data: { mode, fixedUserId, memberIds: members } }),
    onSuccess: () => {
      toast.success("Distribuicao atualizada");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao salvar distribuicao"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-admin-surface sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Configurar distribuicao</DialogTitle>
          <DialogDescription>
            Nenhum lead novo sera aceito sem responsavel. Use responsavel fixo ou rodizio
            sequencial.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Select value={mode} onValueChange={(value) => setMode(value as "fixed" | "round_robin")}>
            <SelectTrigger className="bg-admin-bg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Responsavel fixo</SelectItem>
              <SelectItem value="round_robin">Rodizio sequencial</SelectItem>
            </SelectContent>
          </Select>

          {mode === "fixed" && (
            <Select value={fixedUserId} onValueChange={setFixedUserId}>
              <SelectTrigger className="bg-admin-bg">
                <SelectValue placeholder="Responsavel padrao" />
              </SelectTrigger>
              <SelectContent>
                {data.users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-admin-ink-muted">
              Participantes do rodizio
            </div>
            {data.users.map((user) => (
              <label
                key={user.id}
                className="flex items-center gap-2 rounded-lg border border-admin-border bg-admin-surface-2 p-3"
              >
                <Checkbox
                  checked={members.includes(user.id)}
                  onCheckedChange={(checked) =>
                    setMembers((old) =>
                      checked
                        ? Array.from(new Set([...old, user.id]))
                        : old.filter((id) => id !== user.id),
                    )
                  }
                />
                <span>{user.full_name}</span>
                <span className="ml-auto text-xs uppercase text-admin-ink-muted">{user.role}</span>
              </label>
            ))}
          </div>

          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || members.length === 0}
            className="w-full"
          >
            Salvar distribuicao
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FollowupDialog({
  lead,
  onClose,
  users,
}: {
  lead: Lead | null;
  onClose: () => void;
  users: Workspace["users"];
}) {
  const createFollowupFn = useServerFn(createCrmFollowup);
  const qc = useQueryClient();
  const [dueAt, setDueAt] = useState("");
  const [templateKey, setTemplateKey] = useState("primeiro_contato_2h");
  const [messagePreview, setMessagePreview] = useState("");
  const selectedTemplate = FOLLOWUP_TEMPLATE_OPTIONS.find(
    (template) => template.key === templateKey,
  );
  const effectiveMessage =
    messagePreview || (lead && selectedTemplate ? selectedTemplate.message(lead) : "");
  const mutation = useMutation({
    mutationFn: () =>
      createFollowupFn({
        data: {
          leadId: lead!.id,
          assignedTo: lead!.assigned_to || users[0]?.id,
          dueAt: new Date(dueAt).toISOString(),
          type: selectedTemplate?.type ?? "manual",
          templateKey,
          mode: "manual",
          messagePreview: effectiveMessage,
        },
      }),
    onSuccess: () => {
      toast.success("Follow-up criado");
      setDueAt("");
      setTemplateKey("primeiro_contato_2h");
      setMessagePreview("");
      onClose();
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao criar follow-up"),
  });

  return (
    <Dialog open={Boolean(lead)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-admin-surface sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Criar follow-up</DialogTitle>
          <DialogDescription>{lead?.full_name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select
            value={templateKey}
            onValueChange={(value) => {
              setTemplateKey(value);
              const template = FOLLOWUP_TEMPLATE_OPTIONS.find((item) => item.key === value);
              if (template && lead) setMessagePreview(template.message(lead));
            }}
          >
            <SelectTrigger className="bg-admin-bg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FOLLOWUP_TEMPLATE_OPTIONS.map((template) => (
                <SelectItem key={template.key} value={template.key}>
                  {template.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            className="bg-admin-bg"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDueAt(toDateTimeLocal(addHours(new Date(), 2)))}
            >
              Em 2h
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDueAt(toDateTimeLocal(addDays(new Date(), 1)))}
            >
              Amanha
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDueAt(toDateTimeLocal(addDays(new Date(), 3)))}
            >
              Em 3 dias
            </Button>
          </div>
          <Textarea
            value={effectiveMessage}
            onChange={(event) => setMessagePreview(event.target.value)}
            placeholder="Mensagem ou objetivo do contato"
            className="bg-admin-bg"
          />
          <Button
            onClick={() => mutation.mutate()}
            disabled={!dueAt || mutation.isPending}
            className="w-full"
          >
            Agendar follow-up
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: AdminStatCardTone;
}) {
  return <AdminStatCard icon={icon} label={label} value={value} tone={tone} />;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-admin-border bg-admin-surface p-8 text-center">
      <h3 className="font-display text-lg">{title}</h3>
      <p className="mx-auto mt-1 max-w-xl text-sm text-admin-ink-muted">{body}</p>
    </div>
  );
}

function CrmLoading() {
  return (
    <div className="space-y-4">
      <div className="h-10 w-72 animate-pulse rounded bg-admin-surface" />
      <div className="grid gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-24 animate-pulse rounded-xl bg-admin-surface" />
        ))}
      </div>
      <div className="h-[60vh] animate-pulse rounded-xl bg-admin-surface" />
    </div>
  );
}

function CrmError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
      <h1 className="font-display text-2xl">Erro ao carregar CRM</h1>
      <p className="mt-2 text-sm text-admin-ink-muted">{message}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-admin-border bg-admin-surface p-3">
      <div className="text-[10px] uppercase tracking-wider text-admin-ink-muted">{label}</div>
      <div className="mt-1 truncate text-sm text-admin-ink">{value}</div>
    </div>
  );
}

function leadTemperature(lead: Pick<Lead, "qualification_answers" | "qualification_score">) {
  const answers = (lead.qualification_answers ?? {}) as Record<string, string | undefined>;
  const score =
    lead.qualification_score ??
    scoreLead(
      (answers.timeline as Parameters<typeof scoreLead>[0]) ?? null,
      (answers.budget_range as Parameters<typeof scoreLead>[1]) ?? null,
    );
  return temperatureChip(temperatureOf(score));
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);
  return debounced;
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || "tudo bem";
}

function addHours(date: Date, hours: number) {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateTimeLocal(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function formatDateShort(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function followupTypeLabel(type: string) {
  const labels: Record<string, string> = {
    primeiro_contato: "Primeiro contato",
    sem_resposta: "Sem resposta",
    retomada: "Retomada",
    documentacao: "Documentacao",
    pre_reuniao: "Pre-reuniao",
    pos_reuniao: "Pos-reuniao",
    proposta: "Proposta",
    reativacao: "Reativacao",
    manual: "Manual",
  };
  return labels[type] ?? type;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatActivity(event: Activity) {
  const payload = (event.payload ?? {}) as Record<string, string>;
  switch (event.kind) {
    case "created":
      return "Lead criado.";
    case "stage_changed":
      return `Movido para ${payload.to_label ?? payload.to ?? "outra coluna"}.`;
    case "note_added":
      return `Nota: ${(payload.body ?? "").slice(0, 160)}`;
    case "whatsapp_opened":
      return "WhatsApp aberto pela equipe.";
    case "owner_changed":
      return "Responsavel alterado.";
    case "followup_created":
      return "Follow-up criado.";
    case "followup_done":
      return "Follow-up concluido.";
    case "followup_sent":
      return "Follow-up enviado e registrado.";
    case "followup_delayed":
      return `Follow-up adiado para ${payload.due_at ? formatDateTime(payload.due_at) : "nova data"}.`;
    case "followup_canceled":
      return `Follow-up cancelado: ${payload.reason ?? "sem motivo informado"}.`;
    case "message_inbound":
      return "Mensagem recebida do lead.";
    case "message_outbound":
      return "Mensagem enviada para o lead.";
    case "inbox_message_linked":
      return "Mensagem do inbox vinculada.";
    default:
      return event.kind;
  }
}

function modeLabel(mode: string) {
  if (mode === "automatico") return "Automatico";
  if (mode === "desativado") return "Desativado";
  return "Sugestao";
}
