## Objetivo

Reconstruir o Portal do Membro (`/portal`) aplicando o mesmo sistema visual do `/admin` (BentoCard, dock fixo inferior, tipografia Unbounded/display, tokens `admin-*`), com 4 telas modulares, empty states ativos e skeletons.

## Arquitetura de Rotas

Converter `portal.tsx` em **layout** com Outlet + PortalDock, e criar rotas filhas:

```
src/routes/_authenticated/
  portal.tsx              → layout (guard member + dock)
  portal.index.tsx        → Dashboard (A Chegada)
  portal.clube.tsx        → Clube do Imigrante (streaming)
  portal.servicos.tsx     → Meus Serviços (vouchers + progresso)
  portal.loja.tsx         → Nova Compra / Up-sell
```

## Telas

### 1. Dashboard (`portal.index.tsx`) — "A Chegada"
Layout grid 12-col bento (igual cockpit):
- **Header**: saudação dinâmica ("Bem-vindo a Madrid, {nome}" se tem agendamento futuro próximo, senão "Preparando sua jornada, {nome}").
- **BentoCard Passaporte Empuria** (col-span-8): cartão de embarque premium — gradient brown→orange, dados do membro, QR Code (lib `qrcode` já instalada) com o `user.id`, número de "passageiro", desde quando é membro.
- **BentoCard Próximo Passo** (col-span-4): widget dinâmico — se há tour/reunião agendada → data, hora, CTA "Ver detalhes"; senão → convite "O café está quente na Gran Vía. Venha nos visitar hoje!" com CTA para `/portal/loja`.
- **MetricTiles** (4 tiles): Serviços ativos, Próximo agendamento (em X dias), Status Clube, Vouchers disponíveis.
- **BentoCard Atividade recente** (col-span-8): últimas compras/atualizações de status.
- **BentoCard Recomendados** (col-span-4): 2 serviços sugeridos da loja.

### 2. Clube do Imigrante (`portal.clube.tsx`) — Estilo Streaming
- Header com status de associação. Se não-associado → CTA "Associar-se" + preview bloqueado.
- Carrosséis horizontais por categoria (Passos Iniciais, Mentalidade do Imigrante, Cultura Espanhola): capas grandes 16:9, snap-scroll.
- Player de vídeo integrado em modal/Dialog (HTML5 `<video>` ou iframe Vimeo/YouTube embed) — sem sair da plataforma.
- Dados via novo `getClubContent` server fn lendo de uma nova tabela `club_content` (categoria, título, descrição, capa, video_url, ordem). **Migration necessária**.

### 3. Meus Serviços (`portal.servicos.tsx`) — Carteira
- Reusa/expande `MyServicesPanel` já existente (orders + delivery status + QR de tour + checklist banking).
- Adiciona: **barra de progresso visual** para serviços high-ticket (Relocation/Visto) — passos definidos por `service.kind`. Os estados já existem em `delivery_status`.
- Seção "Pendentes de pagamento" e "Concluídos".
- Empty state: banners clicáveis para `/portal/loja`.

### 4. Loja / Up-sell (`portal.loja.tsx`)
- Grid de cards de serviços da Esteira 1 (reusa `getPublicServices`).
- Clique no card → Drawer/Sheet lateral com resumo + botão **"Comprar agora"** (explícito).
- Apenas após clique → gera ordem (`createOrderForCheckout` existente) e exibe QR PIX / link Stripe. Sem geração antecipada.

## Componentes novos (em `src/components/portal/`)

- `PortalDock.tsx` — análogo ao `AdminDock`, itens: Início, Clube, Serviços, Loja, Sair. Mesma estética (fixed bottom, rounded, brown-deep).
- `PassportCard.tsx` — cartão de embarque com QR.
- `NextStepWidget.tsx` — widget dinâmico de próximo passo.
- `ClubCarousel.tsx` + `VideoPlayerModal.tsx`.
- `ServiceProgressBar.tsx` — barra de etapas para high-ticket.
- `UpsellSheet.tsx` — drawer de compra com botão explícito.
- `PortalSkeleton.tsx` — skeleton screens (pulse cinza) para loading.

## Reuso

- `BentoCard`, `MetricTile` do admin (mesmos arquivos).
- Tokens `bg-admin-bg`, `text-admin-ink`, `border-admin-border` — funcionam no portal também (mesma paleta brown/offwhite/orange).
- `MyServicesPanel` (já existe) → mover lógica para `portal.servicos.tsx`.

## Server Functions

Novas em `src/lib/portal/`:
- `dashboard.functions.ts` → `getPortalDashboard` (perfil + próximos appts + métricas + sugestões).
- `clube.functions.ts` → `getClubContent` (lista por categoria, gated por `is_club_member`).

Reuso: `getMyServices`, `getPublicServices`, `createOrderForCheckout` (já existem).

## Migration (Supabase)

Tabela `club_content`:
- `id`, `category` (text), `title`, `description`, `cover_url`, `video_url`, `duration_seconds`, `order_index`, `published` (bool), timestamps.
- RLS: SELECT permitido a `authenticated` se `is_club_member = true` (via função `is_club_member(uid)`) OU se `published` and preview-only flag. Admin/staff INSERT/UPDATE/DELETE via `has_role`.
- Seed inicial: 2-3 vídeos por categoria (placeholder cover + video).

## UX / Detalhes

- **Skeletons** em todas as telas durante `isLoading` (substituem o "Carregando..." atual).
- **Transições**: `framer-motion` slide-x suave entre rotas filhas do portal.
- **Empty states ativos**: nunca texto vazio — sempre CTA/banner clicável.
- **Responsivo**: dock vira bottom bar em mobile; bento vira stack.

## Fora de escopo

- Pagamento real (mantém fluxo atual `createOrderForCheckout`).
- Upload de conteúdo do Clube via admin (apenas migration + seed; UI de gestão fica para iteração futura).
- Notificações push.

## Arquivos a criar

- 4 rotas em `src/routes/_authenticated/portal.*.tsx`
- 7 componentes em `src/components/portal/`
- 2 server fn files em `src/lib/portal/`
- 1 migration SQL

## Arquivos a editar

- `src/routes/_authenticated/portal.tsx` (vira layout)
- `src/components/admin/AdminDock.tsx` — atualizar link "Portal" para `/portal` (já está)
