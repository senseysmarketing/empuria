## Diagnóstico

Não é bug visual — os nomes realmente mudam retroativamente.

Verifiquei no banco: várias vendas PDV apontam para o mesmo `customer_id` (`fd3defe9-…`). Hoje esse perfil está como **"Rafael" / +34603677344**. Mas os screenshots mostram o mesmo registro como:
- **"André" / +34603677344** (Histórico PDV)
- **"Richard Gabriel" / +34613659080** (Relatórios após nova ação da Luana)
- **"Rafael"** (estado atual no banco)

Causa raiz em `src/lib/admin/manual-users.ts` → `createOrReuseManualCustomer`, usado pelo `createCustomerQuick` do PDV: quando a operadora cadastra um "novo cliente" no PDV reutilizando um e-mail já existente (ou um e-mail genérico/placeholder), o código faz `upsert` no `profiles` sobrescrevendo `full_name`, `phone` e `phone_country_iso` do perfil antigo. Como `pdv_sales` guarda só `customer_id` (sem snapshot), todas as vendas históricas daquele cliente passam a exibir o nome/telefone novos — daí a sensação de "os nomes ficam trocando".

## O que vamos fazer

### 1. Snapshot do cliente na venda (correção definitiva)

Migração:
- `ALTER TABLE pdv_sales ADD COLUMN customer_name_snapshot text, ADD COLUMN customer_phone_snapshot text;`
- (mesmo em `pdv_tabs` para comandas em aberto)
- Atualizar a função SQL `pdv_close_sale` para gravar o snapshot a partir do `profiles` no momento do fechamento.
- Trigger no `pdv_tabs` (INSERT/UPDATE customer_id) preenchendo o snapshot quando vazio.
- Backfill: preencher snapshots existentes com o `profiles.full_name`/`phone` atual (melhor o que temos agora do que continuar mudando).

### 2. UI passa a usar o snapshot

- `src/components/admin/pdv/PdvHistoryPanel.tsx` e `src/lib/admin/pdv-sales.functions.ts` → exibir `customer_name_snapshot ?? customer.full_name`, idem telefone.
- `src/lib/admin/reports.functions.ts` (aba Histórico de Pedidos) → mesmo fallback para linhas PDV.
- `src/components/admin/pdv/PdvTabsPanel.tsx` (comandas) → usar snapshot.

### 3. Parar de sobrescrever perfis existentes

Em `src/lib/admin/manual-users.ts`:
- Se já existe `auth.user` para o email **e** o perfil não foi criado como manual (`created_by_admin = false` ou pertence a um membro real), **não** alterar `full_name` / `phone` / `phone_country_iso`. Só reutilizar o `id` e retornar.
- Se o perfil é manual e os dados divergem, manter os dados originais por padrão e registrar `audit_logs` com `reuse_conflict`.
- Adicionar campo opcional `allowProfileUpdate` (default `false` no fluxo do PDV) para que apenas telas de edição explícita possam regravar nome/telefone.

### 4. Aviso no QuickCustomerDialog

`src/components/admin/pdv/QuickCustomerDialog.tsx`: antes de criar, se a busca já trouxer um cliente com o mesmo e-mail/telefone, sugerir selecioná-lo em vez de cadastrar duplicado (evita o cenário que originou o problema).

### 5. Verificação

- Rodar query confirmando snapshot preenchido nas 20 vendas existentes.
- Reabrir histórico do PDV e aba Relatórios → Histórico de Pedidos: nomes devem bater com o estado da venda, não com o perfil atual.
- Teste manual: criar cliente novo no PDV com e-mail já existente — perfil original não é renomeado.

## Observação

As três visões diferentes que você viu são todas a **mesma venda** apontando para o **mesmo perfil**, que foi reescrito várias vezes. Não há perda de dado financeiro — só de identidade histórica. Após o snapshot, cada venda passa a guardar quem era o cliente naquele momento.
