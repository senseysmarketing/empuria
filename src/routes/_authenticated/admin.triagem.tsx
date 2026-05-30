import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, useDraggable, useDroppable, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  listLeadsKanban,
  updateLeadStage,
  listLeadActivity,
  addLeadNote,
  logWhatsappOpened,
} from "@/lib/admin/triagem.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, Phone, Globe, Calendar as CalIcon, Wallet, MessageCircle, Clock, ArrowRight, NotebookPen, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { temperatureChip, temperatureOf, scoreLead } from "@/lib/leads/scoring";

export const Route = createFileRoute("/_authenticated/admin/triagem")({
  component: TriagemPage,
});

const STAGES = [
  { id: "novo", label: "Novos leads", tone: "border-l-blue-400" },
  { id: "em_contato", label: "Em contato", tone: "border-l-amber-400" },
  { id: "reuniao", label: "Reunião agendada", tone: "border-l-violet-500" },
  { id: "fechado", label: "Fechado", tone: "border-l-emerald-500" },
  { id: "descartado", label: "Desqualificado", tone: "border-l-slate-400" },
] as const;

type Stage = typeof STAGES[number]["id"];
type Lead = Awaited<ReturnType<typeof listLeadsKanban>>[number];

// Map legacy stages so old data still shows
function normalizeStage(s: string | null): Stage {
  if (s === "analise") return "em_contato";
  if (s === "qualificado") return "fechado";
  if (STAGES.some((x) => x.id === s)) return s as Stage;
  return "novo";
}

function leadTemperature(lead: Lead) {
  const ans = (lead.qualification_answers ?? {}) as Record<string, string | undefined>;
  const score =
    lead.qualification_score ??
    scoreLead(
      (ans.timeline as Parameters<typeof scoreLead>[0]) ?? null,
      (ans.budget_range as Parameters<typeof scoreLead>[1]) ?? null,
    );
  return temperatureChip(temperatureOf(score));
}

