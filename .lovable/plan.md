# Refatoração da tela /admin/pdv — PDV de Balcão

## Objetivo
Substituir o fluxo atual (passaporte/QR/comanda/tabs) por um PDV operacional de balcão: buscar/cadastrar cliente → carrinho → desconto → fechar venda (dinheiro/cartão) → baixa de estoque → auditoria → reset.

---

## Fase 1 — Banco de dados (migração única)

### Nova tabela `pdv_sales`
Campos: `id`, `customer_id` (uuid → profiles), `cashier_id` (uuid), `subtotal_eur_cents`, `subtotal_brl_cents`, `discount_type` ('none'|'amount'|'percent'), `discount_value` (numeric), `discount_eur_cents`, `discount_brl_cents`, `total_eur_cents`, `total_brl_cents`, `payment_method` ('dinheiro'|'cartao'), `status` ('concluida'|'cancelada'), `notes`, `closed_at`, `created_at`, `updated_at`.

### Nova tabela `pdv_sale_items`
Campos: `id`, `sale_id` (FK CASCADE), `product_id`, `product_name_snapshot`, `product_emoji_snapshot`, `qty`, `unit_price_eur_cents`, `unit_price_brl_cents`, `total_eur_cents`, `total_brl_cents`, `created_at`.

### Nova tabela `product_stock_movements`
Campos: `id`, `product_id`, `type` ('entrada'|'saida'|'ajuste'|'venda'|'cancelamento'), `quantity`, `previous_stock`, `new_stock`, `reason` (text), `sale_id` (nullable), `created_by`, `created_at`.

### Ampliação de `products`
Adicionar: `item_type` ('produto'|'servico', default 'produto'), `price_eur_cents` (int, backfill = `price_cents`), `price_brl_cents` (int, default 0), `stock_quantity` (int, default 0), `stock_min_quantity` (int, default 0), `track_stock` (bool, default false). Mantém `price_cents` por compatibilidade.

### Segurança
- GRANTs para `authenticated` + `service_role`.
- RLS: `is_staff(auth.uid())` para SELECT/INSERT; UPDATE/DELETE restrito a admin (vendas só editadas por servidor via service role para garantir atomicidade).
- Permissão de módulo: `pdv` (já existe via `has_module_access`).

---

## Fase 2 — Server functions (`src/lib/admin/pdv.functions.ts` reescrito)

Remover: `lookupPassport`, `registerCheckIn`, `openTab`, `getTab`, `addTabItem`, `removeTabItem`, `closeTabAsStaff`. (Manter arquivo legado renomeado `pdv-legacy.functions.ts` se algo do portal ainda usar — verificar; senão deletar.)

Novas funções com `requireModule("pdv")`:
- `searchCustomers({ query })` — busca em profiles por nome/telefone/email (ilike, limit 10).
- `createCustomerQuick({ fullName, phone, email, password })` — usa `supabaseAdmin.auth.admin.createUser` → cria profile + role member; audit `cliente_criado_pdv`.
- `listPdvCatalog()` — lista produtos ativos com `item_type`, preços EUR/BRL, estoque, categoria (join `product_categories`).
- `closePdvSale({ customerId, items:[{productId, qty}], discount:{type,value}, paymentMethod, notes? })` — **atômico via RPC Postgres** `pdv_close_sale` (security definer). Valida cliente, valida estoque para itens com `track_stock=true`, calcula totais EUR/BRL com snapshots, insere `pdv_sales`+`pdv_sale_items`, decrementa `stock_quantity` e cria `product_stock_movements` (type='venda'), grava `audit_logs`. Retorna `{ saleId }`.
- `getPdvSale({ saleId })` — recibo pós-venda.
- `listRecentSales({ limit })` — opcional para dashboard caixa.

### Server functions de estoque (`src/lib/admin/pdv-itens.functions.ts` expandido)
- `registerStockEntry({ productId, quantity, reason })`
- `registerStockExit({ productId, quantity, reason })`
- `adjustStock({ productId, newQuantity, reason })`
- `getProductStockHistory({ productId })`

