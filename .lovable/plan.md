## Seção "A Agenda Empuria" na Landing Page

Nova seção dinâmica na home (`src/routes/index.tsx`), posicionada logo após o bloco de Serviços (após a Esteira 2 high-ticket) e antes da seção CLUBE. Fundo off-white para contraste com o bloco marrom anterior.

### 1. Backend — nova server function

Adicionar em `src/lib/events/tickets.functions.ts`:

- `listHomeEvents`: retorna `{ upcoming, past }`
  - `upcoming`: eventos com `starts_at >= hoje`, `is_published = true`, ordenados ASC, limit 3.
  - `past`: eventos com `starts_at < hoje`, `is_published = true`, ordenados DESC, limit 12.
  - Campos: `id, slug, title, starts_at, cover_url, location_address`.
  - Usa `supabaseAdmin` (rota pública), igual ao `listPublishedEvents` existente.

### 2. Componente da seção

Novo arquivo `src/components/events/HomeEventsSection.tsx`:

- Header:
  - Eyebrow laranja: "Agenda & Comunidade"
  - H2 Unbounded (`font-display`): "A AGENDA EMPURIA: NOSSA COMUNIDADE EM MOVIMENTO."
  - Subtítulo Philosopher (`font-body italic`): "Mais do que serviços, criamos conexões..."

- **Cenário A — `upcoming.length > 0`**: grid `md:grid-cols-3` de até 3 cards:
  - Imagem capa (60% altura, `aspect-[4/5]` topo).
  - Tag flutuante amarela (`bg-yellow-brand text-brown`) absolute top-left: dia + mês curto (Ex.: "15 JUN").
  - Título evento + endereço (`location_address`).
  - Botão laranja "Ver Detalhes e Ingressos" → `Link to="/evento/$slug"`.

- **Cenário B — `upcoming.length === 0`**: um único "Card Convite" centralizado, ocupando full width do grid:
  - Fundo `bg-brown text-offwhite` + classe `bg-topo` (textura topográfica SVG já usada na home).
  - Headline curto + copy: "Nossa equipe está preparando a próxima grande experiência..."
  - CTA transparente com borda branca: "Como chegar ao Instituto" → abre Google Maps em nova aba (endereço da Gran Vía, mesmo já presente no footer/site).

- **Vitrine de Eventos Passados** (sempre visível se `past.length > 0`):
  - Subtítulo pequeno: "Como foi por aqui"
  - Carrossel horizontal scroll (`flex overflow-x-auto snap-x`) ou grid compacto `grid-cols-2 md:grid-cols-4 lg:grid-cols-6` sem gaps grandes.
  - Cada item: imagem `aspect-square`, `grayscale` + transition; em `group-hover`: `grayscale-0` e overlay escuro com título "Como foi o [Nome do Evento]".
  - Link para `/evento/$slug` (mesma landing page).

### 3. Integração na home

Em `src/routes/index.tsx`:

- Importar `HomeEventsSection` e `listHomeEvents`.
- Adicionar `queryOptions` + `ensureQueryData` no loader (junto com o atual `fetchServices`).
- Renderizar `<HomeEventsSection />` entre `</section>` da seção SERVIÇOS (linha ~325) e a seção CLUBE.

### Notas técnicas

- Usar `useSuspenseQuery` no componente para consumir o cache.
- Datas formatadas em PT-BR (`Intl.DateTimeFormat("pt-BR", { day:"2-digit", month:"short" })`).
- Sem alterações de schema — tabela `events` já tem todos os campos necessários.
- Sem alterações de RLS — política "Anyone view published events" já permite leitura anônima.
- Imagens com `loading="lazy"`.
