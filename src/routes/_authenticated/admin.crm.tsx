import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  addCrmLeadNote,
  createCrmFollowup,
  createCrmLead,
  deactivateCrmColumn,
  ignoreCrmInboxMessage,
  linkInboxToLead,
  listCrmWorkspace,
  logCrmWhatsappOpened,
  saveCrmColumn,
  saveCrmDistribution,
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
  MessageCircle,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { scoreLead, temperatureChip, temperatureOf } from "@/lib/leads/scoring";

export const Route = createFileRoute("/_authenticated/admin/crm")({
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
  last_interaction_at: string | null;
  next_followup_at: string | null;
  qualification_answers: JsonValue;
  qualification_score: number | null;
};

type Followup = {
  id: string;
  lead_id: string;
  assigned_to: string;
  due_at: string;
  status: "pending" | "done" | "skipped" | "canceled";
  message_preview: string | null;
  lead: Lead | null;
};

type InboxMessage = {
  id: string;
  from_phone: string;
  from_name: string | null;
  body: string | null;
  status: string;
  created_at: string;
  matched_lead_id: string | null;
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
  leads: Lead[];
  followups: Followup[];
  inbox: InboxMessage[];
  distribution: Distribution;
  distributionMembers: DistributionMember[];
  activity: Activity[];
  users: CrmUser[];
  currentUserId: string;
  isAdmin: boolean;
  whatsappMode: "sugestao" | "automatico" | "desativado";
};

function CrmPage() {
  const fetchWorkspace = useServerFn(listCrmWorkspace);
  const moveLead = useServerFn(updateCrmLeadColumn);
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [distributionOpen, setDistributionOpen] = useState(false);
  const [followupLead, setFollowupLead] = useState<Lead | null>(null);

  const { data, isLoading, isError, error } = useQuery<Workspace>({
    queryKey: ["crm-workspace"],
    queryFn: () => fetchWorkspace() as Promise<Workspace>,
    staleTime: 20_000,
  });

  const filteredLeads = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.leads ?? []).filter((lead) => {
      const ownerOk =
        ownerFilter === "all" ||
        (ownerFilter === "mine"
          ? lead.assigned_to === data?.currentUserId
          : lead.assigned_to === ownerFilter);
      if (!ownerOk) return false;
      if (!term) return true;
      return [lead.full_name, lead.email, lead.phone, lead.target_visa, lead.source]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [data?.currentUserId, data?.leads, ownerFilter, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Lead[]>();
    for (const column of data?.columns ?? []) groups.set(column.id, []);
    for (const lead of filteredLeads) {
      const key = lead.crm_column_id ?? data?.columns.find((column) => column.key === "novo")?.id;
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(lead);
    }
    return groups;
  }, [data?.columns, filteredLeads]);

  const metrics = useMemo(() => {
    const now = Date.now();
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const pendingFollowups = (data?.followups ?? []).filter((f) => f.status === "pending");
    return {
      mine: (data?.leads ?? []).filter((lead) => lead.assigned_to === data?.currentUserId).length,
      followups: pendingFollowups.filter((f) => new Date(f.due_at).getTime() <= today.getTime())
        .length,
      inbox: (data?.inbox ?? []).length,
      late: (data?.leads ?? []).filter(
        (lead) => lead.next_followup_at && new Date(lead.next_followup_at).getTime() < now,
      ).length,
    };
  }, [data?.currentUserId, data?.followups, data?.inbox, data?.leads]);

  const handleDrop = async (event: DragEndEvent) => {
    const leadId = String(event.active.id);
    const columnId = event.over?.id ? String(event.over.id) : "";
    if (!columnId) return;
    const lead = data?.leads.find((item) => item.id === leadId);
    if (!lead || lead.crm_column_id === columnId) return;

    qc.setQueryData<Workspace>(["crm-workspace"], (old) =>
      old
        ? {
            ...old,
            leads: old.leads.map((item) =>
              item.id === leadId ? { ...item, crm_column_id: columnId } : item,
            ),
          }
        : old,
    );

    try {
      await moveLead({ data: { leadId, columnId } });
      const column = data?.columns.find((item) => item.id === columnId);
      toast.success(`Lead movido para ${column?.label ?? "nova coluna"}`);
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao mover lead");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
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
            Funil operacional com responsavel obrigatorio, inbox WhatsApp e follow-ups da equipe.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setNewLeadOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Novo lead
          </Button>
          {data.isAdmin && (
            <>
              <Button variant="outline" onClick={() => setColumnsOpen(true)} className="gap-2">
                <Columns3 className="h-4 w-4" /> Colunas
              </Button>
              <Button variant="outline" onClick={() => setDistributionOpen(true)} className="gap-2">
                <Settings2 className="h-4 w-4" /> Distribuicao
              </Button>
            </>
          )}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={UserRound} label="Meus leads" value={metrics.mine} />
        <Metric icon={CalendarClock} label="Follow-ups pendentes" value={metrics.followups} />
        <Metric icon={MessageCircle} label="Mensagens novas" value={metrics.inbox} />
        <Metric icon={Clock} label="Leads atrasados" value={metrics.late} />
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

      <Tabs defaultValue="funil" className="space-y-4">
        <TabsList className="bg-admin-surface border border-admin-border">
          <TabsTrigger value="funil" className="data-[state=active]:bg-admin-accent data-[state=active]:text-white">Funil</TabsTrigger>
          <TabsTrigger value="inbox" className="data-[state=active]:bg-admin-accent data-[state=active]:text-white">Inbox WhatsApp</TabsTrigger>
          <TabsTrigger value="followups" className="data-[state=active]:bg-admin-accent data-[state=active]:text-white">Follow-ups</TabsTrigger>
        </TabsList>

        <TabsContent value="funil" className="mt-0">
          <DndContext sensors={sensors} onDragEnd={handleDrop}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              {data.columns.map((column) => (
                <CrmColumnView
                  key={column.id}
                  column={column}
                  leads={grouped.get(column.id) ?? []}
                  onOpen={setSelectedLead}
                />
              ))}
            </div>
          </DndContext>
        </TabsContent>

        <TabsContent value="inbox" className="mt-0">
          <InboxTab messages={data.inbox} leads={data.leads} onOpenLead={setSelectedLead} />
        </TabsContent>

        <TabsContent value="followups" className="mt-0">
          <FollowupsTab followups={data.followups} onOpenLead={setSelectedLead} />
        </TabsContent>
      </Tabs>

      <LeadDialog
        lead={selectedLead}
        users={data.users}
        columns={data.columns}
        activity={data.activity.filter((item) => item.lead_id === selectedLead?.id)}
        onClose={() => setSelectedLead(null)}
        onCreateFollowup={(lead) => setFollowupLead(lead)}
      />
      <NewLeadDialog open={newLeadOpen} onOpenChange={setNewLeadOpen} users={data.users} />
      <ColumnsDialog open={columnsOpen} onOpenChange={setColumnsOpen} columns={data.columns} />
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
  leads,
  onOpen,
}: {
  column: CrmColumn;
  leads: Lead[];
  onOpen: (lead: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[58vh] flex-col rounded-xl border border-admin-border bg-admin-surface ${isOver ? "ring-2 ring-admin-accent" : ""}`}
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
        <span className="text-xs tabular-nums text-admin-ink-muted">{leads.length}</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-admin-border p-6 text-center text-xs text-admin-ink-muted">
            Sem leads nesta coluna.
          </div>
        ) : (
          leads.map((lead) => <LeadCard key={lead.id} lead={lead} onClick={() => onOpen(lead)} />)
        )}
      </div>
    </div>
  );
}

function LeadCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
  });
  const temp = leadTemperature(lead);
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      className={`w-full cursor-grab rounded-lg border border-admin-border bg-admin-surface-2 p-3 text-left active:cursor-grabbing ${
        isDragging ? "opacity-50 shadow-lg" : "hover:border-admin-accent/70"
      }`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
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
          <span>
            {lead.next_followup_at
              ? `Follow-up ${formatDateShort(lead.next_followup_at)}`
              : "Sem follow-up"}
          </span>
        </div>
      </div>
    </button>
  );
}

function InboxTab({
  messages,
  leads,
  onOpenLead,
}: {
  messages: InboxMessage[];
  leads: Lead[];
  onOpenLead: (lead: Lead) => void;
}) {
  const createLeadFn = useServerFn(createCrmLead);
  const ignoreFn = useServerFn(ignoreCrmInboxMessage);
  const linkFn = useServerFn(linkInboxToLead);
  const qc = useQueryClient();
  const [linkTarget, setLinkTarget] = useState<Record<string, string>>({});

  const createFromInbox = useMutation({
    mutationFn: (message: InboxMessage) =>
      createLeadFn({
        data: {
          full_name: message.from_name || message.from_phone,
          phone: message.from_phone,
          message: message.body || "",
          source: "whatsapp",
          inbox_message_id: message.id,
        },
      }),
    onSuccess: () => {
      toast.success("Lead criado a partir da mensagem");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro ao criar lead"),
  });

  const ignore = useMutation({
    mutationFn: (id: string) => ignoreFn({ data: { inboxId: id } }),
    onSuccess: () => {
      toast.success("Mensagem ignorada");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao ignorar mensagem"),
  });

  const link = useMutation({
    mutationFn: ({ inboxId, leadId }: { inboxId: string; leadId: string }) =>
      linkFn({ data: { inboxId, leadId } }),
    onSuccess: () => {
      toast.success("Mensagem vinculada ao lead");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao vincular mensagem"),
  });

  if (messages.length === 0)
    return (
      <EmptyState
        title="Inbox vazio"
        body="Novas conversas do WhatsApp aparecerao aqui quando a integracao estiver ativa."
      />
    );

  return (
    <div className="space-y-3">
      {messages.map((message) => (
        <article
          key={message.id}
          className="rounded-xl border border-admin-border bg-admin-surface p-4"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-admin-ink">
                  {message.from_name || message.from_phone}
                </h3>
                <Badge variant="secondary">{message.status}</Badge>
                <span className="text-xs text-admin-ink-muted">
                  {formatDateTime(message.created_at)}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-admin-ink-soft">
                {message.body || "Mensagem sem texto."}
              </p>
              {message.matched_lead_id && (
                <Button
                  variant="link"
                  className="mt-2 h-auto p-0 text-admin-accent"
                  onClick={() => {
                    const lead = leads.find((item) => item.id === message.matched_lead_id);
                    if (lead) onOpenLead(lead);
                  }}
                >
                  Abrir lead sugerido
                </Button>
              )}
            </div>
            <div className="flex min-w-72 flex-col gap-2">
              <Button
                size="sm"
                onClick={() => createFromInbox.mutate(message)}
                disabled={createFromInbox.isPending}
                className="gap-2"
              >
                <Plus className="h-4 w-4" /> Criar lead
              </Button>
              <div className="flex gap-2">
                <Select
                  value={linkTarget[message.id] ?? ""}
                  onValueChange={(value) =>
                    setLinkTarget((old) => ({ ...old, [message.id]: value }))
                  }
                >
                  <SelectTrigger className="h-9 bg-admin-bg">
                    <SelectValue placeholder="Vincular a lead" />
                  </SelectTrigger>
                  <SelectContent>
                    {leads.slice(0, 80).map((lead) => (
                      <SelectItem key={lead.id} value={lead.id}>
                        {lead.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!linkTarget[message.id] || link.isPending}
                  onClick={() =>
                    link.mutate({ inboxId: message.id, leadId: linkTarget[message.id] })
                  }
                >
                  OK
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => ignore.mutate(message.id)}
                disabled={ignore.isPending}
              >
                Ignorar
              </Button>
            </div>
          </div>
        </article>
      ))}
    </div>
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
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: {
      followupId: string;
      status: "pending" | "done" | "skipped" | "canceled";
      dueAt?: string;
    }) => updateStatus({ data: payload }),
    onSuccess: () => {
      toast.success("Follow-up atualizado");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar follow-up"),
  });

  const pending = followups.filter((item) => item.status === "pending");
  const done = followups.filter((item) => item.status === "done").slice(0, 20);
  const overdue = pending.filter((item) => new Date(item.due_at).getTime() < Date.now());
  const upcoming = pending.filter((item) => new Date(item.due_at).getTime() >= Date.now());

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <FollowupGroup
        title="Atrasados"
        items={overdue}
        onOpenLead={onOpenLead}
        onDone={(id) => mutation.mutate({ followupId: id, status: "done" })}
      />
      <FollowupGroup
        title="Proximos"
        items={upcoming}
        onOpenLead={onOpenLead}
        onDone={(id) => mutation.mutate({ followupId: id, status: "done" })}
      />
      <FollowupGroup title="Concluidos" items={done} onOpenLead={onOpenLead} onDone={null} />
    </div>
  );
}

function FollowupGroup({
  title,
  items,
  onOpenLead,
  onDone,
}: {
  title: string;
  items: Followup[];
  onOpenLead: (lead: Lead) => void;
  onDone: ((id: string) => void) | null;
}) {
  return (
    <section className="rounded-xl border border-admin-border bg-admin-surface">
      <header className="border-b border-admin-border px-4 py-3">
        <h3 className="font-display text-sm uppercase tracking-wider">{title}</h3>
      </header>
      <div className="space-y-2 p-3">
        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-admin-ink-muted">Nada por aqui.</p>
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-admin-border bg-admin-surface-2 p-3"
            >
              <div className="text-sm font-medium text-admin-ink">
                {item.lead?.full_name ?? "Lead removido"}
              </div>
              <div className="mt-1 text-xs text-admin-ink-muted">{formatDateTime(item.due_at)}</div>
              {item.message_preview && (
                <p className="mt-2 line-clamp-3 text-sm text-admin-ink-soft">
                  {item.message_preview}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                {item.lead && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (item.lead) onOpenLead(item.lead);
                    }}
                  >
                    Abrir
                  </Button>
                )}
                {onDone && (
                  <Button size="sm" onClick={() => onDone(item.id)} className="gap-2">
                    <CheckCircle2 className="h-4 w-4" /> Feito
                  </Button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function LeadDialog({
  lead,
  users,
  columns,
  activity,
  onClose,
  onCreateFollowup,
}: {
  lead: Lead | null;
  users: Workspace["users"];
  columns: CrmColumn[];
  activity: Workspace["activity"];
  onClose: () => void;
  onCreateFollowup: (lead: Lead) => void;
}) {
  const qc = useQueryClient();
  const addNote = useServerFn(addCrmLeadNote);
  const updateOwner = useServerFn(updateCrmLeadOwner);
  const updateColumn = useServerFn(updateCrmLeadColumn);
  const updateNotes = useServerFn(updateCrmLeadNotes);
  const logWa = useServerFn(logCrmWhatsappOpened);
  const [note, setNote] = useState("");
  const [notesDraft, setNotesDraft] = useState("");

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

  if (!lead) return null;
  const temp = leadTemperature(lead);
  const phoneDigits = lead.phone.replace(/\D/g, "");
  const waText = encodeURIComponent(
    `Ola ${lead.full_name.split(" ")[0]}, aqui e da equipe do Instituto Empuria. Podemos falar sobre seu atendimento?`,
  );
  const waUrl = `https://wa.me/${phoneDigits}?text=${waText}`;

  return (
    <Dialog open={Boolean(lead)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-admin-surface sm:max-w-4xl">
        <DialogHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <DialogTitle className="font-display text-2xl">{lead.full_name}</DialogTitle>
              <DialogDescription>
                Criado em {formatDateTime(lead.created_at)} · origem {lead.source || "site"}
              </DialogDescription>
            </div>
            <Badge className={temp.cls}>{temp.label}</Badge>
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
            <Button
              className="w-full justify-start gap-2"
              variant="outline"
              onClick={() => onCreateFollowup(lead)}
            >
              <CalendarClock className="h-4 w-4" /> Criar follow-up
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: CrmColumn[];
}) {
  const saveColumnFn = useServerFn(saveCrmColumn);
  const deleteColumnFn = useServerFn(deactivateCrmColumn);
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [position, setPosition] = useState(40);
  const save = useMutation({
    mutationFn: () => saveColumnFn({ data: { label, position } }),
    onSuccess: () => {
      setLabel("");
      toast.success("Coluna salva");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao salvar coluna"),
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => deleteColumnFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Coluna desativada");
      qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao desativar coluna"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-admin-surface sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configurar colunas</DialogTitle>
          <DialogDescription>
            Colunas padrao ficam bloqueadas. Colunas personalizadas entram antes de Fechado e
            Desqualificado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {columns.map((column) => (
            <div
              key={column.id}
              className="flex items-center justify-between rounded-lg border border-admin-border bg-admin-surface-2 p-3"
            >
              <div>
                <div className="font-medium">{column.label}</div>
                <div className="text-xs text-admin-ink-muted">
                  posicao {column.position} · {column.type}
                </div>
              </div>
              {!column.is_locked && (
                <Button size="sm" variant="ghost" onClick={() => deactivate.mutate(column.id)}>
                  Desativar
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="grid gap-2 border-t border-admin-border pt-4 md:grid-cols-[1fr_120px_auto]">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Nova coluna"
            className="bg-admin-bg"
          />
          <Input
            value={position}
            type="number"
            min={31}
            max={899}
            onChange={(e) => setPosition(Number(e.target.value))}
            className="bg-admin-bg"
          />
          <Button onClick={() => save.mutate()} disabled={!label.trim() || save.isPending}>
            Adicionar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  const [messagePreview, setMessagePreview] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      createFollowupFn({
        data: {
          leadId: lead!.id,
          assignedTo: lead!.assigned_to || users[0]?.id,
          dueAt: new Date(dueAt).toISOString(),
          messagePreview,
        },
      }),
    onSuccess: () => {
      toast.success("Follow-up criado");
      setDueAt("");
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
          <Input
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            className="bg-admin-bg"
          />
          <Textarea
            value={messagePreview}
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
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserRound;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-surface p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-admin-ink-muted">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-admin-ink">{value}</div>
    </div>
  );
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

function leadTemperature(lead: Lead) {
  const answers = (lead.qualification_answers ?? {}) as Record<string, string | undefined>;
  const score =
    lead.qualification_score ??
    scoreLead(
      (answers.timeline as Parameters<typeof scoreLead>[0]) ?? null,
      (answers.budget_range as Parameters<typeof scoreLead>[1]) ?? null,
    );
  return temperatureChip(temperatureOf(score));
}

function formatDateShort(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatActivity(event: Workspace["activity"][number]) {
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
