## Visão geral
Construir o funil high-ticket ponta-a-ponta: Wizard público no botão "Aplicar para Consultoria" e CRM nativo (Kanban + dossiê) no Painel Admin, reaproveitando a tabela `leads` que já existe.

## 1. Banco de dados (migration)
- Estender enum `lead_pipeline_stage`: adicionar `em_contato`, `reuniao`, `fechado` (mantém `novo`, `descartado`; remove `analise`/`qualificado` da UI, mas conserva no enum para não quebrar dados antigos — mapeados como "Em contato"/"Fechado" na UI).
- Nova tabela `lead_activity_log`:
  - `lead_id` (FK leads.id, cascade), `kind` (enum: `created`, `stage_changed`, `note_added`, `meeting_scheduled`, `whatsapp_opened`), `payload jsonb`, `actor_id` (uuid nullable), `actor_label` (text), `created_at`.
  - Índice por `lead_id, created_at desc`.
  - RLS: leitura/escrita só para staff (`has_role admin/staff`).
- Trigger AFTER INSERT em `leads` → registra `created` no log.
- Trigger AFTER UPDATE em `leads` quando `pipeline_stage` muda → registra `stage_changed` com `{ from, to }`.
- RLS de `leads`: permitir INSERT público (anon) com colunas restritas pelo server fn admin (a inserção real virá via `supabaseAdmin`, então mantém RLS fechado para anon e abre apenas leitura para staff — mesmo padrão atual).

## 2. Server functions
Arquivo `src/lib/leads/public.functions.ts` (público, sem auth):
- `submitConsultoriaLead`: valida com Zod (nome 2-120, email, whatsapp 6-30, current_country enum, target_visa enum, timeline enum, budget_range enum, message opcional 0-1000). Calcula `qualification_score` 0-100 e `temperature` (alta/média/baixa) a partir de timeline + budget. Insere via `supabaseAdmin` em `leads` com `pipeline_stage='novo'` e `qualification_answers` cru. Retorna `{ ok, leadId, firstName }`.

Estender `src/lib/admin/triagem.functions.ts`:
- `listLeadActivity({ leadId })` — staff.
- `addLeadNote({ leadId, body })` — staff: insere `note_added` no log e atualiza `leads.notes` (append timestamped).
- `logWhatsappOpened({ leadId })` — staff: registra `whatsapp_opened` no log.
- `updateLeadStage` já existe; trigger cuida do log automaticamente.

## 3. Wizard de qualificação (front)
Arquivo `src/components/leads/ConsultoriaWizardModal.tsx`:
- `Dialog` shadcn fundo `bg-offwhite`, card central com `shadow-warm`, max-w-xl.
- Barra de progresso fina laranja no topo (`Progress` shadcn customizado, `bg-orange-brand`, transition 400ms).
- 4 passos com `framer-motion` (`AnimatePresence` slide + fade entre steps):
  1. **Onde você está morando agora?** — 3 botões grandes (Já estou na Espanha / Brasil / Outro país da Europa).
  2. **Qual é a sua principal necessidade hoje?** — 4 botões (Visto de Residência / Cidadania / Relocation Completo / Outros).
  3. **Prazo & Orçamento** — radios para timeline (≤3m / 3-6m / 6-12m / +12m) e budget (<2k€ / 2-5k€ / 5-10k€ / +10k€).
  4. **Identificação** — inputs Nome, E-mail, WhatsApp + botão "Enviar Aplicação".
- Após submit: fade-out do form e renderiza `SuccessFinale`:
  - SVG do contorno topográfico da Espanha (já existe `bg-topo` no projeto — usar mesmo path como SVG inline) animado com `pathLength` via framer-motion (line-draw 1.6s ease-out).
  - Título Unbounded: "Tudo certo, {firstName}! Recebemos seu dossiê."
  - Subtítulo Philosopher (`font-body italic`): "Nossa equipe fará a triagem inicial e entrará em contato pelo WhatsApp em até 24 horas."
  - Botão "Fechar" após 800ms.
