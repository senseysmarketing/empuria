
# Módulo de Vendas — Esteira 1 (Checkout Frictionless)

## 1. Banco de dados (migration única)

**Novas tabelas / colunas**
- `availability_slots` — `id, service_id, starts_at, ends_at, capacity (int), booked (int default 0), is_active`. Slots cadastrados pelo Admin; checkout consome decrementando capacity.
- `orders` — adicionar colunas: `service_metadata jsonb` (voo, malas, slot_id, terminal, etc.), `slot_id uuid null`, `delivery_status text` (`aguardando_documentos`, `processando`, `agendado`, `concluido`), `staff_id uuid null`, `host_profile_id uuid null` (anfitrião do aeroporto).
- `order_documents` — checklist interativo do membro: `id, order_id, label, checked bool, updated_at`.
- `services` — popular as 5 linhas oficiais via seed (Recepção, Tour Econômico, Tour Raiz, Vale Transporte, Conta Bancária, Reunião Presencial) com `category` adequada e flags `requires_slot`, `requires_documents`, `kind` (`airport|tour|consulting|banking|meeting`).
- Trigger: ao mudar `payment_status='aprovado'` gera `voucher_code` e cria `activity_feed` (já existe parcialmente — estender).
- Trava de overlap entre Tour Raiz e Reunião Presencial compartilhando staff: validação no server function que cria slot/reserva (não CHECK constraint).

**RLS**
- `availability_slots`: SELECT público (`is_active=true`), staff manage.
- `order_documents`: dono do pedido + staff.

## 2. Backend — Server Functions

`src/lib/checkout/`
- `checkout.functions.ts`
  - `checkEmail({email})` — público, retorna `{exists: boolean}` (consulta `auth.users` via `supabaseAdmin`).
  - `createCheckoutIntent({serviceSlug, contact:{name,email,whatsapp,password}, serviceData})` — Regra de Ouro: numa única transação (a) cria usuário se não existir / autentica se existir, (b) reserva slot se aplicável (incrementa `booked`), (c) insere `orders` status `pendente`, (d) retorna `{orderId, voucherPreview, mockPix:{qr,copyPaste}, sessionToken}`.
  - `confirmMockPayment({orderId})` — simula webhook: marca `aprovado`, gera voucher, cria activity_feed, e devolve sessão autenticada (auto-login).
  - `getSlotsForService({serviceId, from, to})` — público.
- `src/lib/admin/slots.functions.ts` — CRUD de `availability_slots` (staff).
- `src/lib/portal/services.functions.ts` — `getMyServices()` para o painel do membro (orders + documentos + slot + host).
- `src/lib/admin/delivery.functions.ts` — atualizar `delivery_status`, atribuir `host_profile_id` (aeroporto) / `staff_id` (banco), avançar etapas.

## 3. UI — Vitrine pública

- **Landing (home)**: nova seção `#servicos` com bento grid 5 cards resumidos (ícone, título, preço, CTA "Ver detalhes" → `/servicos/[slug]`, CTA "Comprar" abre Checkout modal direto).
- **Nova rota `/servicos`**: bento grid completo com descrição + CTA.
- **Nova rota `/servicos/$slug`**: página de detalhe com hero, inclusões, FAQ curto, e bloco de compra (calendário se aplicável + botão Comprar).

Componentes:
- `src/components/checkout/CheckoutModal.tsx` — wrapper Dialog responsivo.
- `src/components/checkout/ServiceDataStep.tsx` — render condicional por `service.kind`:
  - `airport` → data, hora, voo, terminal, malas
  - `tour|meeting` → `SlotPicker` (calendário consumindo `getSlotsForService`)
  - `consulting|banking` → sem dados extras
- `src/components/checkout/ContactStep.tsx` — Nome, WhatsApp, Email. Email com debounce `checkEmail` → renderiza input senha com label condicional (novo usuário vs login).
- `src/components/checkout/PaymentStep.tsx` — após "Comprar Agora": chama `createCheckoutIntent`, mostra tabs PIX (QR mock + copia-cola) / Cartão (form fake) com botão "Simular pagamento aprovado" → `confirmMockPayment` → redireciona `/portal`.
- `src/components/services/ServiceCard.tsx` e `ServiceDetail.tsx`.

## 4. UI — Portal do Membro (entrega)

Estender `/portal` com aba "Meus Serviços" renderizando card por `order.payment_status='aprovado'`, com layout específico por `service.kind`:

- **Aeroporto**: foto+nome do `host_profile`, botão "Falar com meu anfitrião" (link `wa.me` — UI pronta).
- **Tour**: voucher animado + endereço Gran Vía + QR check-in + checklist estático.
- **Vale Transporte**: `order_documents` como checklist interativo + botão "Documentos em mãos? Prosseguir" (atualiza `delivery_status`).
- **Banco**: checklist + barra de progresso 3 etapas baseada em `delivery_status` + card final com endereço da agência quando `concluido`.
- **Reunião**: data/hora + botão Google Maps + badge de lembrete 24h (push fake / toast on mount se faltar <24h).

## 5. UI — Admin (gestão)

- **Esteira (existente)**: estender tabela para mostrar `kind`, `slot`, `delivery_status`, e ações específicas (atribuir host/staff, avançar etapa, marcar concluído). Drawer lateral com detalhes do pedido.
- **Nova rota `/admin/slots`**: gerenciar `availability_slots` por serviço, calendário visual com criar/desativar slot.
- **Agenda**: refletir bloqueio mútuo Tour×Reunião (já compatível com appointments_no_overlap; adicionar select de tipo).

## 6. Estética

- Vitrine pública: identidade marrom/yellow-brand existente.
- Checkout modal: Light Mode (mesmo dos painéis admin) — fundo off-white, sombra Apple, tipografia display nos títulos.
- Cards do Portal: aproveitar `BentoCard` adaptado para tema marrom.

## Detalhes técnicos

- Auto-login pós-mock: `confirmMockPayment` retorna nada sensível; cliente já está autenticado desde `createCheckoutIntent` (login feito via `supabase.auth.signInWithPassword` no servidor é impossível — fazer `signUp/signInWithPassword` no cliente após `checkEmail`, antes de chamar `createCheckoutIntent`). Ajuste: o cliente cuida da auth Supabase; o server function recebe a sessão via middleware.
- Gateway swap futuro: isolar `mockPayment` atrás de uma interface `PaymentProvider` em `src/lib/checkout/providers/`.
- QR code: reusar `qrcode` já instalado.
- Validação: Zod em todos os server functions, limites de tamanho.
- Sem WhatsApp real — botões apenas geram link `wa.me`.

## Entregáveis

```text
migration: availability_slots, orders+cols, order_documents, services seed
src/lib/checkout/* (3 server functions + provider mock)
src/lib/admin/slots.functions.ts, delivery.functions.ts
src/lib/portal/services.functions.ts
src/components/checkout/* (modal + 3 steps + SlotPicker)
src/components/services/* (card, detail, grid)
src/routes/servicos.tsx, src/routes/servicos.$slug.tsx
src/routes/_authenticated/admin.slots.tsx
update: src/routes/index.tsx (seção #servicos),
        src/routes/_authenticated/portal.tsx (aba Meus Serviços),
        src/routes/_authenticated/admin.esteira.tsx (ações de entrega),
        AdminDock (novo ícone Slots)
```
