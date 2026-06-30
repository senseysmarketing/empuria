import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Wine, History, Package, ReceiptText, BarChart3 } from "lucide-react";
import { PdvHistoryPanel } from "@/components/admin/pdv/PdvHistoryPanel";
import { PdvTabsPanel } from "@/components/admin/pdv/PdvTabsPanel";
import { PdvItensTab } from "@/components/admin/configuracoes/PdvItensTab";
import { RestrictedAreaCard } from "@/components/admin/RestrictedAreaCard";
import { useModuleAccess } from "@/hooks/use-module-access";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PdvReportView } from "@/components/admin/relatorios/PdvReportView";
import { BentoCard } from "@/components/admin/BentoCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { ReportFilters } from "@/lib/admin/reports.functions";

export const Route = createFileRoute("/_authenticated/admin/pdv")({
  component: PdvPage,
});

type ReportPeriod = ReportFilters["period"];
type ReportCompare = ReportFilters["compare"];

const PERIOD_LABEL: Record<ReportPeriod, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Este mês",
  last_month: "Mês anterior",
  custom: "Personalizado",
};

const COMPARE_LABEL: Record<ReportCompare, string> = {
  none: "Sem comparação",
  prev_period: "Período anterior",
  prev_month: "Mesmo período do mês passado",
};

function PdvPage() {
  const [tab, setTab] = useState("comandas");
  const { can, isAdmin } = useModuleAccess();
  const canItens = isAdmin || can("pdv_itens");

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-orange-brand/20 flex items-center justify-center">
          <Wine className="h-6 w-6 text-orange-brand" />
        </div>
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">PDV Empuria</h1>
          <p className="text-admin-ink-muted text-sm mt-1">
            Comandas · Caixa · Instituto
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="bg-admin-surface border border-admin-border">
          <TabsTrigger
            value="comandas"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <ReceiptText className="h-4 w-4" /> Comandas
          </TabsTrigger>
          <TabsTrigger
            value="historico"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <History className="h-4 w-4" /> Historico
          </TabsTrigger>
          <TabsTrigger
            value="relatorio"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <BarChart3 className="h-4 w-4" /> Relatório
          </TabsTrigger>
          {canItens && (
            <TabsTrigger
              value="itens"
              className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
            >
              <Package className="h-4 w-4" /> Itens
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="comandas" className="mt-0">
          <PdvTabsPanel />
        </TabsContent>

        <TabsContent value="historico" className="mt-0">
          <PdvHistoryPanel />
        </TabsContent>

        <TabsContent value="relatorio" className="mt-0">
          <PdvReportPanel />
        </TabsContent>

        <TabsContent value="itens" className="mt-0">
          {canItens ? (
            <PdvItensTab />
          ) : (
            <RestrictedAreaCard message="Apenas membros com acesso ao módulo PDV Itens podem gerenciar este catálogo." />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PdvReportPanel() {
  const [period, setPeriod] = useState<ReportPeriod>("30d");
  const [compare, setCompare] = useState<ReportCompare>("prev_period");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const filters: ReportFilters = useMemo(
    () => ({
      period,
      compare,
      currency: "EUR",
      from: period === "custom" ? from || undefined : undefined,
      to: period === "custom" ? to || undefined : undefined,
    }),
    [period, compare, from, to],
  );

  return (
    <div className="space-y-4">
      <BentoCard padded>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:flex-wrap">
          <Select value={period} onValueChange={(v) => setPeriod(v as ReportPeriod)}>
            <SelectTrigger className="bg-admin-bg w-full md:w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(PERIOD_LABEL) as [ReportPeriod, string][]).map(([k, l]) => (
                <SelectItem key={k} value={k}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {period === "custom" && (
            <div className="grid grid-cols-2 gap-2 md:w-[320px]">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-admin-bg" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-admin-bg" />
            </div>
          )}

          <Select value={compare} onValueChange={(v) => setCompare(v as ReportCompare)}>
            <SelectTrigger className="bg-admin-bg w-full md:w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(COMPARE_LABEL) as [ReportCompare, string][]).map(([k, l]) => (
                <SelectItem key={k} value={k}>Comparar: {l}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="text-xs text-admin-ink-muted md:ml-auto">
            Os dados são exibidos em euros (€).
          </div>
        </div>
      </BentoCard>

      <PdvReportView filters={filters} />
    </div>
  );
}
