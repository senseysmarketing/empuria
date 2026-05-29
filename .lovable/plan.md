# PDV Itens — Modal de edição e Gerenciar Categorias

## Objetivo
1. Trocar o `Sheet` lateral de criar/editar item por um **Modal (Dialog)**.
2. Adicionar botão **"Gerenciar Categorias"** ao lado esquerdo de "Novo item", que abre um modal próprio com CRUD de categorias (criar, editar, excluir com confirmação e bloqueio se houver itens vinculados).

## Mudanças

### 1. Banco de dados (migration)
Hoje `products.category` é o enum `product_category` (`bebida`, `comida`, `barbearia`, `outro`) — não dá para criar/editar/excluir dinamicamente. Vamos migrar para tabela:

- Criar tabela `public.product_categories`:
  - `id uuid pk`, `slug text unique`, `name text`, `emoji text null`, `position int default 0`, `is_active bool default true`, `created_at`, `updated_at`.
  - GRANTs: `select` para `authenticated` (PDV/portal precisam ler), `all` para `service_role`. RLS: leitura para autenticados ativos OR staff; manage só staff.
- Seed com as 4 categorias atuais preservando slugs (`bebida`, `comida`, `barbearia`, `outro`).
- Adicionar `products.category_id uuid` (nullable inicialmente), backfill a partir do enum atual (`UPDATE products SET category_id = pc.id FROM product_categories pc WHERE pc.slug = products.category::text`), depois `NOT NULL` + FK `ON DELETE RESTRICT`.
- Manter a coluna `category` (enum) por compatibilidade temporária com `pdv.functions.ts` e demais consumidores — apenas leitura. Novas escritas passam a usar `category_id` (e mantemos `category` sincronizada quando o slug corresponder a um valor do enum; caso o slug não exista no enum, salvamos `'outro'`).
- Trigger `update_updated_at` em `product_categories`.

### 2. Server functions (`src/lib/admin/`)
- **`categories.functions.ts`** (novo, `requireModule("pdv_itens")`):
  - `listCategories()` → todas as categorias com `item_count` (subselect em `products`).
  - `createCategory({ name, slug, emoji?, position? })` — Zod, slug `[a-z0-9_-]+` único.
  - `updateCategory({ id, ... })`.
  - `deleteCategory({ id })` — primeiro `count` de products; se >0 → `throw new Error("Existem N itens nesta categoria. Mova ou exclua os itens antes.")`. Audit log em todas as ações.
- **`pdv-itens.functions.ts`**: trocar campo `category` por `category_id` no schema/zod; ao inserir/atualizar, buscar `slug` da categoria e popular também a coluna enum `category` (fallback `'outro'`) para não quebrar `pdv.functions.ts`.
- **`listPdvItems`**: incluir join com nome/emoji da categoria (`select *, product_categories(id, slug, name, emoji)`).

### 3. Frontend

`src/components/admin/configuracoes/PdvItensTab.tsx`:
- Substituir `Sheet` por `Dialog` (`DialogContent` com `max-w-lg`, `max-h-[85vh] overflow-y-auto`).
- Carregar categorias via novo hook/query `["pdv-categories"]`.
- `Select` de categoria passa a usar lista dinâmica (label = `emoji + name`, value = `id`).
- Novo botão **"Gerenciar Categorias"** (variant `outline`, ícone `Tags`) à esquerda de "Novo item" abrindo `<CategoriesManagerModal />`.
- Tabela: exibir nome da categoria vindo do join (não mais capitalização do enum).

`src/components/admin/configuracoes/CategoriesManagerModal.tsx` (novo):
- `Dialog` com lista das categorias (emoji, nome, slug, contador `N itens`, switch ativo, editar, excluir).
- Form inline / linha de criação no topo (nome, slug auto-gerado editável, emoji).
- Editar abre form inline na linha.
- Excluir → `AlertDialog` de confirmação. Se servidor retornar erro de itens vinculados, `toast.error` com a mensagem; modal mantém-se aberto.
- Após qualquer mutação: `invalidateQueries(["pdv-categories", "pdv-itens"])`.

### 4. Impactos colaterais
- `pdv.functions.ts` continua usando a coluna `category` (enum) — sem mudanças.
- Como o enum não muda, qualquer **nova categoria criada pelo admin** será gravada com fallback `category='outro'` na coluna enum (mantém compatibilidade). O `category_id` é a fonte de verdade para UI; o enum existe só para os consumidores legados.
- Documentar essa nuance em comentário no código.

### 5. Fora do escopo
- Refatorar `pdv.functions.ts` para usar `category_id` (próximo passo).
- Remover a coluna enum `category`.
- Reordenação drag-and-drop de categorias (usaremos campo `position` editável manualmente).

## Ordem de execução
1. Migration (`product_categories` + `category_id` + backfill).
2. `categories.functions.ts` + ajustes em `pdv-itens.functions.ts`.
3. `CategoriesManagerModal.tsx`.
4. Reescrever `PdvItensTab.tsx` (Sheet → Dialog, novo botão, select dinâmico).
