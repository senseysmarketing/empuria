## Ajustes de espaçamento e tamanho no HeroTopBar

### 1. `src/components/shared/HeroTopBar.tsx`

- Unificar o gap entre actions e Configurações: trocar o `<div className="flex items-center gap-2">` (linha 105) para `gap-3`, e aumentar o gap principal da topbar de `gap-4` para `gap-5` (linha 80) — assim "VENDAS HOJE", botões de ação e Configurações ficam com respiro consistente.
- Aumentar o bloco "VENDAS HOJE" (quickStat):
  - Label: `text-[10px]` → `text-[11px]`.
  - Valor: `text-2xl` → `text-3xl`.
  - Padding/separação: `pl-4` → `pl-5`.
- Aumentar levemente os botões padrão (Configurações, Escanear Passaporte, Registrar chegada) para casar com o novo tamanho do quickStat:
  - Altura `h-10` → `h-11`, padding `px-3` → `px-4`, gap interno `gap-2` → `gap-2.5`, ícone `h-4 w-4` → `h-[18px] w-[18px]`.

### 2. `src/components/admin/ArrivalDialog.tsx` e `src/components/admin/PassportScannerDialog.tsx`

- Aplicar exatamente a mesma atualização de classes do botão Configurações (`h-11 px-4 gap-2.5`) e ícone (`h-[18px] w-[18px]`), para que os três botões fiquem visualmente idênticos.

Nenhuma mudança de lógica — apenas classes Tailwind para padronizar espaçamento e tamanho.
