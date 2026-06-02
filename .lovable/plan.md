## Objetivo

Adicionar na aba **Configurações → Equipe & Permissões** um botão para que admins criem novos usuários da equipe (staff ou admin), reutilizando o fluxo de "primeiro acesso" já existente (sem definir senha na criação). Staff continua precisando de permissões por módulo; admin recebe acesso total automático. Ao logar pela primeira vez, o usuário é direcionado para `/admin` (já tratado em `login.tsx` via `role.isStaff`).

## Mudanças

### 1. Server function — `src/lib/admin/permissions.functions.ts`
Adicionar `createStaffMember` (POST, protegida por `requireAdmin()`):
- Input (zod): `full_name`, `email`, `phone` (opcional), `role` (`"staff" | "admin"`).
- Reusa `createOrReuseManualCustomer({ origin: "admin_created", actorId, ... })` para criar/reaproveitar o usuário no Auth + `profiles` com `password_setup_required = true`.
- Insere a role correspondente em `user_roles` via `supabaseAdmin.upsert({ user_id, role }, { onConflict: "user_id,role" })`. Se admin foi escolhido, também garante que tenha role `admin` (sem remover `member` herdada do helper).
- Registra `audit_logs` com `action: "staff.created"` ou `"staff.role_granted"` se o usuário já existia.
- Retorna `{ user_id, created, role }`.

### 2. Modal — `src/components/admin/configuracoes/NewStaffDialog.tsx` (novo)
Espelha o visual de `QuickCustomerDialog.tsx` (mesmas classes `bg-admin-surface/border-admin-border`, mesmo aviso amarelo sobre primeiro acesso).
Campos:
- Nome completo (obrigatório)
- E-mail (obrigatório)
- Telefone (opcional)
- Função: `RadioGroup` ou `Select` com `Staff` / `Admin` (descrição curta de cada um)
- Aviso: "Nenhuma senha será definida. O membro deverá usar **Primeiro acesso** no login para criar sua senha. Staff é direcionado para /admin automaticamente."

Ao salvar: chama `createStaffMember`, mostra toast, invalida `["staff-permissions"]` e fecha.

### 3. Tab — `src/components/admin/configuracoes/EquipePermissoesTab.tsx`
- Adicionar header com botão **"Novo membro"** (ícone `UserPlus`) à direita do título.
- Botão só aparece para admins. Como `listStaffWithPermissions` já exige admin (retorna 403 senão), usar `useCurrentUser().isAdmin` para esconder/desabilitar para staff.
- Estado local `openNew` controlando o `NewStaffDialog`.

### 4. Permissão de toggles (defensivo)
Os toggles de permissão hoje já chamam `setStaffPermission` que está protegida por `requireAdmin()`. Para UX, desabilitar os `<Switch>` quando o usuário corrente não é admin (mesma checagem `useCurrentUser().isAdmin`), evitando erros visuais. Isso não muda a regra de segurança no servidor.

## Banco de dados

Nenhuma migração necessária — tabelas `profiles`, `user_roles`, `staff_module_permissions`, `audit_logs` e o enum `app_role` já suportam `staff` e `admin`.

## Fora de escopo

- Remoção de role / exclusão de membro (pode vir depois).
- Edição de nome/email do membro após criação (já existe na aba Usuários).
- Fluxo de e-mail de convite (continuamos com "Primeiro acesso" manual, conforme pedido).
