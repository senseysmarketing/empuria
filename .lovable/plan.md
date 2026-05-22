## Problema

A tela `/login` já possui o formulário de "Criar conta" chamando `supabase.auth.signUp`, mas o cadastro não conclui o fluxo porque:

1. **Não existe trigger `handle_new_user`** em `auth.users` — ou seja, ao criar uma conta, nenhuma linha é inserida em `public.profiles` nem em `public.user_roles`.
2. Sem `user_roles`, a função `is_staff()` / `getCurrentUserRole()` falha ou retorna vazio, e o redirecionamento pós-login para `/portal` quebra (era a causa raiz do erro `permission denied for function is_staff` reportado antes).
3. O `full_name` enviado em `options.data` nunca é persistido em `profiles`.

## Plano

### 1. Migration — auto-provisionar perfil e role no signup

Criar função `public.handle_new_user()` (SECURITY DEFINER, search_path fixo) e trigger `on_auth_user_created` em `auth.users AFTER INSERT`:

- Insere em `public.profiles (id, full_name)` usando `NEW.id` e `NEW.raw_user_meta_data->>'full_name'` (fallback para parte antes do `@` do email).
- Insere em `public.user_roles (user_id, role)` com role `'member'` por padrão.
- `ON CONFLICT DO NOTHING` em ambos para idempotência (cobre casos de retry / usuários já existentes).

Também rodar um **backfill único**: para todo `auth.users` que ainda não tem `profile`/`user_role`, criar as linhas correspondentes — assim contas já cadastradas (incluindo a sua que está dando erro) passam a funcionar.

### 2. Front-end (`src/routes/login.tsx`)

O código atual já está quase correto. Pequenos ajustes:

- Após `signUp`, verificar `data.session`: se o Supabase retornou sessão (confirmação de e-mail desativada no projeto), invalidar o cache do React Query e redirecionar direto para `/portal` em vez de só mostrar mensagem "verifique seu e-mail". Se não houver sessão, manter a mensagem de confirmação.
- Garantir `emailRedirectTo: ${window.location.origin}/portal` (já está) para o caso de confirmação por e-mail.

### 3. Validação

- Criar conta nova pela tela `/login` → confirmar que `profiles` e `user_roles` ganham linha automaticamente e o usuário entra em `/portal` sem o erro `permission denied`.
- Logar com conta existente → mesmo fluxo funciona.

### Fora de escopo

- Não vou mexer em OAuth (Google/Apple) — não foi pedido.
- Não vou criar tela separada de "esqueci minha senha" agora (pode ser pedido depois).
- Não vou alterar a estética da tela (já aprovada).
