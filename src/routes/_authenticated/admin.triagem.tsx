import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, useDraggable, useDroppable, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { listLeadsKanban, updateLeadStage } from "@/lib/admin/triagem.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, X, Mail, Phone, Globe, Calendar as CalIcon, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/triagem")({
  component: TriagemPage,
});

const STAGES = [
  { id: "novo", label: "Novos leads", tone: "border-l-blue-400" },
  { id: "analise", label: "Em análise", tone: "border-l-amber-400" },
  { id: "qualificado", label: "Qualificado", tone: "border-l-emerald-500" },
  { id: "descartado", label: "Descartado", tone: "border-l-slate-400" },
] as const;

type Stage = typeof STAGES[number]["id"];
type Lead = Awaited<ReturnType<typeof listLeadsKanban>>[number];

function TriagemPage() {
  const fetchLeads = useServerFn(listLeadsKanban);
  const updateStage = useServerFn(updateLeadStage);
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [selected, setSelected] = useState<Lead | null>(null);

  const { data: leads = [] } = useQuery({ queryKey: ["leads-kanban"], queryFn: () => fetchLeads() });

  const grouped = useMemo(() => {
    const g: Record<Stage, Lead[]> = { novo: [], analise: [], qualificado: [], descartado: [] };
    for (const l of leads) g[(l.pipeline_stage as Stage) ?? "novo"].push(l);
    return g;
  }, [leads]);

  const handleDrop = async (e: DragEndEvent) => {
    const leadId = e.active.id as string;
    const stage = e.over?.id as Stage | undefined;
    if (!stage) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.pipeline_stage === stage) return;
    qc.setQueryData<Lead[]>(["leads-kanban"], (old) =>
      old?.map((l) => (l.id === leadId ? { ...l, pipeline_stage: stage } : l)),
    );
    try {
      await updateStage({ data: { id: leadId, stage } });
      const labels: Record<Stage, string> = {
        qualificado: "Lead qualificado — agenda premium liberada.",
        descartado: "Lead descartado — e-mail do Clube enviado.",
        analise: "Movido para análise.",
        novo: "Voltou para novos.",
      };
      toast.success(labels[stage]);
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
        <p className="text-admin-ink-muted text-sm mt-1">Funil rigoroso de consultoria high-ticket. Arraste o card entre colunas.</p>
      </header>

      <DndContext sensors={sensors} onDragEnd={handleDrop}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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
      <div onClick={onClick} className="space-y-1.5">
        <div className="font-medium text-sm text-admin-ink truncate">{lead.full_name}</div>
        <div className="text-xs text-admin-ink-muted truncate">{lead.target_visa ?? "Sem visto definido"}</div>
        <div className="flex gap-2 text-[10px] uppercase tracking-wider">
          {lead.budget_range && (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">{lead.budget_range}</span>
          )}
          {lead.timeline && (
            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-900">{lead.timeline}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function LeadDetail({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">{lead.full_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field icon={Mail} label="E-mail" value={lead.email} />
                <Field icon={Phone} label="Telefone" value={lead.phone} />
                <Field icon={Globe} label="País atual" value={lead.current_country ?? "—"} />
                <Field icon={CalIcon} label="Prazo" value={lead.timeline ?? "—"} />
                <Field icon={Wallet} label="Orçamento" value={lead.budget_range ?? "—"} />
                <Field icon={Sparkles} label="Visto" value={lead.target_visa ?? "—"} />
              </div>
              {lead.message && (
                <BentoCard title="Mensagem">
                  <p className="text-sm text-admin-ink-soft whitespace-pre-wrap">{lead.message}</p>
                </BentoCard>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="ghost" onClick={onClose}><X className="h-4 w-4" /> Fechar</Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="bg-admin-surface-2 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-admin-ink-muted">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-sm text-admin-ink mt-0.5 truncate">{value}</div>
    </div>
  );
}
