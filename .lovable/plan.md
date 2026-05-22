## Hero TopBar imersivo para /admin e /portal

Faixa decorativa fixa no topo de cada layout, com mesma estrutura nos dois ambientes e paletas distintas.

### Componente base: `src/components/shared/HeroTopBar.tsx`

Props:
```ts
type HeroTopBarProps = {
  variant: "admin" | "portal";
  userName: string;
  avatarUrl?: string | null;
  quickStat?: { label: string; value: string };   // KPI do dia
  actions?: React.ReactNode;                      // botões (Escanear, Registrar…)
};
```

Estrutura visual (altura ~140px):
```
┌─────────────────────────────────────────────────────────────────┐
│  [SVG Espanha watermark — opacity 8%, posicionado à direita]    │
│                                                                 │
│  ◆ Logo  Bom dia, Gabriel                    [KPI]  [ações]    │
│          quinta · 22 maio · 14:32              €1.240   ▢ ▢    │
└─────────────────────────────────────────────────────────────────┘
```

Elementos:
- Saudação dinâmica (`Bom dia/tarde/noite, {primeiroNome}`) em Unbounded 28px
- Sublinha: dia da semana + data formatada em pt-BR + hora ao vivo (atualiza a cada 30s via `useEffect`/`setInterval`)
- Watermark SVG do contorno da Espanha (mesmo line-art usado no SuccessFinale, opacity baixa, lado direito)
- Slot `quickStat` à direita (ex.: vendas do dia no admin, próximo evento no portal)
- Slot `actions` para botões (já padronizados)
- Avatar circular no canto direito com menu (sair, perfil)

### Paletas

**Admin (`variant="admin"`):**
- Background: gradiente `from-brown-deep via-brown-deep to-[#3a1f15]`
- Texto principal: `text-offwhite`
- Acento: `text-orange-brand` (KPI, hora)
- Watermark: `stroke-orange-brand/15`

**Portal (`variant="portal"`):**
- Background: gradiente `from-[#c2956b] via-orange-brand to-yellow-brand`
- Texto principal: `text-brown-deep`
- Acento: `text-brown-deep` em bold (KPI)
- Watermark: `stroke-brown-deep/12`
- Saudação mais calorosa: "Bem-vindo de volta, Gabriel"

### Integração

1. **`src/routes/_authenticated/admin.tsx`**: renderizar `<HeroTopBar variant="admin" …/>` antes do `<main>`. Ajustar `pt-8` → `pt-0` (o topbar já dá respiro).

2. **`src/routes/_authenticated/portal.tsx`**: idem com `variant="portal"`.

3. **Remover headers redundantes** das páginas internas:
   - `admin.index.tsx` (linhas 38-54): remover o bloco logo+título+ações, pois agora vem no TopBar. Os botões `PassportScannerDialog` e `ArrivalDialog` migram para o slot `actions` do TopBar (pode ser via context ou prop no layout).
   - Para evitar prop drilling complexo, criar um contexto leve `TopBarActionsContext` que cada página pode preencher com seus botões via hook `useTopBarActions([...])`. Páginas sem ações deixam vazio.

4. **Dados do usuário**: usar `useCurrentUser()` (já existe) para nome e avatar.

### Arquivos

**Criar:**
- `src/components/shared/HeroTopBar.tsx`
- `src/components/shared/TopBarActionsContext.tsx`
- `src/components/shared/SpainWatermark.tsx` (SVG reusado)

**Editar:**
- `src/routes/_authenticated/admin.tsx` (provider + topbar)
- `src/routes/_authenticated/portal.tsx` (provider + topbar)
- `src/routes/_authenticated/admin.index.tsx` (remover header local, usar `useTopBarActions`)
- Demais páginas admin.* e portal.* mantêm seus h1 internos por enquanto (só Cockpit/portal.index ganham KPI no TopBar)

### Resultado

Topbar decorativo, presente em todas as rotas /admin e /portal, com nome do usuário, saudação contextual, hora ao vivo, KPI do dia, ações rápidas e watermark da Espanha. Mesma estrutura nos dois mundos, paletas distintas reforçando o tom executivo (admin) vs acolhedor (portal).