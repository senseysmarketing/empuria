Trocar o `Sheet` lateral do detalhe do lead em `/admin/triagem` por um `Dialog` (modal centralizado), mantendo todo o conteúdo atual (dossiê, WhatsApp, notas, linha do tempo, mudança de etapa).

## Mudanças

- `src/routes/_authenticated/admin.triagem.tsx`
  - Substituir imports `Sheet/SheetContent/SheetHeader/SheetTitle` por `Dialog/DialogContent/DialogHeader/DialogTitle` de `@/components/ui/dialog`.
  - `LeadDetail`: usar `<Dialog open onOpenChange>` com `<DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 bg-admin-surface">`.
  - `LeadDetailBody`: trocar `SheetHeader/SheetTitle` por `DialogHeader/DialogTitle`, manter layout (header sticky, blocos, etc.).
  - Nenhuma alteração de lógica, dados, ou outros componentes.
