
## Objetivo

Garantir que **toda ação no PDV** — abrir/fechar/cancelar comanda, adicionar/editar/remover item, gerar/cancelar/confirmar Wise, anular venda, fechar venda direta, abrir cliente — gere um registro detalhado e pesquisável no backend, incluindo **tentativas que falharam**. Sem mudança visual no app.

## Diagnóstico atual

Hoje já existem registros em `audit_logs` (módulo `pdv`) cobrindo as RPCs principais (`pdv_tab.opened`, `item_added`, `item_qty_updated`, `item_cancelled`, `closed`, `cancelled`, `wise_requested/paid/cancelled`, `pdv_sale.voided`). O que falta:

- Logs de **falhas** (RPC negou permissão, estoque insuficiente, RLS bloqueou, etc.) — hoje a exceção sobe e nada é registrado.
- **Contexto da requisição**: IP, user-agent, rota chamadora, payload bruto enviado pelo frontend.
- **Snapshot legível** (nome do cliente, do produto, código da comanda, valor) — hoje só temos IDs no `new_data`, dificultando análise.
- **Eventos de leitura/abertura de telas** críticas (opcional) e **reaberturas/edições silenciosas** (ex.: trocar cliente da comanda, reabrir comanda).
- Um **índice por ator + data** para responder rapidamente "tudo que a Luana fez no dia X".

## Plano

### 1. Nova tabela `pdv_activity_logs` (migração)

Criada exclusivamente para PDV, separada de `audit_logs` para não poluir o módulo de auditoria geral e permitir índices específicos. Campos:

```text
id                uuid pk
occurred_at       timestamptz default now()
actor_id          uuid (profiles.id, nullable se sistema)
actor_name        text snapshot
action            text  ex: 'tab.open', 'tab.item.add', 'tab.close', 'wise.request', 'wise.confirm', 'sale.void', 'tab.item.remove', 'tab.cancel', 'sale.close_direct'
status            text  'success' | 'error' | 'denied'
tab_id            uuid nullable
tab_code          text snapshot
sale_id           uuid nullable
sale_code         text snapshot
customer_id       uuid nullable
customer_name     text snapshot
product_id        uuid nullable
product_name      text snapshot
amount_eur_cents  int nullable
payment_method    text nullable
reference         text nullable  (PDV-..., wise reference)
request_ip        text
user_agent        text
route             text  rota/origem da chamada (ex: '/admin/pdv', server-fn name)
params            jsonb payload bruto recebido
result            jsonb resposta/IDs criados
error_message     text nullable
error_code        text nullable
```

Índices em `(actor_id, occurred_at desc)`, `(tab_id)`, `(sale_id)`, `(action, occurred_at desc)`. RLS: somente admins podem `SELECT`; `INSERT` via `service_role`.

### 2. Helper de logging server-side

Criar `src/lib/admin/pdv-activity-log.server.ts` com:

```ts
logPdvActivity({ action, status, actorId, request, ...snapshot, params, result, error })
```

- Extrai IP/UA de `getRequest()`.
- Faz lookup leve para preencher nomes (cliente, produto, código) quando só IDs estiverem disponíveis.
- Tolerante a falha: nunca quebra o fluxo principal (`try/catch` interno, `console.warn` se logger falhar).

### 3. Instrumentação dos server functions PDV

Envolver cada handler em `src/lib/admin/pdv-*.functions.ts` com o padrão:

```ts
try {
  const result = await rpc(...);
  await logPdvActivity({ action, status: 'success', ...ctx, result });
  return result;
} catch (e) {
  await logPdvActivity({ action, status: 'error', ...ctx, error_message: e.message });
  throw e;
}
```

Cobertura:
- `pdv-tabs.functions.ts`: openTab, cancelTab, reopenTab, changeCustomer, addNote.
- `pdv-itens.functions.ts`: addItem, updateQty, cancelItem.
- `pdv-sales.functions.ts`: closeTab, closeDirectSale, voidSale.
- `pdv-wise.functions.ts`: requestWise, cancelWise, recheckWise, manualConfirm.
- `pdv-customers.functions.ts`: createManualUser, reuseManualUser, searchCustomer (opcional, baixa cardinalidade — apenas em produção real seria muito; **vou pular** searches para não inflar).

### 4. Triggers de segurança no banco

Para garantir que nenhuma ação escape (por exemplo, se algum dia alguém fizer UPDATE direto), adicionar triggers AFTER em:
- `pdv_tabs` (INSERT, UPDATE de status, DELETE)
- `pdv_tab_items` (INSERT, UPDATE de qty, UPDATE de cancelled_at)
- `pdv_sales` (INSERT, UPDATE de status)
- `pdv_payment_attempts` (INSERT, UPDATE de status)

Os triggers inserem em `pdv_activity_logs` com `actor_id = auth.uid()` quando disponível, `source = 'db_trigger'`. Esses logs complementam (não substituem) os logs do server function, e servem como rede de proteção.

### 5. Backfill leve

Migrar (best-effort) as últimas 90 dias de `audit_logs` (módulo `pdv`) para `pdv_activity_logs` mapeando campos básicos. Sem perda de histórico.

### 6. Sem UI

Nenhuma tela é criada. A consulta é feita via SQL direto (ex.: `SELECT * FROM pdv_activity_logs WHERE actor_id = ... AND occurred_at::date = '2026-06-29' ORDER BY occurred_at`). Se no futuro a Luana ou outro responsável quiser uma tela, fazemos depois.

## Detalhes técnicos relevantes

- O helper roda em `*.server.ts` (não exposto ao cliente) e usa `supabaseAdmin` para inserir.
- IP é extraído de `request.headers.get('x-forwarded-for')` com fallback.
- `route` é passado explicitamente em cada chamada para clareza (`'pdv.openTab'`, `'pdv.addItem'`, etc.).
- Erros conhecidos da RPC (`raise exception 'Sem permissao...'`) são capturados e marcados como `denied` em vez de `error`.
- Os logs antigos de `audit_logs` continuam existindo — não remover, apenas duplicar daqui para frente.

## Validação após implementação

1. Executar uma sequência completa via Playwright/manual: abrir comanda → adicionar 2 itens → editar qty → remover 1 → tentar fechar com Wise → cancelar Wise → fechar como dinheiro.
2. `SELECT action, status, occurred_at, tab_code, product_name, error_message FROM pdv_activity_logs ORDER BY occurred_at DESC LIMIT 20;` confirmar 1 linha por ação, com snapshots legíveis.
3. Tentar uma ação proibida (ex.: usuário sem permissão) e confirmar `status='denied'`.

## Sobre o caso da Luana

Esta instrumentação **a partir de agora** revelará exatamente o que ocorre. Para os "pedidos de barbearia que sumiram", consigo já antecipar a investigação consultando `audit_logs` por ator + período (ex.: a comanda Wise pendente `CMD-20260629-0001` é provavelmente um dos casos). Posso anexar essa consulta ao final da implementação para confrontarmos a versão dela com o que o banco registrou.
