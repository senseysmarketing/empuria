## Substituir "Testar link Quick Pay" por "Ver eventos" + modal

### 1. Backend — nova server function
Criar `listWiseEvents` em `src/lib/admin/wise-events.functions.ts` (protegida por `requireSupabaseAuth` + checagem de admin/módulo financeiro):
- SELECT em `wise_events` ordenado por `created_at DESC`, limite 100.
- Retorna: `id`, `event_id`, `event_type`, `signature_valid`, `match_status`, `matched_payment_id`, `matched_order_id`, `processed_at`, `created_at`, `notes`, e campos derivados extraídos de `payload`: `reference`, `amount`, `currency`, `state` (mesma lógica de `pickReference`/`pickAmountCents`/`pickCurrency` do webhook).
- Para `matched_order_id`, fazer lookup em `orders` para mostrar `code`/cliente; para `matched_payment_id`, tentar achar `pdv_payment_attempts.reference` quando o `match_status` começar com `pdv_`.

### 2. UI — `WiseIntegrationCard.tsx`
- Trocar o botão "Testar link Quick Pay" por **"Ver eventos"** (ícone `Activity` ou `Inbox`).
- Manter o handler `testQuickPay` existente acessível dentro do modal de configuração se já estiver lá; remover só o botão do card principal.
- Ao clicar, abre `WiseEventsModal`.

### 3. Novo componente `WiseEventsModal.tsx`
- Dialog largo (max-w-4xl) com:
  - Header: "Eventos Wise recebidos" + contador total + botão refresh.
  - Filtros simples: select de `match_status` (todos / `auto_matched` / `pdv_matched` / `pending` / `underpaid` / `overpaid` / `pdv_pending` / `ignored`) e input de busca por reference.
  - Tabela responsiva com colunas: **Quando** (hora relativa + data tooltip), **Tipo** (`event_type`), **Referência** (mono), **Valor** (`amount currency`), **Status** (badge colorido), **Match** (link curto quando casou: código da venda/PDV), **Assinatura** (badge verde/cinza).
  - Linha expansível mostrando o `payload` JSON formatado e `notes`.
  - Legenda no rodapé explicando os status (auto_matched = casou automaticamente; pending = recebido mas sem referência reconhecível — normal para pagamentos vindos de fora; pdv_matched = baixa do PDV efetivada; etc.).

### Status colors
- `auto_matched` / `pdv_matched` → verde
- `pending` / `pdv_pending` → âmbar
- `underpaid` / `overpaid` → laranja
- `ignored` → cinza

### Fora de escopo
- Não muda webhook, RPCs, nem o fluxo de baixa.
- Não remove a opção de testar Quick Pay de dentro do diálogo "Configurar" (só some do card principal).
