## Mudanças (plano revisado)

### 1. Reordenar abas em `admin.relatorios.tsx`
Mover **Histórico de Pedidos** para ficar entre **PDV & Estoque** e **Serviços & Agenda**.

### 2. Corrigir nome do cliente nas vendas PDV
**Causa raiz:** em `reports.functions.ts` (~linha 1627), o select usa `id,full_name,email` na tabela `profiles`, mas a coluna `email` **não existe** (confirmado via DB). O PostgREST retorna erro, `profs` vira `null` e o `customerMap` fica vazio — toda linha PDV mostra "—".

**Fix:** trocar para `select("id,full_name")` e parar de popular `customer_email` no row do PDV.

### 3. Corrigir status "Pendente" em todas as linhas
**Causa raiz:** os normalizadores estão em inglês, mas o banco grava em português:
- `pdv_sales.status` → valores reais: `concluida`, `cancelada` (e variações). `normalizePdvStatus` só reconhece `closed`/`paid`/`voided`, então cai no fallback `pending`.
- `orders.payment_status` → valores reais: `aprovado`, `pendente`. `normalizeOrderStatus` só reconhece `approved`/`paid`, então `aprovado` também vira `pending`.

**Fix em `reports.functions.ts`:**
- `normalizeOrderStatus`: aceitar também `aprovado` → `paid`; `cancelado`/`recusado`/`reembolsado` → `cancelled`; `pendente` → `pending`. Manter os valores em inglês existentes para compatibilidade.
- `normalizePdvStatus`: aceitar `concluida` → `paid`; `cancelada` → `cancelled`; `anulada` → `voided`. Manter os existentes.

Manter os filtros de status como estão (todos visíveis, sem alterações na UI desta parte).

### 4. Remover coluna de email em `HistoricoTab.tsx`
- Remover o `<div>` com `customer_email` abaixo do nome — cliente em uma linha só.
- Simplificar placeholder de busca para "Buscar por referência ou cliente…".

### Arquivos afetados
- `src/routes/_authenticated/admin.relatorios.tsx` — reordenar abas.
- `src/lib/admin/reports.functions.ts` — corrigir select de `profiles` + ajustar os dois normalizadores de status.
- `src/components/admin/relatorios/HistoricoTab.tsx` — remover linha de email, ajustar placeholder.

Fora de escopo: filtros da UI, export XLSX (continua usando os mesmos dados, agora com status corretos).
