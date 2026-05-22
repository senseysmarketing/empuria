const STEPS: Record<string, { key: string; label: string }[]> = {
  banking: [
    { key: "aguardando_documentos", label: "Documentação" },
    { key: "processando", label: "Tratativa" },
    { key: "agendado", label: "Agendado" },
    { key: "concluido", label: "Concluído" },
  ],
  consulting: [
    { key: "aguardando_documentos", label: "Documentação" },
    { key: "processando", label: "Em análise" },
    { key: "concluido", label: "Aprovado" },
  ],
  default: [
    { key: "aguardando_pagamento", label: "Pagamento" },
    { key: "aguardando_documentos", label: "Recebimento" },
    { key: "processando", label: "Em atendimento" },
    { key: "concluido", label: "Concluído" },
  ],
};

export function ServiceProgressBar({ kind, status }: { kind?: string | null; status: string }) {
  const steps = STEPS[kind ?? "default"] ?? STEPS.default;
  const idx = steps.findIndex((s) => s.key === status);

  return (
    <div className="flex items-center gap-1.5">
      {steps.map((s, i) => {
        const reached = i <= idx;
        return (
          <div key={s.key} className="flex-1">
            <div
              className={`h-1.5 rounded-full transition-colors ${
                reached ? "bg-admin-accent" : "bg-admin-border"
              }`}
            />
            <div
              className={`text-[9px] mt-1.5 uppercase tracking-wider font-display truncate ${
                reached ? "text-admin-accent" : "text-admin-ink-muted"
              }`}
            >
              {s.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
