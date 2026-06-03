-- Mercado Pago transparent checkout integration: settings, payments and finance sync.

ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'test'
    CHECK (environment IN ('test', 'production')),
  ADD COLUMN IF NOT EXISTS public_key text,
  ADD COLUMN IF NOT EXISTS access_token text,
  ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'BRL'
    CHECK (default_currency IN ('BRL', 'EUR', 'USD')),
  ADD COLUMN IF NOT EXISTS statement_descriptor text NOT NULL DEFAULT 'EMPURIA',
  ADD COLUMN IF NOT EXISTS pix_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS boleto_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS card_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pix_expiration_minutes integer NOT NULL DEFAULT 30
    CHECK (pix_expiration_minutes BETWEEN 5 AND 1440),
  ADD COLUMN IF NOT EXISTS boleto_expiration_days integer NOT NULL DEFAULT 3
    CHECK (boleto_expiration_days BETWEEN 1 AND 30);

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS online_price_cents integer
    CHECK (online_price_cents IS NULL OR online_price_cents >= 0),
  ADD COLUMN IF NOT EXISTS online_currency text NOT NULL DEFAULT 'BRL'
    CHECK (online_currency IN ('BRL', 'EUR', 'USD')),
  ADD COLUMN IF NOT EXISTS display_price_note text;

UPDATE public.services
SET online_price_cents = price_cents,
    online_currency = 'BRL'
WHERE online_price_cents IS NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_provider_order_id text,
  ADD COLUMN IF NOT EXISTS payment_provider_payment_id text,
  ADD COLUMN IF NOT EXISTS payment_provider_reference text,
  ADD COLUMN IF NOT EXISTS payment_status_detail text,
  ADD COLUMN IF NOT EXISTS payment_url text,
  ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_amount_cents integer
    CHECK (payment_amount_cents IS NULL OR payment_amount_cents >= 0),
  ADD COLUMN IF NOT EXISTS payment_currency text
    CHECK (payment_currency IS NULL OR payment_currency IN ('BRL', 'EUR', 'USD')),
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS fx_rate numeric,
  ADD COLUMN IF NOT EXISTS fx_source text,
  ADD COLUMN IF NOT EXISTS fx_locked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_payment_provider
  ON public.orders (payment_provider, payment_provider_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_external_reference
  ON public.orders (external_reference);
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at
  ON public.orders (payment_expires_at)
  WHERE payment_status = 'pendente';

CREATE TABLE IF NOT EXISTS public.mercadopago_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider_order_id text,
  provider_payment_id text,
  external_reference text NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('pix', 'boleto', 'credit_card')),
  payment_type text,
  status text NOT NULL DEFAULT 'created',
  status_detail text,
  amount_cents integer NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'EUR', 'USD')),
  qr_code text,
  qr_code_base64 text,
  ticket_url text,
  digitable_line text,
  barcode_content text,
  expires_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  raw_request jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mercadopago_payments_order_created
  ON public.mercadopago_payments (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mercadopago_payments_provider_order
  ON public.mercadopago_payments (provider_order_id);
CREATE INDEX IF NOT EXISTS idx_mercadopago_payments_provider_payment
  ON public.mercadopago_payments (provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_mercadopago_payments_reference
  ON public.mercadopago_payments (external_reference);
CREATE INDEX IF NOT EXISTS idx_mercadopago_payments_status
  ON public.mercadopago_payments (status);

DROP TRIGGER IF EXISTS update_mercadopago_payments_updated_at ON public.mercadopago_payments;
CREATE TRIGGER update_mercadopago_payments_updated_at
  BEFORE UPDATE ON public.mercadopago_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE ON public.mercadopago_payments TO authenticated;
GRANT ALL ON public.mercadopago_payments TO service_role;

ALTER TABLE public.mercadopago_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage Mercado Pago payments" ON public.mercadopago_payments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'configuracoes') OR has_module_access(auth.uid(), 'esteira'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'configuracoes') OR has_module_access(auth.uid(), 'esteira'));

CREATE POLICY "Members view own Mercado Pago payments" ON public.mercadopago_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_id
        AND o.user_id = auth.uid()
    )
  );

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
    WHEN p_payment_method IN ('mercadopago', 'pix', 'boleto', 'credit_card') THEN 'Mercado Pago'
    ELSE 'Caixa fisico'
  END
  LIMIT 1
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
  v_amount integer;
  v_currency text;
  v_amount_brl integer;
  v_source_module text;
  v_payment_method text;
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
  v_amount := COALESCE(v_order.payment_amount_cents, v_order.amount_cents, 0);
  v_currency := COALESCE(v_order.payment_currency, v_order.currency, 'EUR');
  v_amount_brl := CASE WHEN v_currency = 'BRL' THEN v_amount ELSE NULL END;
  v_source_module := COALESCE(v_order.payment_provider, 'orders');
  v_payment_method := COALESCE(v_order.payment_method, v_order.payment_provider);

  IF v_source_module <> 'orders' THEN
    DELETE FROM public.finance_transactions
    WHERE source_module = 'orders'
      AND source_id = v_order.id;
  END IF;

  INSERT INTO public.finance_transactions (
    type, status, description, amount_cents, currency, amount_brl_cents,
    due_date, paid_at, category_id, account_id, payment_method,
    source_module, source_id, is_automatic, notes, created_by
  )
  VALUES (
    'income',
    v_status,
    'Pedido ' || COALESCE(v_order.service_title, v_order.id::text),
    v_amount,
    v_currency,
    v_amount_brl,
    (v_order.created_at AT TIME ZONE 'UTC')::date,
    CASE WHEN v_status = 'received' THEN COALESCE(v_order.paid_at, now()) ELSE NULL END,
    public.finance_category_id('Pedidos/Servicos', 'income'),
    public.finance_account_id_for_payment(v_payment_method),
    v_payment_method,
    v_source_module,
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
    due_date = excluded.due_date,
    paid_at = excluded.paid_at,
    account_id = excluded.account_id,
    payment_method = excluded.payment_method,
    notes = excluded.notes,
    updated_at = now();
END;
$$;

DROP TRIGGER IF EXISTS trg_finance_sync_orders ON public.orders;
CREATE TRIGGER trg_finance_sync_orders
  AFTER INSERT OR UPDATE OF payment_status, amount_cents, currency, payment_provider, payment_method, payment_amount_cents, payment_currency, paid_at
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.finance_sync_order_trigger();

INSERT INTO public.integration_settings (
  provider, is_enabled, environment, default_currency, statement_descriptor,
  pix_enabled, boleto_enabled, card_enabled, pix_expiration_minutes, boleto_expiration_days
)
VALUES ('mercadopago', false, 'test', 'BRL', 'EMPURIA', true, true, false, 30, 3)
ON CONFLICT (provider) DO NOTHING;

INSERT INTO public.finance_accounts (name, type, currency)
VALUES ('Mercado Pago', 'gateway', 'BRL')
ON CONFLICT (name) DO UPDATE SET is_active = true, type = 'gateway', currency = 'BRL';

REVOKE ALL ON FUNCTION public.finance_account_id_for_payment(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_sync_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_account_id_for_payment(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_order(uuid) TO service_role;
