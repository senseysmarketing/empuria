-- Financeiro & Caixa: base tables, permissions and automatic sync from PDV/Orders.

CREATE TABLE IF NOT EXISTS public.finance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('income', 'expense', 'both')),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, type)
);

CREATE TABLE IF NOT EXISTS public.finance_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  type text NOT NULL DEFAULT 'cash' CHECK (type IN ('cash', 'bank', 'card', 'gateway', 'other')),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'EUR', 'USD')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('planned', 'pending', 'received', 'paid', 'overdue', 'canceled')),
  description text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'EUR', 'USD')),
  amount_brl_cents integer,
  fx_rate numeric,
  fx_date date,
  due_date date NOT NULL DEFAULT CURRENT_DATE,
  paid_at timestamptz,
  category_id uuid REFERENCES public.finance_categories(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.finance_accounts(id) ON DELETE SET NULL,
  payment_method text,
  source_module text NOT NULL DEFAULT 'manual',
  source_id uuid,
  is_automatic boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_transactions_source
  ON public.finance_transactions (source_module, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_transactions_due_date
  ON public.finance_transactions (due_date DESC);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_status
  ON public.finance_transactions (status);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_type
  ON public.finance_transactions (type);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_category
  ON public.finance_transactions (category_id);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_account
  ON public.finance_transactions (account_id);

CREATE TABLE IF NOT EXISTS public.finance_recurring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  description text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'EUR', 'USD')),
  amount_brl_cents integer,
  category_id uuid REFERENCES public.finance_categories(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.finance_accounts(id) ON DELETE SET NULL,
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'weekly', 'yearly')),
  day_of_month integer NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 31),
  is_active boolean NOT NULL DEFAULT true,
  next_run_at date,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.finance_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.finance_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.finance_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.finance_recurring_rules TO authenticated;
GRANT ALL ON public.finance_categories TO service_role;
GRANT ALL ON public.finance_accounts TO service_role;
GRANT ALL ON public.finance_transactions TO service_role;
GRANT ALL ON public.finance_recurring_rules TO service_role;

ALTER TABLE public.finance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_recurring_rules ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_finance_categories_updated_at ON public.finance_categories;
CREATE TRIGGER update_finance_categories_updated_at
  BEFORE UPDATE ON public.finance_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_finance_accounts_updated_at ON public.finance_accounts;
CREATE TRIGGER update_finance_accounts_updated_at
  BEFORE UPDATE ON public.finance_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_finance_transactions_updated_at ON public.finance_transactions;
CREATE TRIGGER update_finance_transactions_updated_at
  BEFORE UPDATE ON public.finance_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_finance_recurring_rules_updated_at ON public.finance_recurring_rules;
CREATE TRIGGER update_finance_recurring_rules_updated_at
  BEFORE UPDATE ON public.finance_recurring_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Finance module view categories" ON public.finance_categories
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'));
CREATE POLICY "Finance module manage categories" ON public.finance_categories
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'));

CREATE POLICY "Finance module view accounts" ON public.finance_accounts
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'));
CREATE POLICY "Finance module manage accounts" ON public.finance_accounts
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'));

CREATE POLICY "Finance module view transactions" ON public.finance_transactions
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'));
CREATE POLICY "Finance module manage transactions" ON public.finance_transactions
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'));

CREATE POLICY "Finance module view recurring rules" ON public.finance_recurring_rules
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'));
CREATE POLICY "Finance module manage recurring rules" ON public.finance_recurring_rules
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'financeiro'));

INSERT INTO public.finance_categories (name, type, is_system)
VALUES
  ('PDV', 'income', true),
  ('Pedidos/Servicos', 'income', true),
  ('Eventos', 'income', true),
  ('Manual', 'both', true),
  ('Aluguel', 'expense', true),
  ('Equipe', 'expense', true),
  ('Marketing', 'expense', true),
  ('Fornecedores', 'expense', true),
  ('Estoque', 'expense', true),
  ('Ferramentas', 'expense', true),
  ('Impostos', 'expense', true),
  ('Manutencao', 'expense', true),
  ('Outras despesas', 'expense', true)
