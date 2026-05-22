# Adicionar logos oficiais do Instituto Empuria

## Arquivos
Copiar os uploads para o projeto:
- `user-uploads://LogoCompleta.png` → `src/assets/logo-empuria-completa.png` (versão horizontal completa)
- `user-uploads://LogoIcone.png` → `src/assets/logo-empuria-icone.png` (versão ícone, para espaços apertados)

## Onde aplicar

**Logo completa** (substitui o texto "Empuria"):
1. `src/components/SiteHeader.tsx` — cabeçalho da landing (fundo marrom escuro) — altura ~32px
2. `src/components/SiteFooter.tsx` — rodapé (fundo escuro) — altura ~28px
3. `src/routes/login.tsx` — bloco hero da tela de login (fundo marrom) — altura ~48px
4. `src/routes/_authenticated/portal.tsx` — topo do portal do membro — altura ~32px

**Logo ícone** (espaços compactos):
5. `src/components/admin/AdminDock.tsx` — primeira "tile" do dock antes dos itens de navegação — 24×24px
6. `src/routes/_authenticated/admin.index.tsx` — badge ao lado do título "Cockpit" do admin — 32×32px
7. `public/favicon.ico` será mantido (não substituído nesta tarefa para evitar regressão)

Em cada caso, o `<img>` terá `alt="Instituto Empuria"` e o texto "Empuria" atual será removido (substituído pela imagem) — o link/anchor de navegação é preservado.

## Observação importante sobre contraste
As duas imagens enviadas são **brancas sobre fundo transparente**. Elas ficam perfeitas sobre os fundos escuros da landing/portal/login. No painel admin (light mode, fundo cinza-claro) elas ficariam invisíveis — para esses dois pontos (AdminDock e Cockpit) aplico `filter: invert(1) brightness(0)` via classe utilitária para renderizar o logo em preto sobre o fundo claro, preservando a forma original. Se você tiver uma versão escura do logo, posso trocar depois sem refatorar o markup.

Aprove para eu implementar.