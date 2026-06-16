## Diagnóstico (confirmado)

1. Banco mostra a última tentativa retornando **404 "Resource not found"** em todas as 3 variantes que tentamos (`/v2/profiles/.../payment-requests`, `/v1/...`, `/v2/business/...`).
2. Acabei de checar a **referência oficial da API Wise** (docs.wise.com/api-reference): os únicos recursos públicos são **Quote, Recipient, Transfer, Balance, Profile, Rate**. Não existe endpoint público "Payment Request" / "Payment Link" / "Quick Pay".
3. O link hospedado `wise.com/pay/r/…` (Quick Pay / Solicitar Pagamento) é gerado **apenas pela interface web/app da Wise** — não há API pública. Por isso o 404, e nenhum ajuste de endpoint vai mudar isso.
4. O botão "Testar criação de pagamento" **está** chamando a API e recebendo o 404 — só não há feedback persistente (toast some em 4s), por isso "parece" que nada acontece.

## Plano (mínimo, focado em destravar o checkout hoje)

### A. Backend — `src/lib/wise/wise.functions.ts`
1. Em `createWisePaymentForOrder`: quando a API falha **mas** existe `wise_default_payment_url`, **não gravar `raw_response.error`** (não é erro — é o fluxo esperado). Anexar `?amount={valor}&currency=EUR` à URL do Quick Pay antes de salvar/retornar (a referência `EMP-XXXX` o cliente preenche na própria página da Wise).
2. Em `testWisePaymentCreation`: incluir `fallbackUrl: setting.wise_default_payment_url` no retorno (sucesso ou falha), para o frontend poder abrir o Quick Pay manual quando a API não funcionar.
3. Em `getWiseAdminOverview`: parar de classificar o 404 como `lastApiError` quando há `wise_default_payment_url` configurado.

### B. Frontend — `src/components/admin/configuracoes/WiseIntegrationCard.tsx`
1. Renomear a linha "Link automatico" para **"Link de pagamento"** com 3 estados: `configurado (Quick Pay)` (verde) / `via API` (azul, se um dia funcionar) / `não configurado` (vermelho).
2. Reescrever o botão **"Testar criação de pagamento"**: chama `testWisePaymentCreation`; se a API falhar mas `fallbackUrl` existir, abre o Quick Pay em nova aba (validação real do que o cliente vai ver) e toast "OK · usando Quick Pay manual"; se nem fallback existir, abre um Dialog com instruções passo a passo (Wise → Solicitar pagamento → Criar link reutilizável → colar em "Link Wise padrão").
3. Esconder o alerta amarelo "Ultimo erro da API: Resource not found" quando o `wise_default_payment_url` está configurado (deixa de ser erro).
4. No diálogo de configuração, mover o campo "Link Wise padrão" para o topo da seção bancária com label **"Link de pagamento Wise (Quick Pay) — recomendado"** e copy curta: *"Wise → Solicitar pagamento → Criar link reutilizável em EUR. Cole aqui o `https://wise.com/pay/me/…`. Esse é o caminho oficial — a API pública da Wise não gera esse link."*

### C. Não-mudanças (importante)
- Manter `createWisePaymentRequest` no código intacto — se a Wise habilitar a feature para essa conta no futuro, passa a funcionar automaticamente.
- Webhook `balances#credit` + referência `EMP-XXXX` continuam reconciliando automaticamente. Nada muda aí.
- Sem mexer em Mercado Pago / Hubla / conversão BRL→EUR / schema do banco.

## Pergunta operacional

Você consegue agora ir em **Wise → Solicitar pagamento → Criar link reutilizável (EUR)** e me passar a URL `https://wise.com/pay/me/…`? Vou aplicar as mudanças acima e, com esse link colado no campo, o checkout passa a abrir o Quick Pay da Wise em uma aba nova automaticamente — exatamente a experiência que você quer.

## Arquivos alterados
- `src/lib/wise/wise.functions.ts`
- `src/components/admin/configuracoes/WiseIntegrationCard.tsx`
