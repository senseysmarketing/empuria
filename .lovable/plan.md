# Ajustes visuais portal

## 1. Topbar do /portal (HeroTopBar variant="portal")

Hoje: `bg-gradient-to-br from-[#c2956b] via-orange-brand to-yellow-brand` — degradê laranja saturado, conflita com a identidade quente/sóbria da landing.

Trocar por uma paleta alinhada à landing (marrom profundo + acentos âmbar/laranja), espelhando o admin mas mantendo diferenciação:

- Fundo: `bg-gradient-to-br from-brown via-[#6b2e1f] to-brown-deep` (tons quentes amadeirados, sem o amarelo cru).
- Texto principal: `text-offwhite` (em vez de brown-deep escuro).
- Texto secundário: `text-offwhite/65`.
- Acento (ponto + quickStat + greeting accent): `text-yellow-brand`.
- Aro do logo: `bg-brown-deep/60 ring-yellow-brand/25`.
- Watermark Espanha: `text-yellow-brand/12` (sutil, sem poluir).
- Borda do quickStat: `border-offwhite/15`.
- Banner "Visualizando como" continua igual.

Diferenciação vs admin:
- Admin = marrom→preto + acento laranja.
- Portal = marrom→âmbar quente + acento amarelo (mesma família, vibe mais "boas-vindas").

Arquivo: `src/components/shared/HeroTopBar.tsx` — só ajustar as constantes `bg`, `textMain`, `textMuted`, `accent`, `watermark`, `logoRing` quando `variant === "portal"`.

## 2. Imagens de exemplo nos cards da /portal/servicos

Hoje em `src/routes/_authenticated/portal.loja.tsx`, quando `s.image_url` é nulo, renderiza o degradê marrom→laranja (visto no print). Trocar o fallback por uma imagem placeholder por `kind`:

- Mapa `KIND_IMAGE` apontando para Unsplash (URLs estáveis, foco em Madrid/Espanha):
  - `airport` → foto de avião/terminal
  - `tour` → foto de Madrid (Gran Vía / Plaza Mayor)
  - `consulting` → mesa de trabalho / documentos
  - `banking` → fachada de banco / cartão
  - `meeting` → sala de reunião
- Fallback genérico: foto de Madrid.
- Usar `?w=800&auto=format&fit=crop` para peso controlado.
- Manter `object-cover` e o hover scale existente.
- Manter prioridade: se `s.image_url` existir, usa o real; senão, usa o placeholder por kind.

## Fora de escopo
- Lógica de upload/gestão de imagens reais dos serviços (continua usando `image_url` quando existir).
- Tela /admin (já tem paleta definida e aprovada).
- Outras telas do portal além do topbar e da loja.
