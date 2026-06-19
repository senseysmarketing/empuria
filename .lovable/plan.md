## Objetivo
Criar uma nova aba **"Conciliações Wise"** dentro de Configurações para tratar manualmente recebimentos Wise que não casaram automaticamente (sem referência, referência errada, pedido já pago, valor divergente, comanda PDV pendente, duplicados). Tela operacional, simples, com toggle de permissão por usuário.

## Escopo

### 1. Permissão (novo módulo)
- `src/lib/admin/permissions.functions.ts`: adicionar `conciliacoes_wise` em `ALL_MODULES` + `MODULE_LABELS` (rótulo "Conciliações Wise").
- Resultado: o toggle aparece automaticamente em **Equipe & Permissões** (matriz já é gerada do array). Admin sempre tem acesso.

### 2. Nova aba em Configurações
- `src/routes/_authenticated/admin.configuracoes.tsx`: adicionar `"conciliacoes-wise"` em `TABS`, novo `<TabsTrigger>` (ícone `ShieldAlert`/`Receipt`) e `<TabsContent>` gated por `can("conciliacoes_wise")`, com `RestrictedAreaCard` caso negado.
- Novo componente `src/components/admin/configuracoes/ConciliacoesWiseTab.tsx`.

### 3. UI da aba (`ConciliacoesWiseTab.tsx`)
Tela única, sem rota separada (a `admin.wise-conciliacao.tsx` antiga continua intocada para não quebrar links, mas o foco do trabalho é a nova aba).

**Resumo (cards no topo):**
- Pendentes · Sem referência · Valor divergente (under/over) · Duplicados/Já pagos · Ignorados

**Filtros:**
- Botões `Todos` | `Sem referência` | `Valor divergente` | `Duplicados` | `Conferidos` | `Ignorados`
- Busca por referência/valor/pagador

**Tabela:**
| Data | Valor | Referência recebida | Motivo | Sugestão | Status | Ações |

Linhas mostram badge de motivo derivado de `match_status` + heurística (regex PDV/EMP, valor vs sugestão). Ações por linha: `Ver detalhes` (drawer) · `Ignorar` · `Marcar duplicado`.

**Drawer/Modal de detalhe:**
- Lado esquerdo: dados do evento Wise (data, valor, moeda, referência, pagador extraído do `payload`, payload bruto colapsável)
- Lado direito: busca de destino com tabs `Pedidos da esteira` / `Comandas PDV`
  - Lista de pedidos `orders` em status `aguardando_pagamento` (provider wise) ou todos abertos quando "Todos"
  - Lista de `pdv_payment_attempts` em `waiting_payment`
  - Filtro por nome/email/ref/valor
- Botão `Vincular e aprovar` → confirmação modal → server fn
- Indicador "Match perfeito / provável / divergente" baseado em valor + moeda + status do alvo

### 4. Server functions novas / atualizadas (`src/lib/wise/wise.functions.ts`)
- `listOpenPaymentTargets({ search, type: "orders" | "pdv" | "all" })` → retorna `{ orders: [...], pdvAttempts: [...] }`. Protege com `requireStaff` + checagem do módulo `conciliacoes_wise` ou admin.
- `manuallyMatchWisePdvAttempt({ eventId, attemptId, notes })`:
  - Marca `wise_events` como `manual_matched` ligado ao attempt (via `notes` JSON e `matched_payment_id` se schema permitir; senão só notes).
  - Chama RPC `pdv_confirm_wise_payment` com `p_reference = attempt.reference`, `p_amount_cents = attempt.amount_eur_cents`, `p_currency = 'EUR'`, `p_raw = { manual: true, event_id, by }` para reutilizar o fluxo idempotente (fecha comanda, cria sale, baixa estoque, financeiro, audit).
  - Se o attempt já estiver `paid` → marca o evento como `duplicate`, não reprocessa.
  - Audit log com `module: "configuracoes"`, action `wise_event.manually_matched_pdv`.
- Ajustar `manuallyMatchWiseEvent` (orders) para também aceitar `matchKind: "duplicate" | "match"` e gravar `match_status = "duplicate"` quando o pedido já estiver pago, sem reaplicar `paid_at`.
- Ajustar `listWiseEvents` para aceitar filtro derivado (`needsAttention`) que retorna `match_status IN (pending, underpaid, overpaid, pdv_pending, duplicate)`.
- Todas as novas fns: gate `requireStaff` + check do módulo `conciliacoes_wise` (helper inline `assertCanConciliar(context)` que aceita admin OU módulo).

### 5. Idempotência & segurança
- Server fn de vincular: re-consulta o estado do `order`/`pdv_payment_attempts` no início; se já estiver pago, força `match_status = duplicate` e não cria financeiro/baixa.
- Constraint lógica: um `wise_events.id` só pode ser vinculado a um destino — checa `match_status NOT IN (auto_matched, manual_matched, pdv_matched)` antes de aceitar a vinculação; senão erro "Evento já conciliado".
- Audit log obrigatório em toda ação.

### 6. Detecção do "motivo da pendência"
Função pura no componente (sem mudança no banco) que mapeia `(match_status, payload)` → rótulo:
- `pending` + sem reference no payload → "Sem referência"
- `pending` + reference presente → "Referência não encontrada"
- `pdv_pending` → "Referência PDV não casou (valor/moeda)"
- `underpaid` / `overpaid` → "Valor divergente"
- `duplicate` → "Possível duplicidade"
- `ignored` → "Ignorado"

## Fora do escopo (V1)
- Sugestão automática por score (cliente/data). A V1 lista pedidos abertos e deixa o admin escolher.
- Sub-aprovação parcial (split). Por enquanto só vincular-e-aprovar integral.
- Notificação proativa (toast/email) para novos pendentes.
- Não alterar a rota `/admin/wise-conciliacao` existente nem o schema de `wise_events`.

## Arquivos afetados
- ✏️ `src/lib/admin/permissions.functions.ts` — adicionar módulo
- ✏️ `src/routes/_authenticated/admin.configuracoes.tsx` — nova aba
- 🆕 `src/components/admin/configuracoes/ConciliacoesWiseTab.tsx`
- 🆕 `src/components/admin/configuracoes/ConciliacoesWiseDrawer.tsx`
- ✏️ `src/lib/wise/wise.functions.ts` — novas fns + ajustes

## Verificação após implementar
- Aba aparece em Configurações apenas para admin e para usuários com módulo `conciliacoes_wise` ligado.
- Equipe & Permissões mostra o toggle novo.
- Evento `sim-pdv-2606190002-a1-003` (que ficou em `pending`) aparece na tabela como "Sem referência reconhecida" → ao vincular ao attempt PDV-2606190002-A1 já pago, o sistema reconhece como duplicado e não reprocessa.
- Vincular um futuro evento real a um pedido `orders` em aberto: order vira `aprovado`, `wise_payments` vira `paid`, audit log gravado.
