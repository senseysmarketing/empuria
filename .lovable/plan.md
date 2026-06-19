## Mudanças

### 1. Reordenar abas em `admin.relatorios.tsx`
Mover **Histórico de Pedidos** para ficar entre **PDV & Estoque** e **Serviços & Agenda**:

```
Visão Geral | Vendas & Financeiro | PDV & Estoque | Histórico de Pedidos | Serviços & Agenda | Eventos | Clube | CRM & SLA
```

### 2. Corrigir nome do cliente nas vendas PDV
**Causa raiz:** em `reports.functions.ts` (~linha 1627), o select usa `id,full_name,email` na tabela `profiles`, mas a coluna `email` não existe. PostgREST devolve erro, `profs` vira `null` e o `customerMap` fica vazio — por isso toda linha PDV mostra "—" no cliente.

**Fix:** trocar para `select("id,full_name")` e não retornar mais `email`.

### 3. Mostrar apenas pedidos concluídos/pagos
Hoje o histórico inclui pedidos pendentes/cancelados (por isso aparece tudo como "Pendente"). Filtrar no server (`getReportsHistorico`) para que só entrem entradas efetivamente pagas/concluídas:

- **Esteira (`orders`)**: filtrar por `payment_status IN ('paid','approved','completed','succeeded')` (status que `normalizeOrderStatus` mapeia para `paid`).
- **PDV (`pdv_sales`)**: filtrar por `status = 'concluida'` (única que mapeia para `paid`).

Resultado: a coluna Status sempre exibirá **Pago/Concluído**. Como fica redundante, podemos manter a coluna por consistência visual, mas com badge verde fixo.

### 4. Remover coluna de email em `HistoricoTab.tsx`
- Remover o `<div>` com `customer_email` abaixo do nome — cliente em uma linha só.
- Simplificar placeholder do search para "Buscar por referência ou cliente…".
- Remover o filtro "Todos status" do topo (não faz mais sentido — só há um status).

### Arquivos afetados
- `src/routes/_authenticated/admin.relatorios.tsx` — reordenar abas.
- `src/lib/admin/reports.functions.ts` — corrigir select de `profiles` + filtrar somente pagos/concluídos.
- `src/components/admin/relatorios/HistoricoTab.tsx` — remover linha de email, remover filtro de status, ajustar placeholder.

Fora de escopo: outras abas, mudanças no XLSX export (continua exportando o mesmo conjunto agora já filtrado).
