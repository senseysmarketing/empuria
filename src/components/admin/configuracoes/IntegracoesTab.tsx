import { BentoCard } from "@/components/admin/BentoCard";
import { CreditCard, Crown, MessageCircle } from "lucide-react";

const INTEGRATIONS = [
  {
    key: "mercadopago",
    name: "Mercado Pago",
    icon: CreditCard,
    accent: "from-sky-500/20 to-sky-500/0 text-sky-300",
    description: "Pagamentos, Pix, checkout e confirmação automática de pedidos.",
  },
  {
    key: "hubla",
    name: "Hubla",
    icon: Crown,
    accent: "from-amber-500/20 to-amber-500/0 text-amber-300",
    description: "Assinatura do Clube do Imigrante e liberação automática de acesso.",
  },
  {
    key: "whatsapp",
    name: "WhatsApp",
    icon: MessageCircle,
    accent: "from-emerald-500/20 to-emerald-500/0 text-emerald-300",
    description: "Conexão para notificações, automações e mensagens operacionais.",
  },
] as const;

export function IntegracoesTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-admin-ink-muted">
        As integrações abaixo estão em planejamento. Nenhuma credencial ou webhook é necessária por enquanto.
      </p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((i) => (
          <BentoCard key={i.key} className="relative">
            <div className={`absolute inset-0 bg-gradient-to-br ${i.accent} pointer-events-none rounded-2xl opacity-60`} />
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className={`h-11 w-11 rounded-xl bg-admin-bg border border-admin-border flex items-center justify-center ${i.accent.split(" ").pop()}`}>
                  <i.icon className="h-5 w-5" />
                </div>
                <span className="text-[10px] uppercase tracking-wider font-display px-2 py-1 rounded-full bg-admin-bg border border-admin-border text-admin-ink-muted">
                  Em breve
                </span>
              </div>
              <h3 className="font-display text-lg text-admin-ink mb-1">{i.name}</h3>
              <p className="text-xs text-admin-ink-muted leading-relaxed">{i.description}</p>
            </div>
          </BentoCard>
        ))}
      </div>
    </div>
  );
}
