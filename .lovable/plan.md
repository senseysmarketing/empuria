
# Passaporte Empuria — Check-in, Comanda Digital e Benefícios

Transformar o QR do `PassportCard` (já existente em `/portal`) em um hub físico-digital usado pela equipe na Gran Vía para 3 fluxos: Check-in de hospitalidade, PDV/Comanda, e aplicação automática de benefícios do Clube.

## 1. Banco de dados (migration única)

Novas tabelas:

- `products` — catálogo do bar/barbearia.
  - `id, slug, name, category` (bebida | comida | barbearia | outro), `price_cents`, `emoji`, `is_active`, `position`.
- `tabs` — comanda aberta de um cliente.
  - `id, user_id, opened_by (staff), status` (aberta | paga | cancelada), `opened_at, closed_at, total_cents, paid_cents, payment_method, order_id` (FK opcional p/ `orders` ao fechar).
- `tab_items` — itens da comanda.
  - `id, tab_id, product_id, product_name_snapshot, qty, unit_price_cents, discount_cents, benefit_label` (texto ex.: "Presente do Clube · 20%"), `added_by, created_at`.
- `club_benefits` — regras de benefício do Clube por produto/categoria.
  - `id, name, scope` (produto | categoria), `product_id?, category?`, `kind` (desconto_pct | desconto_fixo | cortesia), `value`, `max_per_visit` (ex.: 1ª cerveja cortesia), `is_active`.
- `arrivals`: já existe — adicionar coluna `visit_count_snapshot int` (opcional, calculado on the fly por agora).

RLS:
- `products`: leitura pública dos ativos; CRUD só staff.
- `tabs` / `tab_items`: owner (user_id = auth.uid) **SELECT** e **UPDATE** (apenas marcar `paid` via fluxo do app); staff full ALL.
- `club_benefits`: leitura autenticada; CRUD admin.

Triggers / RPC:
- Função `recalculate_tab_total(tab_id)` que soma `qty*unit_price - discount` e atualiza `tabs.total_cents`.
- Trigger AFTER INSERT/UPDATE/DELETE em `tab_items` chama o recálculo.
- Função `apply_club_benefits(tab_item_id)` chamada AFTER INSERT em `tab_items`: se `profiles.is_club_member` e há regra ativa para o produto/categoria, aplica `discount_cents` + preenche `benefit_label` (respeitando `max_per_visit` na mesma `tab`).
- Realtime habilitado em `tabs` e `tab_items` (publication `supabase_realtime`).

Seeds iniciais (para já vermos funcionando):
- Produtos: 🍺 Estrella Galicia (2€), 🍷 Vino Tinto (4€), 🥤 Refrigerante (2€), ☕ Café Cortado (1.5€), 🥐 Croissant (3€), ✂️ Corte de Cabelo (15€), 🧔 Barba (10€), 💈 Combo Corte+Barba (22€), 🚿 Toalha quente (cortesia · 0€).
- Benefícios do Clube: 20% off em Barbearia (categoria); 1ª cerveja Estrella cortesia (max_per_visit=1).

## 2. Server functions

Arquivo `src/lib/admin/pdv.functions.ts` (staff-only via `requireStaff`):
- `lookupPassport({ userId })` → retorna perfil + classe + nº visitas (`arrivals` count) + próximo agendamento + voucher disponível + comanda aberta (se existir).
- `registerCheckIn({ userId, purpose? })` → cria registro em `arrivals` + insere `activity_feed`.
- `listProducts()` → produtos ativos agrupados por categoria.
- `openTab({ userId })` → cria `tabs` aberta (ou retorna a existente).
- `addTabItem({ tabId, productId, qty })` → insere item; trigger calcula desconto.
- `removeTabItem({ itemId })`.
- `closeTab({ tabId, paymentMethod })` → marca como paga, cria `orders` (linkado), broadcast realtime para o cliente.

Arquivo `src/lib/portal/tab.functions.ts` (member):
- `getMyOpenTab()` → tab aberta + itens (com snapshot de preço/benefit_label).
- `payMyTab({ tabId })` → reaproveita `createCheckoutIntent` (mock PIX) gerando ordem; ao confirmar (`confirmMockPayment`), trigger fecha a tab.

## 3. UI — Admin

