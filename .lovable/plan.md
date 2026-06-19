## Mudanças (apenas UI)

### 1. Comandas aguardando pagamento Wise — mais compactas
Em `src/components/admin/pdv/PdvTabsPanel.tsx`, na seção "Comandas aguardando pagamento Wise":
- Trocar grid atual por linhas compactas (uma linha por comanda) em vez de cards grandes.
- Layout por item (altura ~40px): `[ref PDV-...A1] · [nome cliente] · [hora] · [total €] · botões "Abrir" e "Verificar" (icon-only com tooltip)`.
- Manter borda âmbar sutil no container, sem ocupar a largura toda em card grande.
- Em telas estreitas, empilhar nome+ref e manter ações à direita.

### 2. "Adicionar consumo" — busca no header + paginação
Em `src/components/admin/pdv/SaleCartPanel.tsx` (header do bloco) e `src/components/admin/pdv/SaleCatalogGrid.tsx` (grid):

**Header**
- Mesma linha do título "Adicionar consumo": adicionar `<Input>` com ícone de lupa, placeholder "Buscar item...", largura ~240px, alinhado à direita.
- Estado `search` controlado no painel pai; passado para o grid já filtrado (case-insensitive, por `name`).

**Paginação**
- Props novas em `SaleCatalogGrid`: `pageSize` (default 24) e controle interno de página atual (`useState`).
- Quando há busca ativa, paginar sobre o resultado filtrado; sem busca, sobre o catálogo completo.
- Agrupamento por categoria continua, mas aplicado **dentro da página atual** (mais simples e previsível com muitos itens).
- Rodapé do grid com componente `Pagination` (shadcn já disponível em `src/components/ui/pagination.tsx`): Prev / números (com ellipsis) / Next + contador "Mostrando X–Y de Z".
- Resetar página para 1 sempre que `search` mudar.

### Fora de escopo
Sem mudanças no backend, RPCs, webhook Wise, lógica de estoque, ou no fluxo de fechamento de comanda. Apenas refino visual e ergonomia do catálogo.
