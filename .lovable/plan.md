## Padronização dos botões em /admin

### Padrão de referência (botão "Registrar chegada")
```tsx
<Button size="sm" className="bg-admin-accent hover:bg-admin-accent/90">
  <Icon className="h-4 w-4" /> Texto
</Button>
```
- Fonte: padrão do sistema (sem `font-display`/Unbounded)
- Tamanho: `size="sm"`
- Cor primária: `bg-admin-accent` + hover `/90`
- Ícone `h-4 w-4`

### Ajustes

1. **`src/components/admin/PassportScannerDialog.tsx`** (Escanear Passaporte)
   - Remover `font-display`, trocar `bg-orange-brand hover:bg-red-brand text-offwhite` por `bg-admin-accent hover:bg-admin-accent/90`
   - Adicionar `size="sm"` para casar com "Registrar chegada"

2. **`src/routes/_authenticated/admin.eventos.tsx`**
   - "Novo evento" (linha 135) e "Salvar" (232): usar `size="sm"` (no header) e `bg-admin-accent hover:bg-admin-accent/90` (remover `text-white` que vem do token)

3. **`src/routes/_authenticated/admin.usuarios.tsx`**
   - "Salvar" (309): mesma classe `bg-admin-accent hover:bg-admin-accent/90`

4. **`src/routes/_authenticated/admin.triagem.tsx`**
   - Botão WhatsApp (293): manter cor verde (semântica de WhatsApp), mas remover `font-display uppercase tracking-widest text-xs` e ajustar altura para padrão (`size="sm"` ou padrão), igualando peso visual

5. **`src/routes/_authenticated/admin.pdv.tsx`**
   - Botão "App" (190): manter `bg-yellow-brand` (semântica), apenas garantir `size="sm"` já presente e sem font especial (já está OK)

### Não alterar
- Botões `variant="outline"`, `variant="ghost"`, `variant="icon"` — já são variantes neutras do design system
- Cores semânticas (verde WhatsApp, vermelho destrutivo) ficam, só normaliza fonte/tamanho

Resultado: todos os botões de ação primária no /admin compartilham fonte, tamanho e cor base, com exceções apenas por semântica (WhatsApp verde, destrutivo vermelho).