import { createFileRoute, useNavigate, useSearch, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Settings, User, Plug, Users, Zap, FileText, Tags, Crown } from "lucide-react";
import { useModuleAccess } from "@/hooks/use-module-access";
import { PerfilContaTab } from "@/components/admin/configuracoes/PerfilContaTab";
import { IntegracoesTab } from "@/components/admin/configuracoes/IntegracoesTab";
import { EquipePermissoesTab } from "@/components/admin/configuracoes/EquipePermissoesTab";
import { ServicosPrecosTab } from "@/components/admin/configuracoes/ServicosPrecosTab";
import { AutomacoesPanel } from "@/components/admin/AutomacoesPanel";
import { LogsAuditoriaTab } from "@/components/admin/configuracoes/LogsAuditoriaTab";
import { ClubeAdminTab } from "@/components/admin/configuracoes/ClubeAdminTab";
import { RestrictedAreaCard } from "@/components/admin/RestrictedAreaCard";

const TABS = [
  "perfil",
  "integracoes",
  "equipe",
  "clube",
  "servicos-precos",
  "automacoes",
  "logs",
] as const;

type Tab = (typeof TABS)[number];

const searchSchema = z.object({
  tab: fallback(z.enum(TABS), "perfil").default("perfil"),
});

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  validateSearch: zodValidator(searchSchema),
  component: ConfiguracoesPage,
  errorComponent: ConfiguracoesErrorBoundary,
});

function ConfiguracoesErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  console.error("[ConfiguracoesPage] render error", error);
  return (
    <div className="max-w-2xl mx-auto mt-12 p-6 rounded-xl border border-admin-border bg-admin-surface text-admin-ink space-y-3">
      <h2 className="font-display text-2xl">Algo deu errado nesta aba</h2>
      <p className="text-sm text-admin-ink-muted">
        Ocorreu um erro ao renderizar Configurações. Detalhes técnicos:
      </p>
      <pre className="text-xs bg-admin-bg p-3 rounded overflow-auto max-h-48 whitespace-pre-wrap">
        {error?.message ?? String(error)}
      </pre>
      <Button onClick={() => { router.invalidate(); reset(); }} className="bg-admin-accent text-white">
        Tentar novamente
      </Button>
    </div>
  );
}

function ConfiguracoesPage() {
  const { tab } = useSearch({ from: "/_authenticated/admin/configuracoes" });
  const navigate = useNavigate();
  const { isAdmin, can, isLoading } = useModuleAccess();

  const setTab = (t: Tab) =>
    navigate({ to: "/admin/configuracoes", search: { tab: t }, replace: true });

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-admin-surface border border-admin-border flex items-center justify-center">
          <Settings className="h-6 w-6 text-admin-accent" />
        </div>
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Configurações</h1>
          <p className="text-admin-ink-muted text-sm mt-1">
            Perfil, integrações, permissões, PDV, automações e auditoria.
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="bg-admin-surface border border-admin-border h-auto flex-wrap gap-1 p-1">
          <TabsTrigger
            value="perfil"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <User className="h-4 w-4" /> Perfil &amp; Conta
          </TabsTrigger>
          <TabsTrigger
            value="integracoes"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <Plug className="h-4 w-4" /> Integrações
          </TabsTrigger>
          <TabsTrigger
            value="equipe"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <Users className="h-4 w-4" /> Equipe &amp; Permissões
          </TabsTrigger>
          <TabsTrigger
            value="clube"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <Crown className="h-4 w-4" /> Clube do Imigrante
          </TabsTrigger>

          <TabsTrigger
            value="servicos-precos"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <Tags className="h-4 w-4" /> Serviços &amp; Preços
          </TabsTrigger>
          <TabsTrigger
            value="automacoes"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <Zap className="h-4 w-4" /> Automações
          </TabsTrigger>
          <TabsTrigger
            value="logs"
            className="gap-2 data-[state=active]:bg-admin-accent data-[state=active]:text-white"
          >
            <FileText className="h-4 w-4" /> Logs &amp; Auditoria
          </TabsTrigger>
        </TabsList>

        <TabsContent value="perfil" className="mt-6">
          <PerfilContaTab />
        </TabsContent>
        <TabsContent value="integracoes" className="mt-6">
          {isLoading ? null : can("configuracoes") ? (
            <IntegracoesTab />
          ) : (
            <RestrictedAreaCard message="Apenas membros com acesso a Configurações podem ver as integrações." />
          )}
        </TabsContent>
        <TabsContent value="equipe" className="mt-6">
          {isAdmin ? (
            <EquipePermissoesTab />
          ) : (
            <RestrictedAreaCard message="Apenas administradores podem gerenciar a equipe e permissões." />
          )}
        </TabsContent>
        <TabsContent value="clube" className="mt-6">
          {isLoading ? null : can("clube") ? (
            <ClubeAdminTab />
          ) : (
            <RestrictedAreaCard message="Apenas membros com acesso ao módulo Clube podem gerenciar conteúdos e comunicados." />
          )}
        </TabsContent>

        <TabsContent value="servicos-precos" className="mt-6">
          {isLoading ? null : can("configuracoes") ? (
            <ServicosPrecosTab />
          ) : (
            <RestrictedAreaCard message="Apenas membros com acesso a Configurações podem gerenciar serviços e preços." />
          )}
        </TabsContent>
        <TabsContent value="automacoes" className="mt-6">
          {isLoading ? null : can("automacoes") ? (
            <AutomacoesPanel />
          ) : (
            <RestrictedAreaCard message="Apenas membros com acesso ao módulo Automações podem configurar gatilhos." />
          )}
        </TabsContent>
        <TabsContent value="logs" className="mt-6">
          {isAdmin ? (
            <LogsAuditoriaTab />
          ) : (
            <RestrictedAreaCard message="Apenas administradores podem visualizar os logs de auditoria." />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
