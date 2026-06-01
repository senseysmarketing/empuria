## Objetivo

Deixar os botões "Escanear Passaporte" e "Registrar chegada" (no topo do `/admin`) com a mesma estética do botão "CONFIGURAÇÕES" do HeroTopBar — em vez do laranja sólido atual.

## Estilo de referência (Configurações)

Definido em `src/components/shared/HeroTopBar.tsx`:

```
inline-flex items-center gap-2 px-3 h-10 rounded-lg
bg-brown-deep/60 hover:bg-brown-deep
border border-orange-brand/30 hover:border-orange-brand/60
text-offwhite hover:text-orange-brand transition-colors
font-display text-xs uppercase tracking-wider
```

Ícone: `h-4 w-4`, label em uppercase com tracking-wider.

## Mudanças

1. `src/components/admin/ArrivalDialog.tsx`
   - Trocar o `<Button size="sm" className="bg-admin-accent ...">` do `DialogTrigger` por um `<button>` (ou `Button variant="ghost"` com `asChild`) usando exatamente a mesma classe do Configurações.
   - Texto "REGISTRAR CHEGADA" em uppercase (via `uppercase` class, mantendo string original).
   - Manter `DoorOpen` em `h-4 w-4`.

2. `src/components/admin/PassportScannerDialog.tsx`
   - Trocar o `<Button size="sm" className="bg-admin-accent ...">` que abre o dialog pelo mesmo estilo.
   - Texto "ESCANEAR PASSAPORTE" em uppercase.
   - Manter `Camera` em `h-4 w-4`.

3. Sem alterações no botão Configurações nem em lógica/handlers/dialog content — só o gatilho visual.

## Resultado esperado

Os três botões no topo do `/admin` ficam visualmente idênticos: mesma altura (h-10), mesmo fundo escuro translúcido, mesma borda laranja sutil, mesma tipografia uppercase font-display, ícone 16px à esquerda.