function TriagemPage() {
  const fetchLeads = useServerFn(listLeadsKanban);
  const updateStage = useServerFn(updateLeadStage);
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [selected, setSelected] = useState<Lead | null>(null);

  const { data: leads = [] } = useQuery({ queryKey: ["leads-kanban"], queryFn: () => fetchLeads() });

  const grouped = useMemo(() => {
    const g: Record<Stage, Lead[]> = { novo: [], em_contato: [], reuniao: [], fechado: [], descartado: [] };
    for (const l of leads) g[normalizeStage(l.pipeline_stage)].push(l);
    return g;
  }, [leads]);

  const handleDrop = async (e: DragEndEvent) => {
    const leadId = e.active.id as string;
    const stage = e.over?.id as Stage | undefined;
    if (!stage) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || normalizeStage(lead.pipeline_stage) === stage) return;
    qc.setQueryData<Lead[]>(["leads-kanban"], (old) =>
      old?.map((l) => (l.id === leadId ? { ...l, pipeline_stage: stage } : l)),
    );
    try {
      await updateStage({ data: { id: leadId, stage } });
      toast.success(`Movido para "${STAGES.find((s) => s.id === stage)?.label}"`);
      qc.invalidateQueries({ queryKey: ["lead-activity", leadId] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
      qc.invalidateQueries({ queryKey: ["leads-kanban"] });
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl font-bold tracking-tight">Triagem & Qualificação</h1>
        <p className="text-admin-ink-muted text-sm mt-1">
          Funil rigoroso de consultoria high-ticket. Arraste o card entre colunas ou clique para abrir o dossiê.
        </p>
      </header>

      <DndContext sensors={sensors} onDragEnd={handleDrop}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {STAGES.map((s) => (
            <Column key={s.id} stage={s} leads={grouped[s.id]} onOpen={setSelected} />
          ))}
        </div>
      </DndContext>

      <LeadDetail lead={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Column({ stage, leads, onOpen }: { stage: typeof STAGES[number]; leads: Lead[]; onOpen: (l: Lead) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl border border-admin-border bg-admin-surface min-h-[60vh] flex flex-col ${
        isOver ? "ring-2 ring-admin-accent" : ""
      }`}
    >
      <header className={`px-4 py-3 border-b border-admin-border border-l-4 ${stage.tone} rounded-tr-2xl`}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm uppercase tracking-wider text-admin-ink">{stage.label}</h3>
          <span className="text-xs text-admin-ink-muted tabular-nums">{leads.length}</span>
        </div>
      </header>
      <div className="p-3 space-y-2 flex-1 overflow-y-auto">
        {leads.length === 0 ? (
          <p className="text-xs text-admin-ink-muted text-center py-8">Vazio</p>
        ) : (
          leads.map((l) => <LeadCard key={l.id} lead={l} onClick={() => onOpen(l)} />)
        )}
      </div>
    </div>
  );
}

function LeadCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const temp = leadTemperature(lead);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      className={`group bg-admin-surface-2 border border-admin-border rounded-xl p-3 cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-50 shadow-lg" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      <div onClick={onClick} className="space-y-2">
        <div className="font-medium text-sm text-admin-ink truncate">{lead.full_name}</div>
        <div className="text-xs text-admin-ink-muted truncate">{lead.target_visa ?? "Sem visto definido"}</div>
        <div className="flex flex-wrap gap-1.5 text-[10px] uppercase tracking-wider">
          <span className={`px-1.5 py-0.5 rounded ${temp.cls}`}>
            {temp.icon} {temp.label}
          </span>
        </div>
      </div>
    </div>
  );
}

function LeadDetail({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  return (
    <Sheet open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto bg-admin-surface p-0"
      >
        {lead && <LeadDetailBody lead={lead} />}
      </SheetContent>
    </Sheet>
  );
}

function LeadDetailBody({ lead }: { lead: Lead }) {
  const qc = useQueryClient();
  const fetchActivity = useServerFn(listLeadActivity);
  const addNote = useServerFn(addLeadNote);
  const logWa = useServerFn(logWhatsappOpened);
  const updateStage = useServerFn(updateLeadStage);

  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const temp = leadTemperature(lead);
  const currentStage = normalizeStage(lead.pipeline_stage);

  const { data: activity = [] } = useQuery({
    queryKey: ["lead-activity", lead.id],
    queryFn: () => fetchActivity({ data: { leadId: lead.id } }),
  });

  const phoneDigits = lead.phone.replace(/\D/g, "");
  const waText = encodeURIComponent(
    `Olá ${lead.full_name.split(" ")[0]}, aqui é da equipe do Instituto Empuria. Vimos que você está planejando sua vinda para a Espanha e gostaríamos de entender melhor seu caso de ${lead.target_visa ?? "imigração"}. Tem alguns minutos para conversar?`,
  );
  const waUrl = `https://wa.me/${phoneDigits}?text=${waText}`;

  const onWhatsapp = async () => {
    window.open(waUrl, "_blank", "noopener,noreferrer");
    try {
      await logWa({ data: { leadId: lead.id } });
      qc.invalidateQueries({ queryKey: ["lead-activity", lead.id] });
    } catch {
      /* non-blocking */
    }
  };

  const onAddNote = async () => {
    const body = noteBody.trim();
    if (!body) return;
    setSavingNote(true);
    try {
      await addNote({ data: { leadId: lead.id, body } });
      setNoteBody("");
      qc.invalidateQueries({ queryKey: ["lead-activity", lead.id] });
      qc.invalidateQueries({ queryKey: ["leads-kanban"] });
      toast.success("Nota adicionada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSavingNote(false);
    }
  };

  const onStageChange = async (next: string) => {
    try {
      await updateStage({ data: { id: lead.id, stage: next as Stage } });
      qc.invalidateQueries({ queryKey: ["leads-kanban"] });
      qc.invalidateQueries({ queryKey: ["lead-activity", lead.id] });
      toast.success("Etapa atualizada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <SheetHeader className="sticky top-0 bg-admin-surface border-b border-admin-border p-6 z-10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <SheetTitle className="font-display text-2xl">{lead.full_name}</SheetTitle>
            <p className="text-xs text-admin-ink-muted mt-1">
              Entrou em {new Date(lead.created_at).toLocaleString("pt-BR")}
            </p>
          </div>
          <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded ${temp.cls}`}>
            {temp.icon} {temp.label}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-admin-ink-muted">Etapa:</span>
          <Select value={currentStage} onValueChange={onStageChange}>
            <SelectTrigger className="h-8 w-56 bg-admin-surface-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SheetHeader>

      <div className="p-6 space-y-5">
        {/* Bloco 1 — Dossier */}
        <section className="bg-admin-surface-2 rounded-xl p-4 border border-admin-border">
          <h3 className="font-display text-sm uppercase tracking-wider text-admin-ink-muted mb-3 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" /> Dossiê de qualificação
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <Field icon={Globe} label="País atual" value={lead.current_country ?? "—"} />
            <Field icon={Sparkles} label="Objetivo" value={lead.target_visa ?? "—"} />
            <Field icon={CalIcon} label="Prazo" value={lead.timeline ?? "—"} />
            <Field icon={Wallet} label="Orçamento" value={lead.budget_range ?? "—"} />
            <Field icon={Mail} label="E-mail" value={lead.email} />
            <Field icon={Phone} label="WhatsApp" value={lead.phone} />
          </div>
          {lead.message && (
            <div className="mt-3 pt-3 border-t border-admin-border">
              <div className="text-[10px] uppercase tracking-wider text-admin-ink-muted mb-1">Mensagem do lead</div>
              <p className="text-sm text-admin-ink whitespace-pre-wrap">{lead.message}</p>
            </div>
          )}
        </section>

        {/* Bloco 2 — WhatsApp */}
        <Button
          size="sm"
          onClick={onWhatsapp}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <MessageCircle className="h-4 w-4" /> Iniciar conversa no WhatsApp
          <ArrowRight className="h-4 w-4 ml-auto" />
        </Button>

        {/* Bloco 3 — Notas */}
        <section className="bg-admin-surface-2 rounded-xl p-4 border border-admin-border">
          <h3 className="font-display text-sm uppercase tracking-wider text-admin-ink-muted mb-3 flex items-center gap-2">
            <NotebookPen className="h-3.5 w-3.5" /> Notas internas
          </h3>
          <Textarea
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            placeholder="Ex.: Cliente casado com 2 filhos, precisa matricular crianças na escola na chegada."
            rows={3}
            maxLength={2000}
            className="bg-admin-surface text-sm"
          />
          <div className="flex justify-end mt-2">
            <Button onClick={onAddNote} disabled={savingNote || !noteBody.trim()} size="sm">
              {savingNote ? "Salvando..." : "Adicionar nota"}
            </Button>
          </div>
          {lead.notes && (
            <div className="mt-3 pt-3 border-t border-admin-border max-h-48 overflow-y-auto">
              <pre className="text-xs text-admin-ink-soft whitespace-pre-wrap font-body">{lead.notes}</pre>
            </div>
          )}
        </section>

        {/* Bloco 4 — Linha do tempo */}
        <section className="bg-admin-surface-2 rounded-xl p-4 border border-admin-border">
          <h3 className="font-display text-sm uppercase tracking-wider text-admin-ink-muted mb-3 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" /> Linha do tempo
          </h3>
          <ol className="relative border-l border-admin-border pl-4 space-y-3">
            {activity.length === 0 && (
              <li className="text-xs text-admin-ink-muted">Sem eventos ainda.</li>
            )}
            {activity.map((ev) => (
              <li key={ev.id} className="relative">
                <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-admin-accent ring-2 ring-admin-surface-2" />
                <div className="text-xs text-admin-ink-muted">
                  {new Date(ev.created_at).toLocaleString("pt-BR")}
                </div>
                <div className="text-sm text-admin-ink">{formatActivity(ev)}</div>
                {ev.actor_label && (
                  <div className="text-[10px] uppercase tracking-wider text-admin-ink-muted mt-0.5">
                    por {ev.actor_label}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

type Activity = Awaited<ReturnType<typeof listLeadActivity>>[number];
function formatActivity(ev: Activity): string {
  const p = (ev.payload ?? {}) as Record<string, string>;
  switch (ev.kind) {
    case "created":
      return `Lead criado pelo formulário do site${p.target_visa ? ` — ${p.target_visa}` : ""}.`;
    case "stage_changed":
      return `Etapa alterada de "${stageLabel(p.from)}" para "${stageLabel(p.to)}".`;
    case "note_added":
      return `Nota adicionada: "${(p.body ?? "").slice(0, 140)}${(p.body ?? "").length > 140 ? "…" : ""}"`;
    case "whatsapp_opened":
      return "Conversa de WhatsApp iniciada pela equipe.";
    case "meeting_scheduled":
      return "Reunião agendada.";
    default:
      return ev.kind;
  }
}

function stageLabel(id?: string) {
  return STAGES.find((s) => s.id === id)?.label ?? id ?? "—";
}

function Field({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="bg-admin-surface rounded-lg p-3 border border-admin-border/60">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-admin-ink-muted">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-sm text-admin-ink mt-0.5 truncate">{value}</div>
    </div>
  );
}
