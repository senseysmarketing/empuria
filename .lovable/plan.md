## Diagnóstico

- Usuário `senseystrafego@gmail.com` existe, está confirmado e tem role `admin` no banco. ✅
- O fluxo atual de login (`src/routes/login.tsx`) faz `signInWithPassword` e sempre redireciona para `/portal` (ou para o `?redirect=` da URL) — **sem consultar a role**. Por isso o admin cai no portal de membro em vez do `/admin`.
- O layout `_authenticated/admin.tsx` **não tem nenhum guard de role** — qualquer usuário autenticado consegue abrir `/admin`.
- O `_authenticated.tsx` chama `await supabase.auth.getSession()` no `beforeLoad`. Após login, a sessão é gravada no `localStorage` antes do `navigate`, então o problema do "não consigo logar" provavelmente é o redirect indo pro `/portal` (que pode estar quebrando por outro motivo) e parecendo que o login falhou. Vou adicionar logging defensivo + redirect correto por role para descartar.

## O que vou construir

### 1. Hook compartilhado de role (`src/hooks/use-current-user.ts`)
- Server function `getCurrentUserRole` (em `src/lib/auth.functions.ts`) protegida por `requireSupabaseAuth`, retornando `{ userId, email, roles: string[], primaryRole: 'admin' | 'staff' | 'member' }`.
- Hook React (`useCurrentUser`) usando TanStack Query (`queryKey: ['current-user']`) para chamar a server-fn e expor `{ isLoading, role, isAdmin, isStaff, isMember }`.

### 2. Login com redirecionamento por role (`src/routes/login.tsx`)
- Após `signInWithPassword`:
  - Invalida `queryClient` para limpar cache.
  - Busca a role via server-fn (`getCurrentUserRole`).
  - Se admin/staff → `navigate({ to: '/admin' })`.
  - Senão → `navigate({ to: '/portal' })`.
  - Se houver `?redirect=` explícito **e** a role permite acessar, respeita o redirect; caso contrário, ignora.
- Adiciona `try/catch` com mensagem de erro mais clara (mostra `error.message` do Supabase: "Invalid login credentials", "Email not confirmed" etc).
- `beforeLoad`: se já estiver logado, redireciona para a tela certa por role (evita ficar preso na tela de login).

### 3. Guard de admin (`src/routes/_authenticated/admin.tsx`)
- Converte `AdminLayout` para verificar a role via `useCurrentUser`.
- Se a role **não** for admin/staff → renderiza componente `<AccessDeniedCard variant="admin-required" />` em vez do `<Outlet />`.
- Card amigável com:
  - Logo + título "Esta área é exclusiva da equipe."
  - Texto curto explicando.
  - Botão primário "Voltar ao meu painel" → `/portal`.
  - Botão secundário "Sair" (signOut).

### 4. Guard inverso no portal (`src/routes/_authenticated/portal.tsx`)
- Se a role for admin/staff → renderiza `<AccessDeniedCard variant="member-only" />` com:
  - "Esta área é exclusiva de membros."
  - Botão primário "Ir para o painel admin" → `/admin`.
  - (Mantém botão de logout.)
- Observação: hoje o portal já mostra um link "Ir para Admin" quando staff. Vou substituir por **bloqueio total** conforme pedido.

### 5. Componente reutilizável `src/components/auth/AccessDeniedCard.tsx`
- Props: `variant: 'admin-required' | 'member-only'`.
- Visual coerente com o tema (`bg-brown`/`bg-admin-bg` conforme variante), usando design tokens existentes.

### 6. Invalidação no logout
- No `__root.tsx` (ou no portal/admin), adicionar listener `supabase.auth.onAuthStateChange` que chama `queryClient.invalidateQueries()` + `router.invalidate()` para não vazar dados entre usuários.

## Detalhes técnicos

```text
Fluxo de login:
  signInWithPassword
    → queryClient.invalidateQueries({ queryKey: ['current-user'] })
    → role = await getCurrentUserRole()
    → navigate(role.isAdmin ? '/admin' : '/portal')

Guard /admin:
  _authenticated (sessão ok?) → admin.tsx (role admin/staff?)
    sim → <Outlet />
    não → <AccessDeniedCard variant="admin-required" />

Guard /portal:
  _authenticated → portal.tsx (role member?)
    sim → painel normal
    não (admin/staff) → <AccessDeniedCard variant="member-only" />
```

Arquivos novos:
- `src/lib/auth.functions.ts`
- `src/hooks/use-current-user.ts`
- `src/components/auth/AccessDeniedCard.tsx`

Arquivos editados:
- `src/routes/login.tsx` (redirect por role + beforeLoad)
- `src/routes/_authenticated/admin.tsx` (guard de admin)
- `src/routes/_authenticated/portal.tsx` (guard inverso)
- `src/routes/__root.tsx` (listener de auth state para invalidar cache)

Não preciso de migração — a tabela `user_roles` e a função `has_role` já existem.
