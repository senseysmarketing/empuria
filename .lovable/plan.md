# WhatsApp de contato: novo número e redirecionamento após o formulário

## O que muda
1. **Novo número**: o WhatsApp de contato da página inicial (topo e rodapé) passa a ser **+34 613 76 25 00**.
2. **Final do formulário de consultoria**: depois que a pessoa envia, o lead continua sendo salvo normalmente. Em seguida, a tela de sucesso mostra a confirmação e a pessoa é levada automaticamente (após ~2 segundos) para o WhatsApp desse número, com a mensagem já escrita. Também aparece um botão "Falar no WhatsApp agora" caso o navegador bloqueie a abertura automática.
3. **Frase padrão** (preenchida automaticamente):
   > "Olá! Me chamo {primeiro nome} e acabei de preencher o formulário de consultoria no site do Instituto Empuria. Gostaria de dar continuidade ao meu atendimento."

O texto da tela de sucesso será ajustado para dizer que a conversa continua pelo WhatsApp.

## Detalhes técnicos
- `src/routes/index.tsx` e `src/components/SiteFooter.tsx`: link `https://wa.me/34613762500` e texto do número.
- `src/components/leads/SuccessFinale.tsx`: gera link `wa.me/34613762500?text=...` (encodeURIComponent com o primeiro nome), abre em nova aba via timer e exibe botão de fallback.
- Número centralizado em uma constante compartilhada para evitar divergências.
