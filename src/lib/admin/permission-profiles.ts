import type { ModuleKey } from "./permissions.functions";

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
  comingSoon?: { key: string; label: string }[];
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
    comingSoon: [
      { key: "pdv.manage_items", label: "Gerenciar itens e estoque" },
      { key: "pdv.void_sale", label: "Anular venda" },
    ],
  },
  {
    key: "comercial",
    label: "Comercial",
    description: "CRM, follow-ups e relacionamento.",
    modules: ["crm", "triagem", "clube"],
    comingSoon: [{ key: "crm.view_all_leads", label: "Ver todos os leads (gestor)" }],
  },
  {
    key: "gestao",
    label: "Gestão",
    description: "Financeiro, relatórios e usuários.",
    modules: ["financeiro", "relatorios", "usuarios", "slots"],
    tone: "sensitive",
    comingSoon: [
      { key: "reports.export", label: "Exportar relatórios" },
      { key: "financeiro.create_entry", label: "Criar lançamento financeiro" },
    ],
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
