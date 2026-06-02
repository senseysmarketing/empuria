## Verificação da tipografia

Estado atual após as últimas correções:

**`src/routes/__root.tsx`** — já carrega via `<link>` em `head()`:
```
https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800&family=Philosopher:ital,wght@0,400;0,700;1,400;1,700&display=swap
```
Inclui exatamente Unbounded 600/700/800 e Philosopher 400/700 + itálicos. Preconnect para `fonts.googleapis.com` e `fonts.gstatic.com` já está presente. **Nenhuma alteração necessária.**

**`src/styles.css`** — variáveis e aplicação já preservadas:
- `--font-display: "Unbounded", system-ui, sans-serif;` ✓
- `--font-body: "Philosopher", Georgia, serif;` ✓
- `@theme inline` expõe ambas → classes `font-display` e `font-body` do Tailwind continuam funcionando ✓
- `body { font-family: var(--font-body); }` e `h1..h6 { font-family: var(--font-display); letter-spacing: -0.02em; }` ✓

### Único ajuste proposto

Remover o bloco `@font-face` local de Unbounded (linhas ~12-18 de `styles.css`):

```css
@font-face {
  font-family: "Unbounded";
  ...
  src: url("https://fonts.gstatic.com/s/unbounded/v9/...woff2") format("woff2");
}
```

Motivos:
1. É redundante — o `<link>` do Google Fonts em `__root.tsx` já carrega Unbounded 600/700/800.
2. Aponta para uma URL `https://...` dentro do CSS. Mesmo sendo `@font-face` (não `@import`), o lightningcss em modo estrito pode tentar tratar como recurso local e reproduzir um erro `ENOENT` semelhante ao já corrigido. Removê-lo elimina esse risco.
3. Não altera identidade visual: a mesma família/peso já é servida pelo Google Fonts via `<link>`.

Nenhuma outra mudança em `styles.css`, `__root.tsx`, `vite.config.ts`, auth, ou regras de permissão.

### Verificação após o ajuste

- Confirmar visualmente no preview que títulos seguem em Unbounded e corpo em Philosopher (incluindo itálico onde usado).
- Confirmar que utilitários Tailwind `font-display` e `font-body` continuam aplicando as famílias corretas.