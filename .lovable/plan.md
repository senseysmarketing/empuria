# Evolução da tela /admin/agenda

Transformar a /admin/agenda em uma central única (sem abas) inspirada no Google Agenda, com criação unificada de Compromissos, Tarefas, Vagas e Eventos, validações fortes contra datas passadas, e um ponto visual para futura integração com Google Agenda.

A implementação será incremental, em fases, priorizando primeiro as validações críticas (vagas retroativas / vencidas) e depois a unificação visual.

---

## 1. Estrutura da nova tela

Remove as abas atuais (`Calendário` / `Vagas & Slots`) e adota um único layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Agenda Empuria                                               │
│ [Hoje] [<] 01 jun – 07 jun [>]   [Dia|Semana|Mês]            │
│                       [Conectar Google Agenda — Em breve]    │
│                       [+ Criar ▾]                            │
├──────────────────────────────────────────────────────────────┤
│ Resumo: Hoje · Agora · Próximos · Vagas abertas · Pendências │
│ Filtros: Todos · Compromissos · Tarefas · Vagas · Eventos ·  │
│          Consultoria · Tour · Clube · Burocracia             │
├────────────────────────────────────┬─────────────────────────┤
│ Calendário unificado (semana       │ Lateral:                │
│ inicialmente — Dia/Mês como        │  · Hoje                 │
│ evolução)                          │  · Próximos             │
│ Compromissos + Tarefas + Vagas     │  · Já ocorreu           │
│ + Eventos, cores por categoria     │  · Alertas              │
└────────────────────────────────────┴─────────────────────────┘
```

Cores mantidas: Consultoria azul, Tour verde, Burocracia âmbar, Clube roxo, Tarefa cinza neutro, Vaga com contorno pontilhado, Evento com cor de destaque, cancelados/encerrados com opacidade reduzida.

## 2. Botão + Criar

Um único `DropdownMenu` no topo abre quatro opções, cada uma abrindo um modal específico (sem trocar de rota):

- **Compromisso** → modal novo (serviço, cliente, data/hora início e fim, notas) gravando em `appointments`.
- **Tarefa** → modal novo (título, descrição, vencimento, responsável, prioridade) gravando em nova tabela `calendar_tasks`.
- **Vaga** → reaproveita o `NewSlotDialog` atual do `SlotsPanel`, com validações reforçadas.
- **Evento** → reaproveita o **mesmo modal de criação/edição** já existente em `/admin/eventos`, extraindo-o para um componente compartilhado.

## 3. Validações críticas (prioridade máxima)

Aplicar tanto no client quanto no server (`createServerFn` em `slots.functions.ts` e `agenda.functions.ts`):

- Vaga: `starts_at >= now()` e `ends_at > starts_at`.
- Compromisso: mesma regra de data/hora não retroativa + checar sobreposição (já existe `appointments_no_overlap`).
- Vagas vencidas (`ends_at < now()`) nunca aparecem como disponíveis para compra/agendamento no portal.
- Vagas lotadas (`booked >= capacity`) idem.
- Status calculado (fase 1, sem migração): `Inativa | Encerrada | Lotada | Aberta`.

Atualizar `listSlots` e queries públicas usadas pelo portal (`SlotPicker`) para filtrar `starts_at > now()` e `is_active = true` antes de retornar.

## 4. Tarefas internas — nova tabela

Migração para `calendar_tasks` (status, prioridade, vencimento, responsável, criador). Apenas staff pode ler/escrever (RLS via `is_staff`). A migração será apresentada para aprovação antes da implementação.

## 5. Botão Google Agenda — Em breve

Botão estilizado igual aos demais do topo, desabilitado (`cursor-not-allowed`), com tooltip "Integração em breve". Nenhum código de OAuth/sync nesta fase.

## 6. Reaproveitamento do modal de Evento

Extrair o modal/form atual de `/admin/eventos` para `src/components/admin/eventos/EventFormDialog.tsx` controlado por props (`open`, `onOpenChange`, `eventId?`). A página `/admin/eventos` e o `+ Criar → Evento` da agenda passam a usar o mesmo componente, invalidando as queries `["admin-events"]` e `["agenda", ...]` após salvar para refletir nas duas telas.

## 7. Fases de implementação

1. **Fase 1 — Validações críticas** (server + portal): bloquear vaga retroativa, ocultar vagas vencidas/lotadas.
2. **Fase 2 — Nova UI da agenda**: remover abas, adicionar topo unificado, cards de resumo, filtros, botão Google Agenda (visual) e botão `+ Criar` com as 4 opções.
3. **Fase 3 — Modais Compromisso e Vaga** integrados ao `+ Criar`.
4. **Fase 4 — Tarefas**: migração `calendar_tasks` + modal + exibição no calendário/lateral/resumo.
5. **Fase 5 — Eventos integrados**: extrair `EventFormDialog`, usar na agenda, garantir sincronização de queries.
6. **Fase 6 — Documentar** pontos da futura integração Google Agenda (sem código).

## Detalhes técnicos

- Arquivos principais alterados: `src/routes/_authenticated/admin.agenda.tsx`, `src/components/admin/SlotsPanel.tsx`, `src/lib/admin/slots.functions.ts`, `src/lib/admin/agenda.functions.ts`, `src/routes/_authenticated/admin.eventos.tsx`, `src/lib/checkout/checkout.functions.ts` / `src/components/checkout/SlotPicker.tsx` (filtro de vagas vencidas).
- Novos arquivos: `src/components/admin/agenda/CreateMenu.tsx`, `AppointmentDialog.tsx`, `TaskDialog.tsx`, `AgendaSidebar.tsx`, `AgendaSummary.tsx`, `AgendaFilters.tsx`, `src/components/admin/eventos/EventFormDialog.tsx`, `src/lib/admin/tasks.functions.ts`.
- Migração Supabase: tabela `calendar_tasks` com RLS `is_staff`, grants para `authenticated` e `service_role`, trigger `update_updated_at_column`.
- Rota antiga `/admin/agenda?tab=slots` continua redirecionando (compat) para `/admin/agenda`.

## Fora de escopo

- Integração real com Google Agenda (OAuth, sync, conflitos).
- CRM / follow-ups.
- Migração de `status` persistido em `availability_slots` (fica para fase futura).

Confirmando este plano, começo pela Fase 1 (validações) e a migração `calendar_tasks` para aprovação.