## Recuperar tipografia do print antigo (image-25)

O visual antigo usava na verdade `system-ui` nos títulos (a Unbounded nunca carregava por causa do `@import url(...)` quebrado). Vamos remover a Unbounded e tornar `system-ui` a fonte de display oficial.

### Mudanças

**1. `src/routes/__root.tsx`** — atualizar o `<link>` do Google Fonts para carregar **apenas Philosopher** (titulos passam a usar system-ui, não precisa mais de Unbounded):

```ts
{
  rel: "stylesheet",
  href: "https://fonts.googleapis.com/css2?family=Philosopher:ital,wght@0,400;0,700;1,400;1,700&display=swap",
}
```

Preconnects para `fonts.googleapis.com` e `fonts.gstatic.com` permanecem.

**2. `src/styles.css`** — trocar a variável display para system-ui:

```css
--font-display: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-body: "Philosopher", Georgia, serif;
```

Tudo o mais fica intacto:
- `@theme inline` continua expondo `--color-*` e `--font-display`/`--font-body` → classes `font-display` e `font-body` seguem funcionando.
- Regras `body { font-family: var(--font-body) }` e `h1..h6 { font-family: var(--font-display); letter-spacing: -0.02em }` permanecem.
- Nenhuma classe de peso (`font-bold`, `font-extrabold`) é alterada — system-ui renderiza esses pesos com as proporções vistas no image-25.
- Comentário sobre carregamento de fonte no CSS é atualizado para refletir que só Philosopher vem do Google Fonts.

### Fora de escopo

- `vite.config.ts`: não tocar.
- Auth, permissões, admin/staff: não tocar.
- Nenhum componente .tsx é editado — só CSS e o `<link>` do head.

### Verificação

- Conferir no preview que "Bom dia, Admin", "RECEITA · ÚLTIMOS 30 DIAS", labels de cards e título "FEED DE ATIVIDADE" voltem ao traço fino e proporcional do image-25.
- Confirmar que o corpo (ex: "Pedido criado", "Nenhuma reunião marcada para hoje.") continua em Philosopher serif com itálico funcional.
- Conferir que classes utilitárias `font-display` aplicam system-ui (não Unbounded).