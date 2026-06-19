## Ajustes na aba Conciliações Wise

### 1. Filtrar eventos conciliáveis
Em `ConciliacoesWiseTab.tsx`, antes de aplicar os filtros de status/busca, descartar eventos que não têm valor monetário — apenas eventos com `pickAmount(payload) != null` permanecem. Na prática isso mantém:
- `balances#credit` (entrada de saldo)
- `payment-link#payment-received` (link Quick Pay)

E descarta `transfers#state-change`, `transfers#active-cases` e outros sem `amount`, que não dão para conciliar.

Os cards de resumo (Precisam atenção / Sem referência / Valor divergente / Duplicados) passam a contar a partir dessa base já filtrada, para o número ficar coerente.

### 2. Paginação na tabela
- Estado local `page` (1-based) + constante `PAGE_SIZE = 20`.
- Slice do array `filtered` para renderizar só a página atual.
- Reset de `page` para 1 sempre que `filter` ou `search` mudarem (via `useEffect`).
- Rodapé da tabela com:
  - "Mostrando X–Y de Z"
  - Botões `Anterior` / `Próxima` (disabled nos limites)
  - Indicador "Página N de M"

### Fora do escopo
- Não mexer no painel "Eventos Wise recebidos" (modal de Integrações) — o filtro lá continua mostrando tudo, é log bruto.
- Não mudar server fn `listWiseEvents`; o filtro é feito no cliente porque o limite já é 200 e dá folga.

### Arquivo afetado
- ✏️ `src/components/admin/configuracoes/ConciliacoesWiseTab.tsx`