### a) Botão "📷 Escanear Passaporte" no Cockpit
- No header de `/admin` (ao lado de `<ArrivalDialog />`), botão laranja primário abre `<PassportScannerDialog />`.
- Componente novo `src/components/admin/PassportScannerDialog.tsx` usa `@yudiel/react-qr-scanner` (dep a adicionar) → câmera; decodifica string `empuria:<uuid>`; chama `lookupPassport`.

### b) Modal de Hospitalidade `<PassportContextModal />`
- Bento Box 3 blocos:
  - **Perfil**: avatar (placeholder se vazio), nome, classe (`Clube` se `is_club_member`, senão `Standard`).
  - **Contexto**: "Xª visita ao Instituto" (count de arrivals + 1).
  - **Agenda do Dia**: próximo agendamento de hoje com consultor; vouchers/serviços ativos.
- Ações: "Registrar chegada" (chama `registerCheckIn`) e "Abrir Comanda" (vai para `/admin/pdv?user=<id>`).

### c) Nova rota `/admin/pdv` — PDV Empuria
- Arquivo `src/routes/_authenticated/admin.pdv.tsx`.
- Layout: esquerda **catálogo** (grid de botões grandes por categoria, emoji + nome + preço); direita **comanda ativa** (lista de itens com qty, descontos riscados, total grande).
- Topo: campo "Escanear passaporte" + busca por nome.
- Item adicionado mostra badge verde "✓ Desconto Clube aplicado" se trigger marcou.
- Botão "Fechar comanda" abre confirmação com forma de pagamento (Dinheiro · Cartão · Cliente paga no app).
- Adicionar item ao `AdminDock`: ícone `Wine` ou `ShoppingBag`, label "PDV".

## 4. UI — Portal (Membro)

### Widget de comanda no `/portal`
- Novo `src/components/portal/TabWidget.tsx` exibido NO TOPO de `portal.index.tsx` (acima do Passaporte) **somente** quando há tab aberta.
- Card amarelo destacado (`bg-yellow-brand/15 border-yellow-brand`): "Sua Comanda na Gran Vía" + lista compacta de itens (itens cortesia/desconto com tag "🎁 Presente do seu Clube" e preço riscado) + total grande + botão "Pagar Comanda (X €)".
- Sincronização realtime: hook `useOpenTab()` se inscreve em `tabs` e `tab_items` filtrando por `user_id=auth.uid()`; invalida a query a cada evento.
- Pagamento: reusa `UpsellSheet` adaptado (`PayTabSheet`) com PIX mock → confirma → widget some.

## 5. Detalhes técnicos

- Dep nova: `@yudiel/react-qr-scanner` (leve, mantida, sem dependências nativas; ok no Worker — uso só client-side).
- Realtime: `supabase.channel('tab:' + userId).on('postgres_changes', ...)` no portal; no admin, mesmo padrão filtrando por `tab_id`.
- QR atual já codifica `empuria:<userId>` → o scanner faz `string.startsWith("empuria:")` e extrai uuid.
- Tipagem: rodar codegen do Supabase após migration (`src/integrations/supabase/types.ts`).
- Seeds entram na própria migration via `INSERT ... ON CONFLICT DO NOTHING` para já termos produtos visíveis no PDV.

## 6. Fora de escopo (nesta entrega)

- Pagamento real (Stripe/PIX real) — segue mock como o restante da app.
- Foto de avatar no perfil (placeholder por enquanto).
- Histórico de comandas pagas (apenas a aberta por enquanto; lista futura).
- App nativo/PWA do scanner (usa câmera do browser via `getUserMedia` — funciona em mobile moderno).

## Resumo de arquivos

Novos:
- `supabase/migrations/<ts>_pdv_passaporte.sql`
- `src/lib/admin/pdv.functions.ts`
- `src/lib/portal/tab.functions.ts`
- `src/components/admin/PassportScannerDialog.tsx`
- `src/components/admin/PassportContextModal.tsx`
- `src/components/admin/PdvCatalog.tsx`, `PdvTabPanel.tsx`
- `src/components/portal/TabWidget.tsx`
- `src/routes/_authenticated/admin.pdv.tsx`

Editados:
- `src/routes/_authenticated/admin.index.tsx` (botão Scanner)
- `src/routes/_authenticated/portal.index.tsx` (TabWidget no topo)
- `src/components/admin/AdminDock.tsx` (item PDV)
- `package.json` (`@yudiel/react-qr-scanner`)