ON CONFLICT (name, type) DO UPDATE SET is_system = true, is_active = true;

INSERT INTO public.finance_accounts (name, type, currency)
VALUES
  ('Caixa fisico', 'cash', 'BRL'),
  ('Dinheiro EUR', 'cash', 'EUR'),
  ('Mercado Pago', 'gateway', 'BRL'),
  ('Cartao', 'card', 'BRL'),
  ('Banco', 'bank', 'BRL'),
  ('Outro', 'other', 'BRL')
ON CONFLICT (name) DO UPDATE SET is_active = true;

CREATE OR REPLACE FUNCTION public.finance_category_id(p_name text, p_type text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.finance_categories
  WHERE name = p_name AND type IN (p_type, 'both')
  ORDER BY CASE WHEN type = p_type THEN 0 ELSE 1 END
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.finance_account_id_for_payment(p_payment_method text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.finance_accounts
  WHERE name = CASE
    WHEN p_payment_method = 'dinheiro' THEN 'Dinheiro EUR'
    WHEN p_payment_method = 'cartao' THEN 'Cartao'
    WHEN p_payment_method = 'mercadopago' THEN 'Mercado Pago'
    ELSE 'Caixa fisico'
  END
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.finance_sync_pdv_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.pdv_sales%ROWTYPE;
  v_status text;
  v_amount integer;
  v_currency text;
  v_amount_brl integer;
BEGIN
  SELECT * INTO v_sale FROM public.pdv_sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_status := CASE WHEN v_sale.status = 'cancelada' THEN 'canceled' ELSE 'received' END;
  v_currency := CASE WHEN COALESCE(v_sale.total_brl_cents, 0) > 0 THEN 'BRL' ELSE 'EUR' END;
  v_amount := CASE WHEN v_currency = 'BRL' THEN v_sale.total_brl_cents ELSE v_sale.total_eur_cents END;
  v_amount_brl := CASE WHEN v_currency = 'BRL' THEN v_sale.total_brl_cents ELSE NULL END;

  INSERT INTO public.finance_transactions (
    type, status, description, amount_cents, currency, amount_brl_cents,
    due_date, paid_at, category_id, account_id, payment_method,
    source_module, source_id, is_automatic, notes, created_by
  )
  VALUES (
    'income',
    v_status,
    'Venda PDV ' || COALESCE(v_sale.sale_code, v_sale.id::text),
    COALESCE(v_amount, 0),
    v_currency,
    v_amount_brl,
    (v_sale.closed_at AT TIME ZONE 'UTC')::date,
    CASE WHEN v_status = 'received' THEN v_sale.closed_at ELSE NULL END,
    public.finance_category_id('PDV', 'income'),
    public.finance_account_id_for_payment(v_sale.payment_method),
    v_sale.payment_method,
    'pdv',
    v_sale.id,
    true,
    CASE WHEN v_sale.status = 'cancelada' THEN COALESCE(v_sale.void_reason, 'Venda anulada no PDV') ELSE v_sale.notes END,
    v_sale.cashier_id
  )
  ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
    status = excluded.status,
    description = excluded.description,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    amount_brl_cents = excluded.amount_brl_cents,
    due_date = excluded.due_date,
    paid_at = excluded.paid_at,
    account_id = excluded.account_id,
    payment_method = excluded.payment_method,
    notes = excluded.notes,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_sync_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_status text;
  v_amount_brl integer;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_status := CASE v_order.payment_status
    WHEN 'aprovado' THEN 'received'
    WHEN 'pendente' THEN 'pending'
    ELSE 'canceled'
  END;
  v_amount_brl := CASE WHEN v_order.currency = 'BRL' THEN v_order.amount_cents ELSE NULL END;

  INSERT INTO public.finance_transactions (
    type, status, description, amount_cents, currency, amount_brl_cents,
    due_date, paid_at, category_id, account_id, payment_method,
    source_module, source_id, is_automatic, notes, created_by
  )
  VALUES (
    'income',
    v_status,
    'Pedido ' || COALESCE(v_order.service_title, v_order.id::text),
    COALESCE(v_order.amount_cents, 0),
    COALESCE(v_order.currency, 'EUR'),
    v_amount_brl,
    (v_order.created_at AT TIME ZONE 'UTC')::date,
    CASE WHEN v_status = 'received' THEN now() ELSE NULL END,
    public.finance_category_id('Pedidos/Servicos', 'income'),
    public.finance_account_id_for_payment(NULL),
    NULL,
    'orders',
    v_order.id,
    true,
    v_order.notes,
    v_order.user_id
  )
  ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
    status = excluded.status,
    description = excluded.description,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    amount_brl_cents = excluded.amount_brl_cents,
    paid_at = excluded.paid_at,
    notes = excluded.notes,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_sync_pdv_sale_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.finance_sync_pdv_sale(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_sync_order_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.finance_sync_order(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finance_sync_pdv_sales ON public.pdv_sales;
CREATE TRIGGER trg_finance_sync_pdv_sales
  AFTER INSERT OR UPDATE OF status, total_eur_cents, total_brl_cents, voided_at, void_reason
  ON public.pdv_sales
  FOR EACH ROW EXECUTE FUNCTION public.finance_sync_pdv_sale_trigger();

DROP TRIGGER IF EXISTS trg_finance_sync_orders ON public.orders;
CREATE TRIGGER trg_finance_sync_orders
  AFTER INSERT OR UPDATE OF payment_status, amount_cents, currency
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.finance_sync_order_trigger();

INSERT INTO public.finance_transactions (
  type, status, description, amount_cents, currency, amount_brl_cents,
  due_date, paid_at, category_id, account_id, payment_method,
  source_module, source_id, is_automatic, notes, created_by
)
SELECT
  'income',
  CASE WHEN s.status = 'cancelada' THEN 'canceled' ELSE 'received' END,
  'Venda PDV ' || COALESCE(s.sale_code, s.id::text),
  CASE WHEN COALESCE(s.total_brl_cents, 0) > 0 THEN s.total_brl_cents ELSE s.total_eur_cents END,
  CASE WHEN COALESCE(s.total_brl_cents, 0) > 0 THEN 'BRL' ELSE 'EUR' END,
  CASE WHEN COALESCE(s.total_brl_cents, 0) > 0 THEN s.total_brl_cents ELSE NULL END,
  (s.closed_at AT TIME ZONE 'UTC')::date,
  CASE WHEN s.status <> 'cancelada' THEN s.closed_at ELSE NULL END,
  public.finance_category_id('PDV', 'income'),
  public.finance_account_id_for_payment(s.payment_method),
  s.payment_method,
  'pdv',
  s.id,
  true,
  CASE WHEN s.status = 'cancelada' THEN COALESCE(s.void_reason, 'Venda anulada no PDV') ELSE s.notes END,
  s.cashier_id
FROM public.pdv_sales s
ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO NOTHING;

INSERT INTO public.finance_transactions (
  type, status, description, amount_cents, currency, amount_brl_cents,
  due_date, paid_at, category_id, account_id, payment_method,
  source_module, source_id, is_automatic, notes, created_by
)
SELECT
  'income',
  CASE o.payment_status
    WHEN 'aprovado' THEN 'received'
    WHEN 'pendente' THEN 'pending'
    ELSE 'canceled'
  END,
  'Pedido ' || COALESCE(o.service_title, o.id::text),
  COALESCE(o.amount_cents, 0),
  COALESCE(o.currency, 'EUR'),
  CASE WHEN o.currency = 'BRL' THEN o.amount_cents ELSE NULL END,
  (o.created_at AT TIME ZONE 'UTC')::date,
  CASE WHEN o.payment_status = 'aprovado' THEN o.updated_at ELSE NULL END,
  public.finance_category_id('Pedidos/Servicos', 'income'),
  public.finance_account_id_for_payment(NULL),
  NULL,
  'orders',
  o.id,
  true,
  o.notes,
  o.user_id
FROM public.orders o
ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO NOTHING;

REVOKE ALL ON FUNCTION public.finance_category_id(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_account_id_for_payment(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_sync_pdv_sale(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_sync_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_category_id(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_account_id_for_payment(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_pdv_sale(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_order(uuid) TO service_role;
