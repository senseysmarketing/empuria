export const WHATSAPP_NUMBER = "34613762500";
export const WHATSAPP_DISPLAY = "+34 613 76 25 00";
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

export function whatsappLeadUrl(firstName: string) {
  const text = `Olá! Me chamo ${firstName} e acabei de preencher o formulário de consultoria no site do Instituto Empuria. Gostaria de dar continuidade ao meu atendimento.`;
  return `${WHATSAPP_URL}?text=${encodeURIComponent(text)}`;
}
