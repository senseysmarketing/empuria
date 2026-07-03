# Atualização do telefone/WhatsApp para +34 627 90 68 17

## O que será feito
1. **Atualizar o número no rodapé**  
   Substituir `+34 600 000 000` por `+34 627 90 68 17` em `src/components/SiteFooter.tsx`. Também transformar o telefone em link clicável para WhatsApp (`https://wa.me/34627906817`).

2. **Adicionar o contato na página inicial**  
   Incluir o número/WhatsApp de forma discreta em `src/routes/index.tsx`, mantendo o visual atual (cores offwhite/brown, tipografia existente). Possibilidades: um pequeno botão/link de WhatsApp no hero, ou uma linha de contato junto ao CTA existente. Vou usar o mesmo estilo dos componentes da home para não quebrar a identidade visual.

3. **Varredura final**  
   Confirmar que não restou nenhuma referência ao número antigo (`+34 600 000 000` / `600000000`) nos arquivos do projeto.

## Arquivos que serão alterados
- `src/components/SiteFooter.tsx`
- `src/routes/index.tsx`

## Observação
Não alteraremos números de telefone de usuários, clientes ou integrações (WhatsApp business, Uazapi, etc.) — apenas o contato público do Instituto Empuria.