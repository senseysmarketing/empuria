import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAutomations, updateAutomation } from "@/lib/admin/automacoes.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MessageCircle, Mail, Bell, Info, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/automacoes")({
  component: AutomacoesPage,
});

type Automation = Awaited<ReturnType<typeof listAutomations>>[number];

const CHANNEL_META = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "text-emerald-600 bg-emerald-50" },
  email: { label: "E-mail", icon: Mail, color: "text-blue-600 bg-blue-50" },
  painel: { label: "Painel", icon: Bell, color: "text-amber-600 bg-amber-50" },
} as const;

function AutomacoesPage() {
  const fetchList = useServerFn(listAutomations);
  const { data: automations = [] } = useQuery({ queryKey: ["automations"], queryFn: () => fetchList() });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl font-bold tracking-tight">Automações & Gatilhos</h1>
        <p className="text-admin-ink-muted text-sm mt-1">O trabalho invisível que acontece nos bastidores da operação.</p>
      </header>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 items-start">
        <Info className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900">
          <strong>Provedor não conectado.</strong> A configuração e os templates ficam salvos no painel. Quando você conectar um provedor de WhatsApp/E-mail (Twilio, Meta Cloud API, etc.), os gatilhos ativos passam a disparar automaticamente.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {automations.map((a) => (
          <AutomationCard key={a.id} automation={a} />
        ))}
      </div>
    </div>
  );
}

function AutomationCard({ automation }: { automation: Automation }) {
  const update = useServerFn(updateAutomation);
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(!!automation.is_enabled);
  const [template, setTemplate] = useState(automation.template ?? "");
  const [channel, setChannel] = useState<"whatsapp" | "email" | "painel">(automation.channel as never);
  const [saving, setSaving] = useState(false);

  const meta = CHANNEL_META[channel];
  const variables = Array.isArray(automation.variables) ? (automation.variables as string[]) : [];

  const save = async (patch: { id: string; is_enabled?: boolean; template?: string; channel?: "whatsapp" | "email" | "painel" }) => {
    setSaving(true);
    try {
      await update({ data: patch });
      qc.invalidateQueries({ queryKey: ["automations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  };

  return (
    <BentoCard>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${meta.color}`}>
              <meta.icon className="h-3 w-3" /> {meta.label}
            </span>
          </div>
          <h3 className="font-display text-lg text-admin-ink">{automation.name}</h3>
          {automation.description && <p className="text-xs text-admin-ink-muted mt-1">{automation.description}</p>}
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => { setEnabled(v); save({ id: automation.id, is_enabled: v }); }}
        />
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-admin-ink-muted">Canal</label>
          <Select value={channel} onValueChange={(v) => { setChannel(v as never); save({ id: automation.id, channel: v as never }); }}>
            <SelectTrigger className="bg-admin-surface mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="email">E-mail</SelectItem>
              <SelectItem value="painel">Painel interno</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-admin-ink-muted">Template</label>
          <Textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={3} className="mt-1 font-mono text-xs" />
          {variables.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {variables.map((v) => (
                <code key={v} className="text-[10px] bg-admin-surface-2 border border-admin-border rounded px-1.5 py-0.5">{`{{${v}}}`}</code>
              ))}
            </div>
          )}
        </div>

        <Button
          size="sm"
          variant="outline"
          disabled={saving || template === automation.template}
          onClick={() => save({ id: automation.id, template })}
        >
          <Save className="h-3 w-3" /> Salvar template
        </Button>
      </div>
    </BentoCard>
  );
}
