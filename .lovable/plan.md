## Padronização do Dock

O `PortalDock` já tem o padrão visual desejado (pílulas arredondadas, ícones 18px, label só no item ativo, separadores finos, container compacto). O `AdminDock` está com tamanhos maiores, `flex-1` esticando os itens, `rounded-xl` e label sempre visível — fora do padrão.

### Alterações em `src/components/admin/AdminDock.tsx`

Aplicar exatamente os mesmos tokens visuais do `PortalDock`:

- Container: `bg-brown-deep/95 backdrop-blur-xl border border-brown/40 rounded-2xl shadow-2xl` — manter, só ajustar largura para `max-w-3xl` (cabe os 7 itens + logo + portal + sair sem espremer).
- `ul`: `flex items-center justify-between gap-0 px-2 py-2` (remover `items-stretch`, `gap-1`, `flex-1` dos itens).
- Logo: `h-6 w-6` (igual ao portal, hoje está `h-7 w-7`).
- Separadores: `w-px h-5 bg-brown/60 mx-0.5` (hoje é `self-stretch mx-1`).
- Itens de navegação: substituir a classe atual pela do portal — `h-10 rounded-full`, padding `px-2.5` quando inativo / `px-3 gap-2` quando ativo, fundo `bg-admin-accent text-white` no ativo, ícone `h-[18px] w-[18px]`, label `text-[10px] font-display uppercase tracking-wide` dentro de `.dock-label` (CSS já existente faz a label aparecer só quando ativo).
- Botões "Portal" e "Sair": mesmos tamanhos/raio do item de nav (pílula `h-10`, ícone 18px), `text-offwhite/50 hover:bg-brown/50`, `hover:text-red-brand` apenas no Sair.

### Fora de escopo

- Não alterar `PortalDock` (já é a referência).
- Não mexer em rotas, lógica de logout ou itens do menu — só visual.
- Não alterar CSS global `.admin-dock-item` / `.dock-label` (já controlam a exibição da label).
