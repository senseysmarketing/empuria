## Consolidação de telas redundantes no Admin

Concordo — `/admin/slots` e `/admin/agenda` resolvem o mesmo domínio (horários/atendimentos), e `/admin/clube` é basicamente uma aba a mais de gestão de pessoas que já vive em `/admin/usuarios`. Vou fundir tudo em **duas telas únicas com abas internas**, e enxugar o dock.

### 1. `/admin/agenda` absorve `/admin/slots`

Transformar a página em `Tabs` no topo:
- **Aba "Calendário"** — a grade semanal atual (visualização de compromissos).
- **Aba "Vagas & Slots"** — o conteúdo atual de `/admin/slots` (lista de vagas + filtro por serviço + diálogo "Nova vaga").

Header unificado: título "Agenda", subtítulo "Compromissos, vagas para Tours e Reuniões Presenciais". Os controles de navegação semanal (◀ ▶ Hoje) só aparecem na aba Calendário; o botão "Nova vaga" e o filtro de serviço só aparecem na aba Vagas.

### 2. `/admin/usuarios` absorve `/admin/clube`

Adicionar `Tabs` no topo:
- **Aba "Passaportes"** — toda a UI atual de `/admin/usuarios` (busca, filtros, métricas, lista, impersonação).
- **Aba "Clube — Conteúdo"** — o `ContentManager` atual de `/admin/clube` (cards de conteúdo + diálogo de criação/edição).
- **Aba "Clube — Mural"** — o `WallManager` atual (novo post + lista de posts fixáveis).

A gestão de "Membros" (toggle `is_club_member`) some como aba dedicada porque **já existe** na lista de Passaportes (filtro "Clube" + pill verde + ação no `UsuarioEditSheet.tsx`). Sem duplicação.

Métricas do clube (X membros · Y conteúdos · Z posts) viram um `MetricTile` extra na linha de métricas de `/admin/usuarios` quando a aba ativa for de Clube.

### 3. Dock enxuto

`AdminDock` passa de 10 para 8 itens, removendo `Vagas` e `Clube`:

```text
Cockpit · PDV · Eventos · Esteira · Triagem · Agenda · Usuários · Auto
```

### 4. Compatibilidade de rotas

Em vez de deletar os arquivos (e quebrar links antigos do dock/breadcrumbs), `admin.slots.tsx` e `admin.clube.tsx` viram redirects:

```tsx
// admin.slots.tsx
beforeLoad: () => { throw redirect({ to: "/admin/agenda", search: { tab: "slots" } }) }
```

Mesma coisa para `admin.clube.tsx` → `/admin/usuarios?tab=clube-conteudo`.

A aba ativa é controlada por `search param` (`?tab=`) para deep-linking e para o redirect funcionar.

### Arquivos afetados

- **Editado** `src/routes/_authenticated/admin.agenda.tsx` — envelopar em `Tabs`, importar conteúdo do slots.
- **Editado** `src/routes/_authenticated/admin.usuarios.tsx` — envelopar em `Tabs`, importar managers do clube.
- **Editado** `src/routes/_authenticated/admin.slots.tsx` — vira redirect (preserva URL).
- **Editado** `src/routes/_authenticated/admin.clube.tsx` — vira redirect.
- **Editado** `src/components/admin/AdminDock.tsx` — remover itens `Vagas` e `Clube`.

Nenhum server function ou tabela é alterada — só reorganização de UI.