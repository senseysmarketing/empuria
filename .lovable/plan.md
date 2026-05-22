
# Módulo de Eventos & Smart Tickets

Sistema nativo de eventos com landing pages dinâmicas, ingressos simples ou multi-categoria, checkout frictionless (pagamento mockado por enquanto) e validação na portaria via QR do Passaporte Empuria.

---

## Decisões confirmadas

- **Múltiplos ingressos por usuário**: permitido. Na portaria, mostra `INGRESSO VIP × 3` com 3 botões de check-in individual (ou "Check-in de todos").
- **Eventos gratuitos**: mesmo fluxo de checkout (nome/WhatsApp/email/senha), sem etapa de pagamento — tela final "Reserva confirmada".
- **Pagamento**: UI mockada (tela de "PIX gerado" fake + botão "Simular pagamento aprovado"). Sem gateway real.

---

## 1. Banco de dados (migration)

- **`events`**: slug (unique), title, description, starts_at, ends_at, location_address, location_lat/lng (nullable), cover_url, cover_kind ('image'|'video'), sales_mode ('simples'|'categorias'), is_published, created_by.
- **`event_ticket_tiers`** (sempre existe; simples = 1 tier "Padrão"): event_id, name, price_cents, capacity (nullable), sold, benefits (jsonb tags), position, is_active.
- **`event_tickets`**: event_id, tier_id, user_id, order_id (nullable p/ gratuitos), code (8 chars), status ('valido'|'usado'|'cancelado'), checked_in_at, checked_in_by, notes. **Sem unique por user+event** (múltiplas compras permitidas).
- **Trigger**: inserir ticket válido → `sold++`; deletar/cancelar → `sold--`. Bloqueia insert se `sold >= capacity`.
- **RLS**: events/tiers públicos quando `is_published`; tickets visíveis ao dono e staff; insert via server fn.
- **Bucket Storage** `event-covers` (público).
- **Seed**: 1 evento demo "Sunset de Imigração na Gran Vía" com 3 tiers (Standard €15 / Premium €30 / VIP €45).

---

## 2. Admin — Gestão de Eventos

Nova rota `/admin/eventos` + item no `AdminDock`.

- **Lista**: próximos / passados / rascunhos, com vendidos / capacidade / receita.
- **Criar/Editar** (`/admin/eventos/novo`, `/admin/eventos/$id`):
  - Form: título, slug auto-gerado, datas, endereço, upload de capa, rich-text simples.
  - Toggle **Simples vs Categorias**:
    - Simples: preço + toggle "Capacidade limitada" → input numérico.
    - Categorias: repeater (Nome, Preço, Capacidade, Benefícios em chips).
  - "Publicar" → `is_published=true`.
- **Detalhe de vendas**: lista de tickets, busca, contagem de check-ins ao vivo (realtime), exportar CSV.

Server fns: `createEvent`, `updateEvent`, `publishEvent`, `listEventsAdmin`, `getEventAdmin`, `listEventTickets`.

---

## 3. Landing Page Pública — `evento.$slug.tsx`

Loader chama server fn pública (admin-elevada, filtro `is_published=true`).

- **Hero**: imagem/vídeo com overlay, título Unbounded branco, data em `#e5a657`, countdown.
- **Bento Grid**: Sobre (Philosopher / offwhite), Local (Google Maps via connector com `loading=async&callback=initMap`; fallback "Local a definir / Online"), Quando (+ `.ics`).
- **Vitrine de Ingressos**:
  - Simples: gatilho de escassez ("Restam X") se houver capacidade.
  - Categorias: cards Bento com radio, nome, preço, benefícios; esgotado = cinza + tag.
  - **Seletor de quantidade** (1–10) por categoria, já que múltiplos ingressos são permitidos.
- **Sticky CTA**: label dinâmico — `Garantir meu ingresso · € X`, `Reservar (Gratuito)`, ou `Comprar 2× VIP (€ 90)`.
- SEO: head() com title/description/og:image = cover_url.

---

## 4. Checkout Inteligente (estende `CheckoutModal`)

Aceita novo input `{ ticketTierId, qty }`. Fluxo:

