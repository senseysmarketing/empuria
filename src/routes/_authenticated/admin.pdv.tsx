import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Wine, History, Package, ReceiptText } from "lucide-react";
import { PdvHistoryPanel } from "@/components/admin/pdv/PdvHistoryPanel";
import { PdvTabsPanel } from "@/components/admin/pdv/PdvTabsPanel";
import { PdvItensTab } from "@/components/admin/configuracoes/PdvItensTab";
import { RestrictedAreaCard } from "@/components/admin/RestrictedAreaCard";
import { useModuleAccess } from "@/hooks/use-module-access";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/pdv")({
  component: PdvPage,
});

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
