import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Settings, User, Plug, Users, ShoppingCart, Zap, FileText } from "lucide-react";
import { useModuleAccess } from "@/hooks/use-module-access";
import { PerfilContaTab } from "@/components/admin/configuracoes/PerfilContaTab";
import { IntegracoesTab } from "@/components/admin/configuracoes/IntegracoesTab";
import { EquipePermissoesTab } from "@/components/admin/configuracoes/EquipePermissoesTab";
import { PdvItensTab } from "@/components/admin/configuracoes/PdvItensTab";
import { AutomacoesPanel } from "@/components/admin/AutomacoesPanel";
import { LogsAuditoriaTab } from "@/components/admin/configuracoes/LogsAuditoriaTab";

const TABS = ["perfil", "integracoes", "equipe", "pdv-itens", "automacoes", "logs"] as const;
type Tab = (typeof TABS)[number];

const searchSchema = z.object({
  tab: fallback(z.enum(TABS), "perfil").default("perfil"),
});

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  validateSearch: zodValidator(searchSchema),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const { tab } = useSearch({ from: "/_authenticated/admin/configuracoes" });
  const navigate = useNavigate();
  const { isAdmin } = useModuleAccess();

  const setTab = (t: Tab) => navigate({ to: "/admin/configuracoes", search: { tab: t }, replace: true });

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-admin-surface border border-admin-border flex items-center justify-center">
          <Settings className="h-6 w-6 text-admin-accent" />
        </div>
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Configurações</h1>
          <p className="text-admin-ink-muted text-sm mt-1">Perfil, integrações, permissões, PDV, automações e auditoria.</p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="bg-admin-surface border border-admin-border h-auto flex-wrap gap-1 p-1">
          <TabsTrigger value="perfil" className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white">
            <User className="h-4 w-4" /> Perfil &amp; Conta
          </TabsTrigger>
          <TabsTrigger value="integracoes" className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white">
            <Plug className="h-4 w-4" /> Integrações
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="equipe" className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white">
              <Users className="h-4 w-4" /> Equipe &amp; Permissões
            </TabsTrigger>
          )}
          <TabsTrigger value="pdv-itens" className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white">
            <ShoppingCart className="h-4 w-4" /> PDV Itens
          </TabsTrigger>
          <TabsTrigger value="automacoes" className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white">
            <Zap className="h-4 w-4" /> Automações
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="logs" className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white">
              <FileText className="h-4 w-4" /> Logs &amp; Auditoria
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="perfil" className="mt-6"><PerfilContaTab /></TabsContent>
        <TabsContent value="integracoes" className="mt-6"><IntegracoesTab /></TabsContent>
        {isAdmin && <TabsContent value="equipe" className="mt-6"><EquipePermissoesTab /></TabsContent>}
        <TabsContent value="pdv-itens" className="mt-6"><PdvItensTab /></TabsContent>
        <TabsContent value="automacoes" className="mt-6"><AutomacoesPanel /></TabsContent>
        {isAdmin && <TabsContent value="logs" className="mt-6"><LogsAuditoriaTab /></TabsContent>}
      </Tabs>
    </div>
  );
}
