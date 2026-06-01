## Objetivo
Aplicar correções pedidas e fechar as lacunas restantes do escopo PDF na tela `/admin/agenda`.

## 1. Cabeçalho da seção Vagas & Slots
`src/components/admin/SlotsPanel.tsx`
- Colocar o título "Vagas & Slots" na **mesma linha** que o `Select` de filtro e o botão "Nova vaga" (`flex items-center justify-between`).
- Remover o `<h2>` solto que hoje fica em `admin.agenda.tsx` (passa a viver dentro do painel).

## 2. Vagas aparecerem no calendário (faltava)
`src/routes/_authenticated/admin.agenda.tsx`
- Buscar `availability_slots` da semana via `listSlots` (já existe) e mesclar na grade horária junto com `appointments`.
- Renderizar slots com estilo distinto (borda pontilhada / contorno) conforme PDF §14, mostrando "Vaga · serviço · X/Y".
- Cor por categoria do serviço quando disponível.

## 3. Status calculado (Aberta / Lotada / Encerrada / Inativa) — PDF §17
`src/components/admin/SlotsPanel.tsx` (badge da tabela) e cards do calendário:
```
is_active === false  -> Inativa
ends_at < now        -> Encerrada
booked >= capacity   -> Lotada
caso contrário       -> Aberta
```
Aplicar opacidade reduzida em Encerrada/Inativa.

`src/lib/checkout/checkout.functions.ts` já bloqueia compra vencida ✓.
`src/lib/portal/services.functions.ts` / lista pública de slots: garantir filtro `ends_at > now()` e `is_active = true` na consulta para o portal não oferecer slot vencido.

## 4. Eventos no calendário (faltava) — PDF §5, §14
- Buscar eventos da semana (`events` via nova função `listWeekEvents` em `events.functions.ts`) e renderizar na grade com cor própria.
- Edição/criação continua usando o modal de `/admin/eventos` (já redireciona).

## 5. Tarefas no calendário (faltava parcial)
- Buscar `calendar_tasks` da semana via nova `listWeekCalendarTasks` em `calendar-tasks.functions.ts`.
- Renderizar com cinza/neutro; tarefa com `due_at < now` e status `pendente` recebe destaque "Atrasada".
- Botão de concluir/cancelar em tooltip/clique.

## 6. Resumo correto — PDF §6
Corrigir a barra de tiles:
- Hoje · Agora · Próximos · **Vagas abertas (computado de slots, não de appointments)** · **Tarefas pendentes**.

## 7. Filtros (faltava) — PDF §7
Adicionar barra de chips: Todos / Compromissos / Tarefas / Vagas / Eventos / Consultoria / Tour / Clube / Burocracia, controlando a renderização do calendário.

## 8. Lateral (faltava) — PDF §6/§14
Adicionar coluna lateral à direita com:
- Hoje · Próximos · Já ocorreu · Alertas (vagas vencidas ainda ativas, tarefas atrasadas).
Layout: `grid lg:grid-cols-[1fr_320px]` no bloco do calendário.

## 9. Views Dia / Semana / Mês — PDF §7
Adicionar `ToggleGroup` visual (Dia/Semana/Mês). Implementar **Semana** (atual) e **Dia** (mesma grade filtrada a 1 coluna). **Mês** entra como visual desabilitado "Em breve" para evolução incremental (PDF permite).

## 10. Checklist do PDF não coberto antes — confirmação
- [x] Validações de data passada em slots/appointments (já feito anteriormente)
- [x] Checkout bloqueia slot vencido (já feito)
- [ ] Portal não listar slots vencidos → ajuste na query pública
- [ ] Logs/auditoria ao cancelar vaga com reservas → fora desta fase, manter `confirm()` com aviso mais explícito quando `booked > 0`

## Arquivos a alterar/criar
- `src/components/admin/SlotsPanel.tsx` (header inline, status calculado)
- `src/routes/_authenticated/admin.agenda.tsx` (filtros, lateral, tiles, views, merge slots+events+tasks)
- `src/lib/admin/events.functions.ts` (+ `listWeekEvents`)
- `src/lib/admin/calendar-tasks.functions.ts` (+ `listWeekCalendarTasks`)
- `src/lib/portal/services.functions.ts` ou equivalente (filtro `ends_at > now()` e ativo)

Sem migrações de banco nesta etapa.