- Controle: estado `{ open, setOpen }` exposto via prop; usado a partir de `src/routes/index.tsx` substituindo o `<a href="#">` por `<button onClick={() => setWizardOpen(true)}>`.
- Sem hash routing — wizard 100% client-side; após sucesso, `setTimeout` opcional para reset.

## 4. Triagem (Admin) — upgrades
`src/routes/_authenticated/admin.triagem.tsx`:
- `STAGES` passa para 5 colunas: `novo` (Novos Leads), `em_contato` (Em Contato), `reuniao` (Reunião Agendada), `fechado` (Fechado), `descartado` (Desqualificado). Grid responsivo `xl:grid-cols-5`.
- `LeadCard`: mostrar Nome, Serviço de interesse (target_visa), e tag de temperatura (🔥 Alta / ⚡ Média / ❄️ Baixa) calculada client-side a partir de timeline+budget. Cor da pílula por temperatura.
- Refazer `LeadDetail` como **Sheet lateral** (`src/components/ui/sheet.tsx`) tamanho `xl` (largura 540-640px), com layout Bento:
  - **Header fixo**: nome, badge da stage atual (select inline para trocar), data de entrada.
  - **Bloco 1 — Dossiê de Qualificação**: grid `bg-admin-surface-2` com as 6 respostas do Wizard (país atual, objetivo/visto, timeline, orçamento, contato, mensagem).
  - **Bloco 2 — Ação Rápida WhatsApp**: botão verde grande (`bg-emerald-600`) que monta `https://wa.me/{phone}?text={msg}` com template ("Olá {nome}, aqui é da equipe do Instituto Empuria. Vimos que você está planejando sua vinda para a Espanha..."). Ao clicar: `window.open` + `logWhatsappOpened`.
  - **Bloco 3 — Notas Internas**: `Textarea` + botão "Adicionar nota" → `addLeadNote` (insere no log + concatena em `leads.notes` com timestamp). Lista as notas anteriores.
  - **Bloco 4 — Linha do Tempo**: lista vertical cronológica (descendente) com ícone+label+ator+data relativa para cada evento de `lead_activity_log`. Usa `useQuery(['lead-activity', leadId])`.
- Cálculo de temperatura (helper compartilhado em `src/lib/leads/scoring.ts`): peso por timeline (≤3m=40, 3-6m=25, 6-12m=10, +12m=0) + budget (+10k€=40, 5-10k€=25, 2-5k€=15, <2k€=5). Score ≥60 → Alta, 30-59 → Média, <30 → Baixa.

## 5. Página inicial
`src/routes/index.tsx`: importar `ConsultoriaWizardModal`, manter botão "Aplicar para Consultoria" mas converter em `<button>` que abre o wizard. Sem outras mudanças no card high-ticket.

## Arquivos
- **Migration**: 1 arquivo (`extend lead_pipeline_stage`, criar `lead_activity_log`, RLS, triggers).
- **Novo**: `src/components/leads/ConsultoriaWizardModal.tsx`, `src/components/leads/SuccessFinale.tsx`, `src/lib/leads/public.functions.ts`, `src/lib/leads/scoring.ts`.
- **Editado**: `src/lib/admin/triagem.functions.ts`, `src/routes/_authenticated/admin.triagem.tsx`, `src/routes/index.tsx`.

## Notas técnicas
- `framer-motion` já está no projeto (usado em outros pontos); verificar e instalar se faltar.
- Wizard envia via `useServerFn(submitConsultoriaLead)` — função pública (sem `requireSupabaseAuth`), usa `supabaseAdmin` para gravar com RLS fechado.
- Triggers no Postgres garantem auditoria mesmo se rota client errar; `whatsapp_opened` e `note_added` são logados explicitamente pelas server fns.
- O texto pré-configurado do WhatsApp interpola `lead.full_name` no front; phone é normalizado removendo não-dígitos antes de montar `wa.me`.