1. Captura Nome / WhatsApp / Email.
2. `email_exists` → novo pede senha (cria conta) / existente pede senha (login).
3. **Tela de resumo**: evento + categoria + qty + total. Botão obrigatório **"Comprar Agora"** (Regra de Ouro). Em gratuitos, label = "Confirmar Reserva".
4. **Pagamento mockado**:
   - Pago: tela com QR PIX fictício (SVG placeholder) + botão **"Simular pagamento aprovado"** (dev-only, visível por enquanto).
   - Gratuito: pula direto pra confirmação.
5. Server fn `confirmTicketPurchase({ tierId, qty })` cria N linhas em `event_tickets` (status `valido`, code único cada), opcionalmente cria `orders` row mockada.
6. Redireciona para `/portal/ingressos` com toast "🎟️ Ingresso(s) garantido(s)".

---

## 5. Portal do Membro

- **Banner no `/portal`** (quando há ingresso para hoje): "🎟️ Você tem N ingresso(s) para *Evento X* hoje — apresente seu Passaporte na entrada".
- Nova rota `/portal/ingressos` listando futuros e passados (evento, categoria, qty, status, código). Sem QR próprio — o Passaporte vitalício é a chave.
- Item no `PortalDock`.

---

## 6. Scanner Admin de Ingressos

Reusa o `PassportScannerDialog` em **modo evento**. Novo item no `AdminDock` "Validar Ingresso" e botão dentro do detalhe do evento.

Fluxo:
1. Staff seleciona evento ativo (auto se houver só um hoje) → abre scanner.
2. Lê `empuria:<uuid>` → server fn `validateEventTicket({ eventId, userId })`.
3. Retorno:
   - ✅ **Verde tela cheia**: foto + nome + lista de tickets do usuário p/ esse evento (`INGRESSO VIP × 3`, `STANDARD × 1`), notas. Para cada ticket, botão **"Check-in"** (marca `status=usado`, `checked_in_at`, `checked_in_by`); botão extra **"Check-in de todos"**. Tickets já usados aparecem em cinza com hora do check-in. Check-in é opcional.
   - ❌ **Vermelho tela cheia**: "Ingresso não encontrado para este evento" ou "Todos os ingressos já foram utilizados".
4. Botão "Próximo" volta ao scanner.

---

## Arquivos

**Criar:**
- `supabase/migrations/...events.sql` (tabelas, RLS, trigger de inventário, bucket, seed)
- `src/lib/admin/events.functions.ts`
- `src/lib/events/public.functions.ts`
- `src/lib/events/checkout.functions.ts` (confirmTicketPurchase)
- `src/lib/admin/ticket-validation.functions.ts`
- `src/routes/_authenticated/admin.eventos.tsx` (lista)
- `src/routes/_authenticated/admin.eventos.novo.tsx`
- `src/routes/_authenticated/admin.eventos.$id.tsx`
- `src/routes/evento.$slug.tsx`
- `src/routes/_authenticated/portal.ingressos.tsx`
- `src/components/events/EventHero.tsx`
- `src/components/events/TicketTierCard.tsx`
- `src/components/events/StickyTicketCTA.tsx`
- `src/components/events/EventMap.tsx`
- `src/components/admin/EventForm.tsx` (com repeater de tiers)
- `src/components/admin/TicketScannerDialog.tsx`
- `src/components/admin/TicketValidationResult.tsx`
- `src/components/portal/EventTicketBanner.tsx`
- `src/components/checkout/MockPaymentStep.tsx` (PIX fake + "Simular pagamento")

**Editar:**
- `AdminDock.tsx`, `PortalDock.tsx`
- `CheckoutModal.tsx` (suporte a `ticketTierId` + `qty` + modo gratuito)
- `portal.index.tsx` (banner do dia)

---

## Stack notes

- Server fns em `*.functions.ts`, com `requireStaff` para admin e `requireSupabaseAuth` para checkout.
- Loader da landing pública usa server fn admin-elevada (filtro `is_published=true`) — público sem auth.
- Realtime em `event_tickets` p/ contagem de check-ins no admin.
- Google Maps via connector (browser key + `loading=async&callback=initMap`).
- Mock pagamento isolado em `MockPaymentStep` para troca futura por gateway real.
