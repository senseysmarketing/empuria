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
  operacao: "PDV, agenda, eventos, esteira e CRM (baseline operacional).",
  financeiro: "Baseline + acesso a financeiro e relatórios.",
  gestor: "Visão ampla de operação, comercial e financeiro.",
  personalizado: "Combinação ajustada manualmente.",
};

/** Módulos que todo staff recebe automaticamente ao ser criado. */
export const BASELINE_MODULES: ModuleKey[] = [
  "cockpit",
  "agenda",
  "pdv",
  "esteira",
  "eventos",
  "crm",
  "clube",
];

export const PROFILE_MODULES: Record<Exclude<ProfileKey, "personalizado">, ModuleKey[]> = {
  recepcao_pdv: ["cockpit", "agenda", "pdv", "eventos"],
  comercial: ["cockpit", "agenda", "crm", "esteira", "clube"],
  operacao: [...BASELINE_MODULES],
  financeiro: [...BASELINE_MODULES, "financeiro", "relatorios"],
  gestor: [
    ...BASELINE_MODULES,
    "financeiro",
    "relatorios",
    "usuarios",
    "slots",
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
  tone?: "default" | "sensitive";
  defaultOpen?: boolean;
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "essencial",
    label: "Essencial",
    description: "Acesso base liberado para toda a equipe.",
    modules: ["cockpit", "agenda"],
    defaultOpen: true,
  },
  {
    key: "operacao",
    label: "Operação",
    description: "PDV, eventos e esteira — atendimento e vendas do dia.",
    modules: ["pdv", "eventos", "esteira"],
    defaultOpen: true,
  },
  {
    key: "comercial",
    label: "Comercial",
    description: "CRM, clube e automações de relacionamento.",
    modules: ["crm", "clube", "automacoes"],
    defaultOpen: true,
  },
  {
    key: "gestao",
    label: "Gestão (sensível)",
    description: "Financeiro, relatórios, usuários e slots.",
    modules: ["financeiro", "relatorios", "usuarios", "slots"],
    tone: "sensitive",
    defaultOpen: false,
  },
  {
    key: "configuracoes_avancadas",
    label: "Configurações avançadas (sensível)",
    description: "Integrações, cadastro de itens, auditoria e conciliações.",
    modules: ["configuracoes", "pdv_itens", "logs", "conciliacoes_wise"],
    tone: "sensitive",
    defaultOpen: false,
  },
];

export const LOCKED_BASE_MODULES: ModuleKey[] = ["cockpit", "agenda"];
