## Objetivo
Habilitar cobrança via Wise para comandas do PDV, com fluxo "aguardando pagamento" e confirmação automática por webhook. Substituir cartão/pix por **Dinheiro**, **Transferência bancária** e **Wise** como métodos do PDV.

## 1. Banco de dados (1 migração)

### 1.1 Novos métodos de pagamento e status de comanda
- Atualizar checks da `pdv_sales.payment_method` e `pdv_tabs` para aceitar: `dinheiro`, `transferencia`, `wise` (manter `cartao`/`pix` legados só leitura para vendas antigas).
- Adicionar status `aguardando_pagamento` ao enum/check de `pdv_tabs.status`.
- Adicionar colunas em `pdv_tabs`:
  - `payment_method text` (método escolhido no fechamento)
  - `awaiting_payment_at timestamptz`
  - `pending_sale_snapshot jsonb` (totais/desconto congelados ao gerar link)
  - `active_payment_attempt_id uuid`

### 1.2 Tabela `pdv_payment_attempts`
Campos: `id`, `tab_id`, `sale_id` (nullable), `provider` ('wise'), `reference` (único, formato `PDV-CMD-XXXXXXXX-Ax`), `amount_eur_cents`, `currency` ('EUR'), `payment_url`, `status` (`waiting_payment|paid|cancelled|expired|pending_conciliation|failed`), `raw_request jsonb`, `raw_webhook jsonb`, `created_by`, `created_at`, `paid_at`, `cancelled_at`, `cancel_reason`, `phone_snapshot`. GRANTs + RLS (staff/admin via has_module_access('pdv')); índices em `reference` e `tab_id`.

### 1.3 Funções RPC
- `pdv_request_wise_payment(p_tab_id, p_actor_id, p_discount_type, p_discount_value, p_notes)` — calcula totais, gera referência `PDV-CMD-<tab_code_curto>-A<N>` (N = contador de tentativas da comanda), cria `pdv_payment_attempts` (waiting_payment), seta `pdv_tabs.status='aguardando_pagamento'`, mantém reserva de estoque, NÃO cria `pdv_sales`. Retorna referência + url (montada via `wise_default_payment_url` com amount/currency/description).
- `pdv_confirm_wise_payment(p_reference, p_amount_cents, p_currency, p_raw jsonb)` — chamada pelo webhook; valida valor/moeda; se bater: marca attempt `paid`, cria `pdv_sale` (reaproveita lógica de `pdv_close_tab` mas com `payment_method='wise'`), baixa estoque definitivo, marca tab `fechada`; se divergir: `pending_conciliation`.
- `pdv_cancel_wise_attempt(p_attempt_id, p_actor_id, p_reason)` — cancela tentativa ativa, libera comanda de volta para `aberta` (mantém itens/reserva).
- Ajuste em `pdv_close_tab`: aceitar `transferencia` além de `dinheiro`; rejeitar `wise` (forçar uso do fluxo de attempt).

### 1.4 Trigger financeiro
`finance_sync_pdv_sale` já trata `payment_method` — atualizar `finance_account_id_for_payment` para mapear `transferencia` → conta Wise/banco apropriada (ou conta dedicada de transferência).

## 2. Server functions (`src/lib/admin/pdv-wise.functions.ts` novo)
- `requestPdvWisePayment` → chama RPC, retorna `{ reference, paymentUrl, amountCents, phone }`.
- `cancelPdvWiseAttempt` → cancela tentativa, reabre comanda.
- `recheckPdvWiseAttempt` → consulta status atual da attempt (apenas leitura).
- `getPdvAwaitingPayments` → lista tentativas `waiting_payment` para painel.

Ajuste em `pdv-tabs.functions.ts > closePdvTab`: schema aceita `dinheiro | transferencia`; remove `cartao`/`pix`.

## 3. Webhook Wise (`src/routes/api.public.webhooks.wise.ts`)
- Estender regex de extração de referência para também capturar `PDV-CMD-[A-Z0-9-]+-A\d+`.
- Após tentar match em `wise_payments` (EMP-), tentar match em `pdv_payment_attempts` por `reference`:
  - se valor + moeda baterem → `pdv_confirm_wise_payment`;
  - se divergir → attempt = `pending_conciliation`, gravar `raw_webhook`, sem confirmar venda.
- Manter idempotência (não processar duas vezes mesma referência paga).

## 4. UI

### 4.1 `SaleCartPanel.tsx` (fechamento da comanda)
Trocar opções de método para: **Dinheiro**, **Transferência bancária**, **Receber com Wise**. Se Wise selecionado, botão "Gerar link Wise" dispara `requestPdvWisePayment` e abre modal de pagamento.

### 4.2 Novo `PdvWisePaymentModal.tsx`
Mostra total, referência, link, botões:
- Copiar link
- Abrir Wise (nova aba)
- Enviar por WhatsApp (`https://wa.me/<phone>?text=...` se cliente tiver telefone)
- Verificar agora (recheck)
- Cancelar cobrança / Reabrir comanda

### 4.3 `PdvTabsPanel.tsx`
- Nova seção "Comandas aguardando pagamento" (acima ou abaixo das abertas) com borda/badge âmbar, exibindo referência e ações (Abrir link, Verificar agora, Reabrir, Cancelar cobrança).
- Card de comanda aguardando: bloqueia edição de itens (só permite cancelar tentativa para reabrir).

### 4.4 `PdvHistoryPanel.tsx`
Filtro/coluna mostrando origem `wise` e link da referência. Adicionar aba/badge "Aguardando Wise" e "Pendentes de conciliação".

## 5. Reabrir comanda
Botão "Reabrir comanda" no card aguardando:
1. confirma com toast → `cancelPdvWiseAttempt` (motivo: "Reaberta para edição");
2. comanda volta `aberta`, attempt anterior fica `cancelled`;
3. próximo fechamento gera nova referência com sufixo `A<N+1>`.
Se webhook chegar para referência cancelada → vai direto para `pending_conciliation` (não confirma automaticamente).

## 6. Não escopo
- Não criar Quick Pay dinâmico via API Wise (mantém o link configurado).
- Não mexer em pedidos online (`orders` / `wise_payments`).
- Não alterar fluxo de comandas pagas em dinheiro além da renomeação de método (cartão/pix removidos da UI).

## Detalhes técnicos
- Referência única: `PDV-CMD-<8-últimos-do-tab_code-sem-hífen>-A<seq>` cabendo no limite de descrição da Wise.
- Reserva de estoque continua intacta entre `aguardando_pagamento` e confirmação; só vira baixa definitiva em `pdv_confirm_wise_payment`.
- Idempotência: webhook procura attempt por `reference`; se já `paid`, ignora.
- Permissão: ações usam `has_module_access('pdv')`; cancelar cobrança/reabrir respeita o toggle existente de "cancelar/apagar pedido" para staff (admin sempre pode).
