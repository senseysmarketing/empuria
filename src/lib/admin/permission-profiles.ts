import type { ModuleKey, ActionKey } from "./permissions.functions";

export type ProfileKey =
  | "recepcao_pdv"
  | "comercial"
  | "operacao"
  | "financeiro"
  | "gestor"
  | "personalizado";

export const PROFILE_LABELS: Record<ProfileKey, string> = {
  recepcao_pdv: "Recepção / PDV",
  comercial: "Comercial",
  operacao: "Operação",
  financeiro: "Financeiro",
  gestor: "Gestor",
  personalizado: "Personalizado",
};

export const PROFILE_DESCRIPTIONS: Record<ProfileKey, string> = {
  recepcao_pdv: "Caixa, agenda e eventos do dia a dia.",
  comercial: "CRM, follow-ups, agenda e esteira comercial.",
  operacao: "PDV, agenda, eventos e esteira operacional.",
  financeiro: "Acesso a financeiro e relatórios.",
  gestor: "Visão ampla de operação, comercial e financeiro.",
  personalizado: "Combinação ajustada manualmente.",
};

export const PROFILE_MODULES: Record<Exclude<ProfileKey, "personalizado">, ModuleKey[]> = {
  recepcao_pdv: ["cockpit", "pdv", "agenda", "eventos"],
  comercial: ["cockpit", "crm", "agenda", "esteira"],
  operacao: ["cockpit", "pdv", "agenda", "eventos", "esteira"],
  financeiro: ["cockpit", "financeiro", "relatorios"],
  gestor: [
    "cockpit",
    "pdv",
    "crm",
    "agenda",
    "eventos",
    "esteira",
    "financeiro",
    "relatorios",
    "usuarios",
    "clube",
  ],
};

export function detectProfile(modules: string[]): ProfileKey {
  const set = new Set(modules);
  for (const [key, mods] of Object.entries(PROFILE_MODULES)) {
    if (mods.length !== set.size) continue;
    if (mods.every((m) => set.has(m))) return key as ProfileKey;
  }
  return "personalizado";
}

export type PermissionGroup = {
  key: string;
  label: string;
  description: string;
  modules: ModuleKey[];
  actions?: { key: ActionKey; label: string; description?: string }[];
  tone?: "default" | "sensitive";
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "essencial",
    label: "Essencial",
    description: "Acesso base que todo membro da equipe deve ter.",
    modules: ["cockpit", "agenda"],
  },
  {
    key: "operacao",
    label: "Operação",
    description: "Caixa, atendimento físico e fluxo do dia.",
    modules: ["pdv", "eventos", "esteira"],
    actions: [
      {
        key: "pdv.void_sale",
        label: "Anular venda",
        description: "Permite cancelar vendas do PDV e reverter estoque.",
      },
      {
        key: "pdv.remove_tab_item",
        label: "Remover item de comanda",
        description: "Permite remover itens salvos em comandas abertas com motivo auditado.",
      },
      {
        key: "pdv.cancel_tab",
        label: "Cancelar comanda",
        description: "Permite cancelar uma comanda inteira e liberar as reservas de estoque.",
      },
    ],
  },
  {
    key: "comercial",
    label: "Comercial",
    description: "CRM, follow-ups e relacionamento.",
    modules: ["crm", "clube"],
    actions: [
      {
        key: "crm.view_all_leads",
        label: "Ver todos os leads",
        description: "Acesso aos leads de toda equipe (visão de gestor).",
      },
      {
        key: "crm.automations.view",
        label: "Ver automações",
        description: "Visualiza fluxos, próximos envios e histórico de automações.",
      },
      {
        key: "crm.automations.manage",
        label: "Gerenciar automações",
        description: "Cria, edita, ativa e arquiva fluxos de WhatsApp do CRM.",
      },
      {
        key: "crm.automations.pause",
        label: "Pausar automações",
        description: "Permite interromper fluxos ativos quando necessário.",
      },
      {
        key: "crm.automations.logs",
        label: "Ver logs de automações",
        description: "Acessa auditoria de envios, respostas, erros e reagendamentos.",
      },
      {
        key: "crm.automations.cancel_pending_action",
        label: "Cancelar envio pendente",
        description: "Cancela um envio automatico antes da execução.",
      },
    ],
  },
  {
    key: "gestao",
    label: "Gestão",
    description: "Financeiro, relatórios e usuários.",
    modules: ["financeiro", "relatorios", "usuarios", "slots"],
    tone: "sensitive",
  },
  {
    key: "configuracoes_avancadas",
    label: "Configurações avançadas",
    description: "Áreas sensíveis: integrações, automações e auditoria.",
    modules: ["configuracoes", "pdv_itens", "automacoes", "logs"],
    tone: "sensitive",
  },
];

export const LOCKED_BASE_MODULES: ModuleKey[] = ["cockpit"];
