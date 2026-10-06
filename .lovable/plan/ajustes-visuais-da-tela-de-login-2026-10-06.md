# Ajustes visuais da tela de login

## O que será feito
1. **Fundo sólido:** remover os desenhos SVG e suas animações do fundo da seção de login, mantendo a cor marrom atual uniforme e preservando a fotografia.
2. **Profundidade na divisória:** adicionar uma sombra leve na borda esquerda da seção de login, projetada para a esquerda sobre a imagem, sem escurecer toda a fotografia. A sombra aparecerá apenas quando imagem e formulário estiverem lado a lado.
3. **Acesso da equipe mais visível:** transformar o pequeno link em um botão secundário com contorno, texto maior e área de clique confortável. Ele continuará menos destacado que o botão laranja **Entrar**, mantendo o destino atual.

## Detalhes técnicos
- Ajustar a apresentação compartilhada em `src/components/auth/AuthLoginPage.tsx`, sem alterar autenticação, permissões ou redirecionamentos.
- Remover a classe decorativa `bg-topo` somente dessa tela; preservar seu uso em outras páginas.
- Definir a sombra usando um token em `src/styles.css` e usar o componente de botão existente para o acesso da equipe.
- Aplicar o fundo e a sombra também ao login da equipe, que utiliza a mesma apresentação.

## Verificação
- Conferir os dois logins e a apresentação em telas menores, sem sobreposições.
- Confirmar que **Acesso da equipe** abre o login administrativo e que **Entrar** permanece como ação principal.