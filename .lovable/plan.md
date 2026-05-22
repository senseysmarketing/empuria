## Logo do Instituto clicável nos docks

Tornar o ícone do Empuria (logo) no início dos docks clicável, levando para a home de cada área.

### Mudanças
- `src/components/portal/PortalDock.tsx`: envolver `<img logoIcone />` em `<Link to="/portal">` com `aria-label="Início"` e estilos de hover sutis (opacidade).
- `src/components/admin/AdminDock.tsx`: mesma alteração, com `<Link to="/admin">`.

Sem mudanças de layout, tamanho ou espaçamento — apenas o `<img>` vira link.