## Problema
A baixa via webhook Wise já grava `payment_method = 'wise'` em `pdv_sales` e `pdv_tabs` (RPC `pdv_confirm_wise_payment`, migration `20260619153858_…`). Porém os mapas de rótulos no frontend não conhecem `'wise'`, então a UI faz fallback para "Dinheiro":

- `src/components/admin/pdv/PdvHistoryPanel.tsx` (linha 78–82): `paymentLabel()` só trata `cartao`/`pix`, qualquer outro retorna "Dinheiro".
- `src/lib/admin/reports.functions.ts` (linha 495–503): `PAYMENT_LABEL` não inclui `wise`.

Resultado: vendas pagas via link Wise aparecem como "Dinheiro" no histórico do PDV e nos Relatórios.

## Ajustes

1. **`PdvHistoryPanel.tsx`** — reescrever `paymentLabel` para reconhecer também `wise` ("Wise") e `transferencia` ("Transferência"), mantendo `dinheiro` como default seguro:
   ```ts
   if (value === "cartao") return "Cartão";
   if (value === "pix") return "PIX";
   if (value === "wise") return "Wise";
   if (value === "transferencia") return "Transferência";
   return "Dinheiro";
   ```
   Também adicionar opção "Wise" no filtro `<Select>` de pagamento (linha 222) e ampliar o tipo `Payment` correspondente para incluir `"wise"`.

2. **`reports.functions.ts`** — acrescentar `wise: "Wise"` ao mapa `PAYMENT_LABEL` para que a quebra por forma de pagamento nos relatórios mostre "Wise".

## Verificação após implementar

- Histórico do PDV: a venda `PDV-20260619-0002` (já paga pelo teste de webhook) passa a exibir "Wise" na coluna Pagamento.
- Filtro do histórico ganha a opção "Wise".
- Relatórios → quebra por forma de pagamento: o agregado da venda Wise aparece rotulado como "Wise" (não mais como string crua nem como "Dinheiro").
- Nada muda no backend nem no fluxo de baixa — a RPC já está correta desde a migration de 19/06.

## Fora do escopo
- Não recriar/alterar vendas antigas que tenham sido fechadas manualmente como "dinheiro" antes da existência do fluxo Wise.
