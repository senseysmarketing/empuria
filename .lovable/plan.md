
# Central de Pedidos & Vendas — /admin/esteira

Implementação em 4 fases. Sem integração real com Mercado Pago nesta rodada (apenas campos + botão "Gerar link" como stub preparado para a API depois — assim que o usuário fornecer as credenciais).

---

## Fase 1 — Reorganização visual da Esteira

Arquivos: `src/routes/_authenticated/admin.esteira.tsx`, `src/lib/admin/esteira.functions.ts`.

- Renomear título "Esteira 1" → **"Central de Pedidos"** com subtítulo "Pedidos do site, vendas no WhatsApp, consultorias e compromissos comerciais".
- Substituir filtro por chips: Todos · Pendentes · Aguardando pagamento · Pagos · Em execução · Concluídos · Cancelados · Estornados.
- Cards de resumo no topo (visíveis a admin; staff vê só operação):
  - Pedidos hoje · Aguardando pagamento · Pagos hoje · Em execução · Atrasados · Receita BRL · Receita EUR.
- Separar visualmente **status de pagamento** e **status de execução** (`delivery_status`) na tabela.
- Manter regra atual: financeiro só para admin (`canViewFinancials`).
- Adicionar modal completo de pedido (abre ao clicar na linha) com abas:
  Resumo · Pagamento · Cliente · Serviço · Agenda · Documentos · Histórico · Notas internas.
- Ações rápidas no modal: Gerar link de pagamento · Copiar link · Marcar pago manualmente (com motivo) · Criar compromisso · Reagendar · Marcar executado · Cancelar · Estornar · Enviar voucher.

## Fase 2 — Pedido manual inteligente (modal "Criar pedido")

Arquivos: novo `src/components/admin/esteira/NewOrderWizard.tsx`, `src/lib/admin/esteira.functions.ts` (novas funções), `src/lib/admin/customers.functions.ts` (novo).

Wizard em 4 etapas:

1. **Cliente** — busca por nome/e-mail/telefone em `profiles`. Se encontrar → vincula `user_id`. Se não → cria perfil (sem senha; futuramente magic link/convite). E-mail é obrigatório quando o cliente precisa ver o pedido no portal; sem e-mail mostra aviso "Pedido não aparecerá no portal".
2. **Serviço** — Select de `services` (puxa preço, moeda, duração, requires_slot, checklist) OU "Serviço avulso" (título + valor livres).
3. **Valor & moeda** — `amount_cents` + `currency` (EUR/BRL) e, separadamente, `payment_amount_cents` + `payment_currency` (BRL para MP). Campos `fx_rate`, `fx_source`, `fx_locked_at` editáveis quando moedas divergem.
4. **Agenda & pagamento** — opcional: data/hora + slot (se exigido). Escolher: gerar link MP / marcar como pago manualmente (exige motivo) / pedido gratuito (R$ 0,00 com confirmação explícita "Este pedido será criado gratuito. Confirmar?").

Regras:
- Pedido gratuito → `payment_status='aprovado'`, `payment_method='gratuito'`, log em `audit_logs`.
- Pagamento manual → exige permissão admin + motivo, log em `audit_logs`.
- Sempre tenta resolver `user_id`; sem `user_id` exibe aviso.

## Fase 3 — Integração Agenda ↔ Pedido

Arquivos: `src/lib/admin/agenda.functions.ts`, `src/components/admin/agenda/AppointmentDialog.tsx`, `src/routes/_authenticated/admin.agenda.tsx`.

- Adicionar `appointments.order_id` (FK opcional → `orders.id`).
- No `AppointmentDialog`, quando o usuário escolhe **cliente + serviço**, oferecer dois caminhos:
  - "Vincular a pedido existente" (lista pedidos pendentes/abertos do cliente).
  - "Criar pedido junto" (abre wizard da Fase 2 reaproveitado e cria order + appointment na mesma transação).
- Compromisso interno (sem cliente/serviço) continua permitido como anotação livre.
- Na Esteira (modal), aba **Agenda** lista appointments vinculados.
- Na Agenda, pill do compromisso vinculado mostra ícone de pedido e link "Abrir pedido".

## Fase 4 — Preparação Mercado Pago (estrutura, sem chamar API)

Campos novos em `orders`: `payment_provider`, `payment_provider_reference`, `payment_url`, `payment_expires_at`, `payment_currency`, `payment_amount_cents`, `payment_metadata`, `paid_at`, `payment_method`.

- Botão "Gerar link de pagamento" cria placeholder local (`payment_provider='mercadopago'`, `payment_url=null`) e mostra mensagem "Integração Mercado Pago — em breve. Configure as credenciais para ativar".
- Webhook `/api/public/mercadopago` cria a rota com verificação de assinatura HMAC (placeholder de secret) e atualização de `payment_status`. Real ativação fica para quando o usuário fornecer `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` via Secrets.
- Helper reaproveitável em `src/lib/checkout/order-core.ts`: `attachOrCreateCustomer`, `createOrderForService`, `reserveSlotIfNeeded`, `createPaymentLink` (stub) — usado tanto pelo checkout do site quanto pela Esteira.

---

## Detalhes técnicos

### Migrações SQL

```text
ALTER TABLE orders
  ADD COLUMN payment_provider text,
  ADD COLUMN payment_provider_reference text,
  ADD COLUMN payment_url text,
  ADD COLUMN payment_expires_at timestamptz,
  ADD COLUMN payment_currency text,
  ADD COLUMN payment_amount_cents integer,
  ADD COLUMN payment_metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN payment_method text,
  ADD COLUMN fx_rate numeric,
  ADD COLUMN fx_source text,
  ADD COLUMN fx_locked_at timestamptz;

ALTER TABLE appointments
  ADD COLUMN order_id uuid REFERENCES orders(id) ON DELETE SET NULL;
CREATE INDEX ON appointments(order_id);
```

RLS de `orders`/`appointments` permanece (staff via `is_staff()`).

### Novas server functions

- `searchCustomers({ q })` → busca perfis por nome/email/telefone.
- `createCustomerLite({ name, email, phone })` → cria profile sem auth user (placeholder `user_id=null` em profiles ou via convite — decisão de implementação na fase 2).
- `createOrderFull(input)` substitui `createOrder` atual, recebendo todo o payload do wizard e gravando `user_id`, valores duplos (comercial + cobrança), `payment_method`, log em `audit_logs`.
- `markOrderPaidManual({ id, reason })`, `cancelOrder`, `refundOrder`, `generatePaymentLink` (stub).
- `linkAppointmentToOrder({ appointmentId, orderId })`.

### Regras obrigatórias (espelho do PDF §21)

- Todo pedido manual tenta vincular/criar `user_id`.
- Compromisso com cliente+serviço deve resultar em pedido.
- Link de pagamento sempre vinculado a `orders.id`.
- Pagamento manual exige motivo + log.
- Pedido gratuito exige confirmação + log.
- Reserva de slot ocorre na mesma transação do pedido.
- Toda mudança financeira → `audit_logs`.

### Fora de escopo nesta rodada

- Chamada real à API do Mercado Pago (preferences, webhook live).
- Conversão FX automática (taxa será informada manualmente).
- Relatórios financeiros consolidados (planejados após Fase 4).
