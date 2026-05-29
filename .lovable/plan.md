# /admin/configuracoes — Centro de configurações

Implementação em uma única entrega, seguindo a ordem do PDF e respeitando a decisão de manter Integrações apenas visual.

## 1. Banco (migration única)

**`staff_module_permissions`**
- `id uuid pk`, `user_id uuid → profiles(id) on delete cascade`
- `module_key text` (valores: `cockpit`, `pdv`, `eventos`, `esteira`, `triagem`, `agenda`, `usuarios`, `clube`, `slots`, `configuracoes`, `pdv_itens`, `automacoes`, `logs`)
- `is_allowed boolean default false`, timestamps
- `unique(user_id, module_key)`
- GRANTs (`authenticated` SELECT, `service_role` ALL) + RLS: staff lê o próprio, admin gerencia tudo (via `has_role`)

**`audit_logs`**
- `id`, `actor_id`, `action text`, `module text`, `entity_type text`, `entity_id uuid`, `old_data jsonb`, `new_data jsonb`, `metadata jsonb default '{}'`, `created_at`
- GRANTs + RLS: apenas admin lê; insert via `service_role` (server fns)

**Função SQL** `has_module_access(_user_id uuid, _module text) returns boolean` (security definer): retorna true se admin OU se existir linha `is_allowed=true` em `staff_module_permissions`. Default para staff sem linha: **negado**.

## 2. Server functions novas (`src/lib/admin/`)

- `permissions.functions.ts`: `listStaffPermissions(userId)`, `setStaffPermission(userId, module, allowed)`, `getMyModuleAccess()` (retorna lista de módulos permitidos para o usuário logado — admin = todos)
- `account.functions.ts` (Perfil & Conta próprio): `updateMyProfile`, `updateMyEmail`, `updateMyPassword` — distintas de `usuarios.functions.ts`
- `pdv-itens.functions.ts`: CRUD de `products` (create/update/toggleActive/reorder/setPrice) — não toca em `pdv.functions.ts` operacional
- `audit.functions.ts`: `listAuditLogs({module?, limit})`, helper interno `logAudit(...)` reutilizado pelas outras server fns críticas (permissões, pdv itens, automações, perfil)
- Novo middleware em `src/lib/admin/auth.ts`: `requireModule(moduleKey)` — encapsula `requireStaff` + checagem via `has_module_access`. Admin passa direto; staff sem permissão lança erro `MODULE_FORBIDDEN`.

As server fns existentes de cada módulo (esteira, agenda, triagem, etc.) ganham `requireModule('<key>')` substituindo `requireStaff`, módulo por módulo (admin continua tendo acesso total automaticamente).

## 3. Hook de acesso no front

- `src/hooks/use-module-access.ts`: query `getMyModuleAccess` (staleTime 60s). Retorna `{ allowed: Set<string>, can(module) }`.
- `AdminDock.tsx`: filtra itens conforme `can(module)`. Remove o item "Auto" (vai para Configurações).
- Cada rota `/_authenticated/admin.<modulo>.tsx`: em `beforeLoad`, valida acesso via server fn `assertModuleAccess(module)`; se falhar, redireciona para `/admin/acesso-negado` com mensagem amigável.
- Nova rota `/_authenticated/admin.acesso-negado.tsx` reaproveitando o estilo do `AccessDeniedCard` com variante "module-restricted".

## 4. Tela `/admin/configuracoes`

**Arquivo:** `src/routes/_authenticated/admin.configuracoes.tsx`
**Search param:** `?tab=perfil|integracoes|equipe|pdv-itens|automacoes|logs` (default `perfil`)

Layout: `Tabs` shadcn no tema admin (bg-admin-surface, border-admin-border). Cada aba é um componente próprio em `src/components/admin/configuracoes/`:

- **`PerfilContaTab.tsx`** — formulário com nome/telefone/avatar, blocos separados para "Alterar e-mail" e "Alterar senha" (Supabase Auth update + confirmação).
- **`IntegracoesTab.tsx`** — apenas visual. 3 cards (Mercado Pago, Hubla, WhatsApp) com ícone, descrição do PDF e badge "Em breve". Sem inputs, sem tokens.
- **`EquipePermissoesTab.tsx`** (admin-only) — lista usuários staff+admin com toggle por módulo (matriz user × módulo). Admin tem todos os toggles desabilitados em "on". Salva via `setStaffPermission`. Mostra também botão para promover/demover staff (reaproveita `updateUserRole` se existir; caso não, cria função mínima).
- **`PdvItensTab.tsx`** — tabela de `products` com criar/editar (sheet lateral), drag para ordenar (`position`), toggle ativo, editar preço inline. Reusa `Sheet` + `ProductEditSheet` novo.
- **`AutomacoesTab.tsx`** — importa o conteúdo atual de `admin.automacoes.tsx` extraído para `src/components/admin/AutomacoesPanel.tsx`. A rota `/admin/automacoes` passa a redirecionar para `/admin/configuracoes?tab=automacoes`.
- **`LogsAuditoriaTab.tsx`** — duas seções: "Auditoria" (lista `audit_logs` com filtros por módulo/ação) e "Impersonações" (lista `impersonation_logs`). Paginação simples.

## 5. TopBar admin

`HeroTopBar.tsx` (variant=admin): adicionar botão "Configurações" (ícone `Settings`) à direita, link para `/admin/configuracoes`. Visível apenas se `can('configuracoes')` (admin sempre).

## 6. AdminDock

Remover `Auto` da lista de itens. Manter os demais. Filtrar por `useModuleAccess().can(...)`.

## 7. Rotas afetadas

- Criar: `admin.configuracoes.tsx`, `admin.acesso-negado.tsx`
- Editar: `admin.automacoes.tsx` (redirect), todas as rotas admin existentes (adicionar `beforeLoad` de checagem)
- `AdminDock.tsx`, `HeroTopBar.tsx`

## 8. Fora de escopo (confirmado pelo PDF)

- Integração real com Mercado Pago / Hubla / WhatsApp (apenas cards "Em breve")
- Webhooks, tokens, QR Code de pagamento
- Permissões granulares (can_create/update/delete por ação) — fica só por módulo
- Mexer no PDV operacional (`pdv.functions.ts`) — só CRUD de produtos via funções separadas

## 9. Riscos e mitigações

- **Permissão só no front**: `requireModule` no servidor é a fonte de verdade; front só esconde UI.
- **Quebrar staff atual**: novo helper `requireModule` é additivo; staff sem nenhuma linha em `staff_module_permissions` perde acesso → **na migration, popular `is_allowed=true` para todos os staff existentes em todos os módulos** para preservar comportamento atual. Admin gerencia depois.
- **Logs sensíveis**: `logAudit` só persiste IDs/labels, nunca tokens, senhas ou documentos.

## Ordem de execução

1. Migration (tabelas + função + seed de permissões para staff existente)
2. Server fns novas + middleware `requireModule`
3. Hook `useModuleAccess` + rota `/admin/acesso-negado`
4. Tela `/admin/configuracoes` com as 6 abas
5. TopBar + AdminDock (botão + remoção de Auto)
6. Aplicar `requireModule` em cada rota admin existente + redirect de `/admin/automacoes`
