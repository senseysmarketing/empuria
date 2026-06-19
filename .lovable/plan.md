## Objetivo
Disparar um POST simulado para o endpoint `/api/public/webhooks/wise` da URL publicada, replicando o formato de um evento `payment-link#payment-received` da Wise, com `reference = PDV-2606190002-A1` e `amount = 3.00 EUR`, para validar:

1. Recebimento do evento pelo handler
2. Match da referência via RPC `pdv_confirm_wise_payment`
3. Baixa automática da comanda PDV (sale + estoque + financeiro)
4. Registro do evento em `wise_events` com `match_status = pdv_matched`
5. Exibição correta no modal "Ver eventos Wise"

## Passos

1. **Disparo do webhook** via `invoke-server-function`:
   - `POST https://empuria.lovable.app/api/public/webhooks/wise`
   - Header: `X-Delivery-Id: sim-pdv-2606190002-a1-<timestamp>` (idempotência)
   - Body JSON simulando payload `payment-link#payment-received`:
     ```json
     {
       "event_type": "payment-link#payment-received",
       "data": {
         "reference": "PDV-2606190002-A1",
         "amount": 3.00,
         "currency": "EUR",
         "occurred_at": "2026-06-19T16:00:00Z"
       }
     }
     ```
   - Como `wise_webhook_public_key` é NULL, o handler aceita o evento (signature_valid=false não bloqueia quando não há chave).

2. **Verificação no banco** (via `read_query`):
   - `wise_events`: 1 nova linha com `event_type=payment-link#payment-received`, `match_status=pdv_matched`, `processed_at` preenchido
   - `pdv_payment_attempts WHERE reference='PDV-2606190002-A1'`: status alterado de `waiting_payment` para `paid` (ou equivalente)
   - `pdv_sales` / `pdv_sale_items`: venda finalizada, baixa de estoque registrada
   - `finance_transactions`: lançamento de receita criado

3. **Validação na UI**:
   - Abrir modal "Ver eventos" em Configurações → Wise e confirmar que o novo evento aparece com badge "PDV casado" + valor 3,00 € + referência destacada
   - Voltar ao PDV e confirmar que `PDV-2606190002-A1` saiu da lista "Comandas aguardando pagamento Wise"

4. **Logs**: se algo falhar, consultar `server-function-logs` do endpoint e logs Postgres para diagnosticar a RPC.

## Observações
- Nenhuma mudança de código é necessária — é apenas um teste de integração end-to-end usando o fluxo já implementado.
- O evento ficará marcado como `signature_valid=false` (esperado em sandbox sem chave pública configurada).
