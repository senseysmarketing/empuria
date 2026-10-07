const ORIGINS: Record<string, string> = {
  manual: "Manual",
  orders: "Esteira",
  pdv: "PDV",
  team_payout: "Equipe / Repasses",
  partner_distribution: "Distribuição de lucros",
  month_adjustment: "Ajuste de fechamento",
};

export function financeOriginLabel(sourceModule: string) {
  if (sourceModule.startsWith("recurring:")) return "Recorrência";
  return ORIGINS[sourceModule] ?? sourceModule;
}
