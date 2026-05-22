# Módulo Passaportes Empuria — Gestão de Usuários

## 1. Migração de banco
- `profiles`: adicionar `is_blocked boolean NOT NULL DEFAULT false` e `admin_notes text`.
- Nova tabela `impersonation_logs`: `id`, `admin_id`, `target_user_id`, `reason text NOT NULL`, `created_at`. RLS: somente staff lê/insere.
- Sem nova coluna para "Passaporte ID" — derivado do `profile.id` como `EMP-AAAA-XXXXXX` (ano + 6 primeiros hex maiúsculos). Busca por código reverte para `id LIKE`.

## 2. Server functions (`src/lib/admin/usuarios.functions.ts`, todas com `requireStaff`)
- `listUsers({ search, status, clube, period, page, pageSize })` — junta `profiles` com `supabaseAdmin.auth.admin.listUsers()` (paginado) para retornar `email` e `last_sign_in_at`. Filtros aplicados em memória após o merge da página.
- `updateUserProfile({ id, full_name, phone, is_club_member, admin_notes })`.
- `setUserBlocked({ id, blocked })` — atualiza `profiles.is_blocked` e chama `auth.admin.updateUserById(id, { ban_duration: blocked ? "876000h" : "none" })`.
- `forcePasswordReset({ id })` — `auth.admin.generateLink({ type: "recovery" })`, devolve URL para o admin copiar (toast).
- `changeUserEmail({ id, new_email })` — `auth.admin.updateUserById`.
- `impersonateUser({ id, reason })` — valida `reason.length >= 10`, grava em `impersonation_logs`, gera magiclink (`auth.admin.generateLink({ type: "magiclink" })`) e retorna a URL. O front faz `window.open(url, "_blank")` — admin permanece logado na aba original.

## 3. Rota e UI (`src/routes/_authenticated/admin.usuarios.tsx`)

**Bento de controle (topo, `bg-offwhite` em card claro sobre o `bg-admin-bg`):**
- Busca global com debounce 300 ms (nome, email, código `EMP-…`, UUID).
- 3 dropdowns: Status (Todos/Ativos/Bloqueados), Clube (Todos/Sim/Não), Cadastro (Todos/7d/Mês).
- 3 mini-tiles (`MetricTile`): Total ativos, Membros do Clube, Novos no mês.

**Lista (cards em List View, não tabela densa):**
Cada linha = card `bg-admin-surface` com:
- Avatar redondo + Nome (Philosopher bold) + email
- Passaporte ID (monospace, clique copia)
- Pílula status: verde "Ativo" / vermelha "Bloqueado"
- Pílula clube: amarela "VIP" / cinza "Standard"
- Último acesso (relativo: "há 2h")
- `DropdownMenu` (`MoreVertical`) à direita

**Menu de ações:**
1. **Editar perfil** → `Sheet` lateral com form (nome, telefone, clube, notas).
2. **Trocar senha** → confirma → toast com link copiável.
3. **Alterar e-mail** → modal pequeno.
4. **Bloquear/Desbloquear** → `AlertDialog` destrutivo.
5. **Acessar como usuário** → `AlertDialog` com `Textarea` de motivo obrigatório. Ao confirmar: abre magiclink em nova aba (`window.open(url, "_blank", "noopener")`). Aviso amarelo: "Sua sessão de admin permanece nesta aba."

Paginação simples (Anterior/Próxima) com `pageSize=25`.

## 4. Navegação
- `AdminDock`: adicionar item "Usuários" (ícone `Users`) entre **Clube** e **Auto**.

## 5. Segurança
- Toda ação grava também em `activity_feed` (tipo reaproveita `member_joined` ou novo `user_managed` — escolheremos `user_managed`).
- Impersonação registrada em `impersonation_logs` com motivo obrigatório; magic link expira em 1h (padrão Supabase).
- Nenhum segredo no cliente — todo `supabaseAdmin` fica em server functions.

## Arquivos
```text
supabase/migrations/<timestamp>_passaportes_empuria.sql   (novo)
src/lib/admin/usuarios.functions.ts                       (novo)
src/routes/_authenticated/admin.usuarios.tsx              (novo)
src/components/admin/UsuarioEditSheet.tsx                 (novo)
src/components/admin/ImpersonateDialog.tsx                (novo)
src/components/admin/AdminDock.tsx                        (editar — novo item)
```
