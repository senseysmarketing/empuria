## Portal Admin Empuria — Plano de implementação

Entrega completa dos 6 módulos em **light mode** (cinza quase branco, acentos da identidade Empuria: amarelo/laranja/marrom para tipografia e ícones), grids bento, dock inferior, fontes Unbounded (display) + Philosopher (body).

---

### 1. Shell & Design System

- Novo layout `src/routes/_authenticated/admin.tsx` convertido em **layout route** (`/admin` com `<Outlet />`) — dock fixo + área de conteúdo.
- Componente `<AdminDock />`: barra inferior largura total, fundo `bg-brown-dark`, ícones offwhite, expande ao hover revelando label. Itens: Cockpit, Esteira 1, Triagem, Agenda, Clube, Automações.
- Tokens light em `styles.css`: `--admin-bg` (#F7F7F5), `--admin-surface` (#FFFFFF), `--admin-border`, `--admin-ink`, métricas grandes Unbounded.
- Componentes base reutilizáveis: `<BentoCard>`, `<MetricTile>`, `<DataTable>`, `<KanbanColumn>`, `<StatusPill>`.

### 2. Banco de dados (migração única)

Novas tabelas/colunas no Supabase com RLS (staff-only via `is_staff()`):

- `orders` — pedidos da Esteira 1 (user_id, service_id, status pgto, valor, voucher_code, executed_at).
- `activity_feed` — eventos em tempo real (actor_id, type, payload jsonb).
- `lead_qualifications` — colunas extras nos `leads`: `pipeline_stage` (novo/analise/qualificado/descartado), `qualification_score`, respostas do form jsonb.
- `arrivals` — check-in da recepção (lead_id ou user_id, arrived_at, notes).
- `staff_assignments` — alocação de membro da equipe para appointment.
- `club_content` — vídeos/módulos do Clube (title, video_url, module, published).
- `community_posts` — mural (author_id, body, pinned).
- `automation_triggers` — config on/off + template (key, enabled, channel, template_text).
- Triggers para popular `activity_feed` em inserts de orders/leads/profiles.

### 3. Módulo 1 — Cockpit (`/admin`)

Bento grid denso na home do admin:

- 3 `<MetricTile>` topo: Vendas do dia (€), Novos membros Clube (período), Reuniões hoje.
- Card grande: gráfico de receita 30 dias (Recharts area chart).
- Card lateral: **Feed de atividade** em tempo real via Supabase Realtime na tabela `activity_feed`.
- Card: **Chegadas hoje** com botão "Registrar chegada" (modal: busca lead/cliente → insere em `arrivals`).
- Card: próximos 3 agendamentos com responsável.

### 4. Módulo 2 — Esteira 1 (`/admin/esteira`)

- Tabela densa de `orders` com filtros (status, serviço, data).
- Coluna voucher: gera QR code (lib `qrcode`) ao confirmar pagamento; download/preview.
- Coluna "Responsável" mostrando staff alocado quando o serviço é presencial.
- Ação rápida: marcar como executado.

### 5. Módulo 3 — Triagem Kanban (`/admin/triagem`)

- 4 colunas drag-and-drop (`@dnd-kit/core`): Novos, Em análise, Qualificado, Descartado.
- Card lead expandível: dados pessoais + respostas do form de pré-qualificação destacadas (orçamento, prazo, doc).
- Botão "Qualificar" → muda stage + envia (placeholder) link de agenda premium + cria registro em `activity_feed`.
- Botão "Descartar como curioso" → envia (placeholder) e-mail oferecendo Clube.
- Server fns: `updateLeadStage`, `qualifyLead`, `dismissLead`.

### 6. Módulo 4 — Calendário Inteligente (`/admin/agenda`)

- Grade semanal estilo Apple Calendar: colunas = dias, linhas = horas.
- Cruza `appointments` (sala Gran Vía) + tours na cidade — cores distintas por tipo.
- Click slot vazio → modal criar agendamento manual + alocar staff.
- Bloqueio automático: como `appointments` já existe, RLS + check de sobreposição via constraint `EXCLUDE USING gist` (btree_gist já habilitado).

### 7. Módulo 5 — Clube & Comunidade (`/admin/clube`)

- Aba 1 **Membros**: tabela `profiles` com `is_club_member`, status assinatura, toggle ativo/inativo.
- Aba 2 **Conteúdo**: CRUD em `club_content` — upload via Supabase Storage bucket `club-videos` (criado na migration), preview, ordem por módulo.
- Aba 3 **Mural**: CRUD `community_posts` com pin/unpin.

### 8. Módulo 6 — Automações (`/admin/automacoes`)

- Lista de gatilhos pré-cadastrados (seed inicial: WhatsApp pós-compra Vale Transporte, Notificação lead high-ticket, etc.).
- Cada card: toggle on/off, editor de template (variáveis `{{nome}}`, `{{endereco}}`), select de canal (WhatsApp / E-mail / Painel).
- **Sem integração real** — apenas UI + persistência em `automation_triggers`. Banner discreto: "Conecte um provedor para ativar envios reais".

### 9. Server functions (`src/lib/admin/*.functions.ts`)

Todas protegidas com `requireSupabaseAuth` + verificação `has_role('admin')` ou `is_staff`:

- `getCockpitMetrics`, `getActivityFeed`, `registerArrival`
- `listOrders`, `markOrderExecuted`, `generateVoucher`
- `listLeadsKanban`, `updateLeadStage`, `qualifyLead`, `dismissLead`
- `listAppointments`, `createAppointment`, `assignStaff`
- `listClubMembers`, `toggleMembership`, CRUD `club_content` e `community_posts`
- CRUD `automation_triggers`

### 10. Realtime

- Cockpit feed: `supabase.channel('activity').on('postgres_changes', ...)` na browser client.
- Kanban: realtime em `leads` para mover cards quando outro admin atualiza.

---

### Estrutura final de arquivos novos

```text
src/routes/_authenticated/admin.tsx           (vira layout com dock)
src/routes/_authenticated/admin/index.tsx     (Cockpit)
src/routes/_authenticated/admin/esteira.tsx
src/routes/_authenticated/admin/triagem.tsx
src/routes/_authenticated/admin/agenda.tsx
src/routes/_authenticated/admin/clube.tsx
src/routes/_authenticated/admin/automacoes.tsx
src/components/admin/
  AdminDock.tsx, BentoCard.tsx, MetricTile.tsx,
  ActivityFeed.tsx, ArrivalDialog.tsx, OrdersTable.tsx,
  VoucherQR.tsx, LeadKanban.tsx, LeadCard.tsx,
  CalendarGrid.tsx, ClubMembersTable.tsx,
  ContentManager.tsx, CommunityWall.tsx, AutomationCard.tsx
src/lib/admin/
  cockpit.functions.ts, esteira.functions.ts, triagem.functions.ts,
  agenda.functions.ts, clube.functions.ts, automacoes.functions.ts
supabase/migrations/<timestamp>_admin_portal.sql
```

### Dependências a adicionar

`@dnd-kit/core`, `@dnd-kit/sortable`, `qrcode`, `recharts` (se não estiver), `date-fns`.

### Notas

- Mantém o `/admin` antigo (substituído pelo novo Cockpit) — link "Painel Admin" do portal continua funcionando.
- Light mode é só do `/admin/*`; landing e `/portal` permanecem como estão.
- Sem WhatsApp/e-mail real nesta entrega; placeholders documentados na UI.
- Como o escopo é grande, espere uma sequência de turnos para ir construindo módulo a módulo após sua aprovação.