Cada uma grava em `product_stock_movements` e atualiza `products.stock_quantity` + audit log.

---

## Fase 3 — Frontend `/admin/pdv` (reescrita completa)

Substitui `src/routes/_authenticated/admin.pdv.tsx`. Remove `PassportScannerDialog`. Não usa mais `?tab=` na URL — estado vive na tela.

### Componentes (novos em `src/components/admin/pdv/`)
- `CustomerSearchPanel.tsx` — input grande central, debounce 250ms, lista resultados (avatar + nome + telefone), botão "Cadastrar novo cliente" abre `QuickCustomerDialog`.
- `QuickCustomerDialog.tsx` — modal com nome, telefone, email, senha (zod min 6); ao salvar seleciona o cliente.
- `SaleCatalogGrid.tsx` — catálogo agrupado por categoria, cards com emoji/nome/preço EUR/BRL, badge de estoque baixo, botão `+` (desabilitado se sem estoque e `track_stock`).
- `SaleCartPanel.tsx` — header com cliente selecionado, lista de itens (qty +/-, remover), seletor de desconto (valor/percentual), totais EUR e BRL, botões `[Dinheiro] [Cartão]`.
- `SaleSuccessOverlay.tsx` — confete (lib `canvas-confetti`), resumo, botão "Nova venda", auto-reset 5s.

### Estados da página
1. `idle` → CustomerSearchPanel ocupa centro.
2. `selling` → header com cliente + trocar; grid 8/4 catálogo + carrinho.
3. `success` → overlay com confete.

Hook `useModuleAccess().can('pdv')` controla acesso (rota já protegida por `_authenticated` + `requireModule` no backend).

---

## Fase 4 — Aba "PDV Itens" em `/admin/configuracoes`

Atualizar `src/components/admin/configuracoes/PdvItensTab.tsx`:
- Form do item ganha: toggle `item_type` (produto/serviço), `price_eur_cents`, `price_brl_cents`, toggle `track_stock`, `stock_min_quantity`. Campo `stock_quantity` é read-only (só muda via movimentações).
- Nova coluna na tabela: estoque atual (badge vermelho se ≤ mínimo).
- Novo botão por linha: "Movimentações" → abre `StockMovementsDialog` (histórico + ações: entrada, saída, ajuste).

---

## Fase 5 — Limpeza

- Remover dependência de `?tab=` em links/atalhos para `/admin/pdv` (verificar `AdminDock`, `HeroTopBar`).
- **Manter** `tabs` / `tab_items` no banco (portal pode usar). Não remover nesta entrega.
- Remover do PDV: imports de `PassportScannerDialog`, `parsePassportQrPayload`.

---

## Detalhes técnicos relevantes

### Atomicidade
Implementar `pdv_close_sale` como **função Postgres SECURITY DEFINER** chamada pela server function. Toda a lógica (validação de estoque, inserts, decrementos, audit) roda em uma única transação — se qualquer step falhar, rollback automático. A server function apenas valida input (zod), chama RPC e grava audit log de alto nível.

### Preço BRL
Armazenado por item; soma simples no fechamento. Sem conversão de câmbio automática.

### Auditoria
`audit_logs` com `module='pdv'` e ações: `venda_fechada`, `cliente_criado_pdv`, `estoque_entrada`, `estoque_saida`, `estoque_ajuste`, `item_editado`, `preco_alterado`.

### Fora de escopo
- Cancelamento de venda (deixar tabela preparada com status, mas UI futura).
- Impressão de recibo.
- Câmbio EUR/BRL automático.
- Remoção de `tabs`/`tab_items`.
- Multi-caixa / abertura-fechamento de caixa.

---

## Ordem de execução
1. Migração SQL (tabelas + função `pdv_close_sale` + RLS + grants).
2. Server functions PDV e estoque.
3. `PdvItensTab` (form expandido + movimentações).
4. Componentes `src/components/admin/pdv/*`.
5. Reescrita de `admin.pdv.tsx`.
6. Instalar `canvas-confetti`.
7. Smoke test do fluxo completo.