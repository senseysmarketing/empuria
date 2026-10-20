# Limpar Inbox WhatsApp de teste e preparar nova conexão

## Situação atual (conferida)
- 6 conversas e 116 mensagens no Inbox, sem anexos salvos. Uma conversa está ligada a um lead.
- O WhatsApp aparece como **desconectado** e o número antigo já foi removido.
- A foto de perfil do número antigo continua salva e precisa ser apagada.
- A instância e o retorno automático das mensagens continuam configurados. Eles serão reaproveitados para o novo número.

## O que será feito
1. Apagar todas as mensagens e conversas do Inbox WhatsApp.
2. Os leads do Funil **não** serão apagados. Só a ligação entre a conversa de teste e o lead será desfeita.
3. Apagar a foto de perfil antiga e os dados da última conexão. O cartão de integração vai ficar "pronto para conectar".
4. Conferir que o Inbox fica vazio e que o botão de conectar mostra um novo QR code. Depois disso, é só ler o QR code com o novo número.

## Detalhes técnicos
- Apagar os dados de `crm_messages`, `crm_conversations` e os registros WhatsApp antigos de `crm_inbox_messages`/`integration_events`, se houver.
- Na linha `provider='whatsapp'` de `integration_settings`, apagar `uazapi_profile_pic_url`, `uazapi_profile_name`, `uazapi_phone` e `uazapi_last_connection_at`, e manter `uazapi_connection_status='disconnected'`.
- Manter `uazapi_instance_id`, o token em `uazapi_connection_secrets` e o webhook para reutilizar a instância.
- Validar o status da instância pela API antes de dizer que está pronta.
