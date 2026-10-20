export type CrmTemplateValues = {
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
  objetivo?: string | null;
  servico?: string | null;
  responsavel?: string | null;
  etapa?: string | null;
};

const allowed = new Set([
  "nome",
  "primeiro_nome",
  "telefone",
  "email",
  "objetivo",
  "servico",
  "serviço",
  "responsavel",
  "etapa",
]);

export function renderCrmAutomationTemplate(template: string, values: CrmTemplateValues): string {
  return template.replace(/\{\{?\s*([^{}]+?)\s*\}\}?/g, (_token, rawName: string) => {
    const name = rawName.trim().toLowerCase();
    if (!allowed.has(name)) throw new Error(`Variavel desconhecida: ${name}`);
    const value =
      name === "primeiro_nome"
        ? values.nome?.trim().split(/\s+/)[0]
        : name === "serviço"
          ? values.servico
          : values[name as keyof CrmTemplateValues];
    if (!value?.trim()) throw new Error(`Variavel sem dado para este lead: ${name}`);
    return value.trim();
  });
}
