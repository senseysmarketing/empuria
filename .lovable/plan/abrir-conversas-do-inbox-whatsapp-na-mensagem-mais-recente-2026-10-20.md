# Abrir conversas do Inbox WhatsApp na mensagem mais recente

## O que muda
- Ao abrir uma conversa, a lista de mensagens vai direto para o final (mensagem mais recente), como no WhatsApp.
- Rolar para cima continua carregando mensagens antigas sem "pular" a posição.
- Quando chega ou é enviada uma nova mensagem e o usuário já está perto do final, a tela acompanha automaticamente; se ele estiver lendo mensagens antigas, a posição é mantida.

## Detalhes técnicos
Arquivo: `src/components/admin/CrmInboxConversations.tsx`
- Guardar em um ref o id da conversa já posicionada; no `useLayoutEffect` de `messages.length`, quando a conversa mudou e há mensagens carregadas, definir `scrollTop = scrollHeight`.
- Manter a lógica atual de `scrollAnchorRef` para paginação de mensagens antigas (prioridade sobre o auto-scroll).
- Antes de atualizar, registrar se o usuário estava a menos de ~120px do final; se sim, rolar ao final em novas mensagens (polling/envio).
