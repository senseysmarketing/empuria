# Conter QR Code PIX dentro dos modais

## Problema
Em `EventCheckoutModal`, `CheckoutModal` e `UpsellSheet` o bloco de pagamento PIX (QR + payload + botão) pode estourar o modal: o `<img>` do QR é renderizado em 240px sem `max-width`, o `DialogContent` não tem `max-height` nem scroll interno, e em viewports curtos o conteúdo é cortado (sintoma visto no screenshot — título colado no topo, sem respiro, payload longo apertando o layout).

## Onde aparece QR PIX
- `src/components/events/EventCheckoutModal.tsx` (step "payment")
- `src/components/checkout/CheckoutModal.tsx` (método PIX)
- `src/components/portal/UpsellSheet.tsx` (intent.mockPix)

## Ajustes (somente UI, sem mudar lógica)

### 1. `EventCheckoutModal.tsx`
- `DialogContent`: adicionar `max-h-[90vh] overflow-y-auto p-6` e manter `max-w-lg`.
- Wrapper do step "payment": `space-y-4 text-center` → manter, mas envolver a imagem em um container `flex justify-center`.
- `<img>` QR: trocar classes para `w-full max-w-[220px] h-auto rounded-lg border border-brown/15 bg-white p-2`.
- Bloco "PIX Copia e Cola": adicionar `overflow-hidden`; trocar `<code class="truncate">` por `break-all line-clamp-2` para evitar overflow horizontal em telas pequenas.

### 2. `CheckoutModal.tsx`
- `DialogContent`: adicionar `max-h-[90vh] overflow-y-auto`.
- `<img>` QR: aplicar `w-full max-w-[220px] h-auto` (igual ao Event).
- Bloco PIX Copia e Cola: mesma correção `break-all line-clamp-2` no `<code>`.

### 3. `UpsellSheet.tsx`
- Garantir que o `Sheet`/container do PIX permita scroll (`overflow-y-auto` no body do sheet) e aplicar mesmas regras de tamanho ao `<img>` QR e ao payload.

## Resultado
- QR sempre centralizado, no máximo 220px, nunca estoura.
- Modal nunca passa de 90% da altura da viewport e ganha scroll interno quando precisa.
- Payload PIX longo quebra em até 2 linhas em vez de empurrar largura.

## Fora de escopo
Nenhuma alteração em lógica de pagamento, geração de payload, ou server functions.
