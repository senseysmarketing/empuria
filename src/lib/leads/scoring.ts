export type Timeline = "ate_3m" | "3_6m" | "6_12m" | "mais_12m";
export type Budget = "ate_2k" | "2_5k" | "5_10k" | "mais_10k";
export type Temperature = "alta" | "media" | "baixa";

export const TIMELINE_LABEL: Record<Timeline, string> = {
  ate_3m: "Em até 3 meses",
  "3_6m": "3 a 6 meses",
  "6_12m": "6 a 12 meses",
  mais_12m: "Mais de 12 meses",
};

export const BUDGET_LABEL: Record<Budget, string> = {
  ate_2k: "Até €2.000",
  "2_5k": "€2.000 a €5.000",
  "5_10k": "€5.000 a €10.000",
  mais_10k: "Acima de €10.000",
};

export const COUNTRY_LABEL: Record<string, string> = {
  espanha: "Já estou na Espanha",
  brasil: "Ainda estou no Brasil",
  europa: "Outro país da Europa",
  outro: "Outro país",
};

export const VISA_LABEL: Record<string, string> = {
  residencia: "Visto de Residência",
  cidadania: "Cidadania",
  relocation: "Relocation completo",
  outros: "Outros",
};

export function scoreLead(timeline: Timeline | null, budget: Budget | null): number {
  const t: Record<Timeline, number> = { ate_3m: 40, "3_6m": 25, "6_12m": 10, mais_12m: 0 };
  const b: Record<Budget, number> = { mais_10k: 40, "5_10k": 25, "2_5k": 15, ate_2k: 5 };
  return (timeline ? t[timeline] : 0) + (budget ? b[budget] : 0);
}

export function temperatureOf(score: number): Temperature {
  if (score >= 60) return "alta";
  if (score >= 30) return "media";
  return "baixa";
}

export function temperatureChip(temp: Temperature) {
  if (temp === "alta") return { icon: "🔥", label: "Alta urgência", cls: "bg-orange-100 text-orange-900" };
  if (temp === "media") return { icon: "⚡", label: "Média", cls: "bg-amber-100 text-amber-900" };
  return { icon: "❄️", label: "Baixa", cls: "bg-slate-100 text-slate-700" };
}
