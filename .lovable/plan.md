# Modal de detalhes do serviço

## Landing (`/`) e `/servicos`

Hoje o botão "Detalhes" no `ServiceCard` é um `Link` para `/servicos/$slug`. Trocar por um modal rico, sem sair da página.

1. Novo componente `src/components/services/ServiceDetailsModal.tsx`:
   - Usa `Dialog` (shadcn) com `max-w-2xl`, `max-h-[90vh] overflow-y-auto`.
   - Hero: imagem do serviço (`image_url` ou placeholder por `kind`, reaproveitando o mesmo mapa `KIND_IMAGE` do portal — extrair para `src/lib/service-images.ts` para uso compartilhado).
   - Cabeçalho: ícone do kind, título, badge "Esteira 1", preço grande à direita.
   - Corpo: `short_description`, `description` (preserva quebras), e quando existir:
     - "O que está incluído" a partir de `document_checklist` (lista de bullets).
     - "Local" com `meeting_address` quando aplicável.
     - Aviso "Requer agendamento" quando `requires_slot`.
   - Rodapé: dois botões — "Comprar agora" (fecha o modal e dispara `onBuy(service)` que abre o `CheckoutModal` existente) e "Fechar".

2. `ServiceCard` (`src/components/services/ServiceCard.tsx`):
   - Adicionar prop opcional `onDetails?: (s: PublicService) => void`.
   - Se `onDetails` for passado, o "Detalhes" vira `<button>` chamando o handler; senão mantém o `Link` atual (compat).

3. `src/routes/index.tsx` e `src/routes/servicos.tsx`:
   - Adicionar estado `detailsService` + `detailsOpen`.
   - Passar `onDetails={(s) => { setDetailsService(s); setDetailsOpen(true); }}` para cada `ServiceCard`.
   - Renderizar `<ServiceDetailsModal>` ao lado do `CheckoutModal` já existente, com `onBuy={(s) => { setDetailsOpen(false); setSelected(s); setCheckoutOpen(true); }}`.

## `/portal/servicos` (Loja Empuria)

Já abre o `UpsellSheet` ao clicar no card, e o sheet já mostra título, preço, `short_description` e `description`. Pequenos ajustes para igualar o nível de detalhe do modal público:

1. `src/components/portal/UpsellSheet.tsx`:
   - Hero: sempre mostrar imagem (usa `image_url` ou placeholder por kind via `service-images.ts`), removendo o `if` que só renderiza quando há `image_url`.
   - Adicionar `ShopService.document_checklist`, `requires_slot`, `meeting_address` ao tipo e ao select do server fn.
   - Renderizar bloco "O que está incluído" + endereço + aviso de agendamento, com os mesmos componentes visuais do modal público adaptados ao tema admin.

2. `src/lib/services-public.functions.ts`: o `listPublicServices` já retorna esses campos, então o `select` no portal só precisa garantir que o tipo bate (sem mudar lógica).

## Reuso

`src/lib/service-images.ts` exporta `KIND_IMAGE` + `FALLBACK_IMAGE` + helper `getServiceImage(service)`. `portal.loja.tsx`, `UpsellSheet`, `ServiceDetailsModal` e o hero do `ServiceCard` (opcional, futuro) consomem daqui — única fonte de verdade.

## Fora de escopo
- Backend / novos campos no schema.
- Mudanças no fluxo de checkout.
- Rota `/servicos/$slug` (continua existindo como página SEO; modal não a substitui).
