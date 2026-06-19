## Mudanças na página `/admin/relatorios`

### 1. Visão Geral — remover cards
Em `VisaoGeralTab` (src/routes/_authenticated/admin.relatorios.tsx):
- Remover os `MetricCard` de **"Novos leads"** e **"Novos membros do Clube"**.
- Resultado: 8 cards organizados em 2 linhas de 4 (Receita total, Receita recebida, Receita prevista, Despesas / Saldo, Pedidos pagos, Vendas PDV, Ingressos vendidos).
- Reordenar para ficar limpo em 2 linhas × 4 colunas. Não alterar a função server `getReportsOverview` (os campos continuam existindo, só não são exibidos).

### 2. Barra de filtros global — simplificar
Em `GlobalFiltersBar`:
- Remover o seletor de **Moeda** (sistema é só EUR). Manter `currency: "EUR"` fixo no schema/filtros.
- Remover o seletor de **Origem** da barra global (vira filtro específico apenas onde faz sentido, como na nova aba de Histórico).
- Mover o seletor de **Comparação** para o header, ao lado do título "Relatórios", como um botão/dropdown compacto (ex.: `Comparar: Período anterior ▾`).
- A barra fica apenas com o **seletor de Período** + (quando `custom`) os dois inputs de data. Visualmente mais leve.
- Pode-se inclusive eliminar o `BentoCard` envolvente quando só restar o período, mostrando o select inline abaixo do header.
- Schema da URL: manter `currency` e `compare` (compare ainda existe, só muda de lugar). Remover `origin` do schema global — a aba de histórico terá seu próprio filtro de origem via search param local.

### 3. Nova aba "Histórico de Pedidos"
Adicionar nova `TabsTrigger` `{ v: "historico", l: "Histórico de Pedidos" }` (entre "Visão Geral" e "Vendas & Financeiro", ou no fim — sugestão: logo após Visão Geral) e respectiva `TabsContent`.

**Componente `HistoricoTab`** (no mesmo arquivo, ou extraído para `src/components/admin/relatorios/HistoricoTab.tsx`):
- Tabela única unificando **pedidos da esteira** (`orders`) + **vendas PDV** (`pdv_payment_attempts` confirmadas / vendas PDV — usar a mesma fonte de "Vendas PDV" já existente).
- Colunas: Data/Hora, Origem (badge: Esteira / PDV), Referência (id curto ou número do pedido), Cliente (nome + email), Itens (resumo), Valor, Moeda, Status (pago/pendente/cancelado), Método de pagamento.
- Barra de filtros local: busca (referência, nome, email), origem (Todas / Esteira / PDV), status, intervalo de datas (respeita o período global como default).
- **Paginação** server-side: `page` + `pageSize` (20/50/100) em URL search params da aba.
- Ordenação por data desc por padrão; permitir clicar nas colunas Data e Valor para inverter.
- Footer com "Mostrando X–Y de Z" + botões Anterior/Próximo.

**Backend — nova server function** `getReportsHistorico` em `src/lib/admin/reports.functions.ts`:
- Input (Zod): `{ period, from, to, origin?, status?, search?, sortBy?, sortDir?, page, pageSize }`.
- Protegida por `requireStaff` (não-admin pode ver lista mas com valores mascarados? — manter regra atual: admin vê valor, staff vê pedido sem valor. Confirmar comportamento igual ao restante de Relatórios).
- Query: 
  1. `orders` filtrados pelo período + filtros → mapear para shape unificado `{ source: "esteira", id, ref, created_at, customer, total_cents, currency, status, payment_method }`.
  2. `pdv_payment_attempts` (ou tabela de vendas PDV equivalente — verificar `src/lib/admin/pdv-sales.functions.ts`) → mapear para `{ source: "pdv", ... }`.
  3. Concatenar, ordenar em memória, paginar. (Volume baixo o suficiente; se necessário no futuro, migrar para uma view SQL `UNION ALL`.)
- Retorno: `{ rows, total, page, pageSize }`.

**Exportação Excel**: adicionar entrada `historico` em `TAB_LABEL` e `buildHistoricoXlsx` em `reports.export.functions.ts` que reusa a mesma fonte (sem paginação) para gerar a planilha — assim o botão "Excel" do header continua funcionando na nova aba.

### Arquivos afetados
- `src/routes/_authenticated/admin.relatorios.tsx` — remove cards, refatora filtros, adiciona aba.
- `src/components/admin/relatorios/HistoricoTab.tsx` (novo).
- `src/lib/admin/reports.functions.ts` — nova função `getReportsHistorico`.
- `src/lib/admin/reports.export.functions.ts` — `buildHistoricoXlsx` + label.

### Fora de escopo
- Mudanças nas outras abas (Vendas, PDV, Serviços, Eventos, Clube, CRM).
- Alterações no card de "Top 5 fontes de receita" ou no gráfico de Receita por dia da Visão Geral.
- Persistência de preferências de ordenação/page-size (fica só na URL da sessão).
