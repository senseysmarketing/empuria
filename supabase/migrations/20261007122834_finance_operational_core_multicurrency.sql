-- Financeiro 1: valor comercial, previsto e realizado; contas multimoeda;
-- pedidos como origem canonica das receitas de servico.

ALTER TABLE public.finance_transactions
  ADD COLUMN IF NOT EXISTS settled_amount_cents integer,
  ADD COLUMN IF NOT EXISTS settled_currency text,
  ADD COLUMN IF NOT EXISTS reference_amount_cents integer,
  ADD COLUMN IF NOT EXISTS reference_currency text,
  ADD COLUMN IF NOT EXISTS fx_reference_rate numeric,
  ADD COLUMN IF NOT EXISTS fx_source text;

ALTER TABLE public.finance_transactions
  ADD CONSTRAINT finance_transactions_settled_amount_cents_check
    CHECK (settled_amount_cents IS NULL OR settled_amount_cents >= 0),
  ADD CONSTRAINT finance_transactions_settled_currency_check
    CHECK (settled_currency IS NULL OR settled_currency IN ('BRL', 'EUR', 'USD')),
  ADD CONSTRAINT finance_transactions_reference_amount_cents_check
    CHECK (reference_amount_cents IS NULL OR reference_amount_cents >= 0),
  ADD CONSTRAINT finance_transactions_reference_currency_check
    CHECK (reference_currency IS NULL OR reference_currency IN ('BRL', 'EUR', 'USD'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS settled_amount_cents integer,
  ADD COLUMN IF NOT EXISTS settled_currency text,
  ADD COLUMN IF NOT EXISTS payment_account_id uuid REFERENCES public.finance_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fx_reference_rate numeric,
  ADD COLUMN IF NOT EXISTS fx_reference_date date;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_settled_amount_cents_check
    CHECK (settled_amount_cents IS NULL OR settled_amount_cents >= 0),
  ADD CONSTRAINT orders_settled_currency_check
    CHECK (settled_currency IS NULL OR settled_currency IN ('BRL', 'EUR', 'USD'));

ALTER TABLE public.finance_accounts
  ADD COLUMN IF NOT EXISTS normalized_name text;

UPDATE public.finance_accounts
SET normalized_name = trim(
  regexp_replace(
    regexp_replace(
      translate(lower(name),
        'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
        'aaaaaaeeeeiiiiooooouuuucnyy'),
      '[^a-z0-9]+', ' ', 'g'),
    '\s+', ' ', 'g'))
WHERE normalized_name IS NULL;

ALTER TABLE public.finance_accounts
  ALTER COLUMN normalized_name SET NOT NULL;

ALTER TABLE public.finance_accounts
  DROP CONSTRAINT IF EXISTS finance_accounts_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS finance_accounts_currency_normalized_name_key
  ON public.finance_accounts (currency, normalized_name);

UPDATE public.orders
SET settled_amount_cents = COALESCE(payment_amount_cents, amount_cents),
    settled_currency = COALESCE(payment_currency, currency),
    fx_reference_rate = COALESCE(fx_reference_rate, fx_rate),
    fx_reference_date = COALESCE(fx_reference_date, paid_at::date, created_at::date)
WHERE payment_status = 'aprovado'
  AND settled_amount_cents IS NULL;

UPDATE public.finance_transactions
SET settled_amount_cents = amount_cents,
    settled_currency = currency
WHERE status IN ('received', 'paid')
  AND settled_amount_cents IS NULL;

UPDATE public.finance_transactions ft
SET reference_amount_cents = o.amount_cents,
    reference_currency = o.currency,
    amount_cents = COALESCE(o.payment_amount_cents, o.amount_cents),
    currency = COALESCE(o.payment_currency, o.currency),
    settled_amount_cents = CASE
      WHEN o.payment_status = 'aprovado'
        THEN COALESCE(o.settled_amount_cents, o.payment_amount_cents, o.amount_cents)
      ELSE NULL
    END,
    settled_currency = CASE
      WHEN o.payment_status = 'aprovado'
        THEN COALESCE(o.settled_currency, o.payment_currency, o.currency)
      ELSE NULL
    END,
    fx_reference_rate = o.fx_reference_rate,
    fx_rate = o.fx_rate,
    fx_source = o.fx_source,
    fx_date = o.fx_reference_date,
    source_module = 'orders',
    updated_at = now()
FROM public.orders o
WHERE ft.source_id = o.id
  AND ft.source_module IN ('orders', 'wise');

UPDATE public.finance_transactions ft
SET settled_amount_cents = CASE WHEN ft.status IN ('received', 'paid') THEN ft.amount_cents ELSE NULL END,
    settled_currency = CASE WHEN ft.status IN ('received', 'paid') THEN ft.currency ELSE NULL END
WHERE ft.source_module = 'pdv';

CREATE OR REPLACE FUNCTION public.finance_sync_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_status text;
  v_amount integer;
  v_currency text;
  v_amount_brl integer;
  v_payment_method text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_status := CASE v_order.payment_status
    WHEN 'aprovado' THEN 'received'
    WHEN 'pendente' THEN 'pending'
    ELSE 'canceled'
  END;
  v_amount := COALESCE(v_order.payment_amount_cents, v_order.amount_cents, 0);
  v_currency := COALESCE(v_order.payment_currency, v_order.currency, 'EUR');
  v_amount_brl := CASE WHEN v_currency = 'BRL' THEN v_amount ELSE NULL END;
  v_payment_method := COALESCE(v_order.payment_method, v_order.payment_provider);

  INSERT INTO public.finance_transactions (
    type, status, description, amount_cents, currency, amount_brl_cents,
    settled_amount_cents, settled_currency, reference_amount_cents, reference_currency,
    fx_reference_rate, fx_rate, fx_source, fx_date,
    due_date, paid_at, category_id, account_id, payment_method,
    source_module, source_id, is_automatic, notes, created_by
  ) VALUES (
    'income', v_status,
    'Pedido ' || COALESCE(v_order.service_title, v_order.id::text),
    v_amount, v_currency, v_amount_brl,
    CASE WHEN v_status = 'received' THEN v_order.settled_amount_cents ELSE NULL END,
    CASE WHEN v_status = 'received' THEN v_order.settled_currency ELSE NULL END,
    v_order.amount_cents, v_order.currency,
    v_order.fx_reference_rate, v_order.fx_rate, v_order.fx_source, v_order.fx_reference_date,
    (v_order.created_at AT TIME ZONE 'UTC')::date,
    CASE WHEN v_status = 'received' THEN v_order.paid_at ELSE NULL END,
    public.finance_category_id('Pedidos/Servicos', 'income'),
    COALESCE(v_order.payment_account_id, public.finance_account_id_for_payment(v_payment_method)),
    v_payment_method, 'orders', v_order.id, true, v_order.notes, v_order.user_id
  )
  ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
    status = excluded.status,
    description = excluded.description,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    amount_brl_cents = excluded.amount_brl_cents,
    settled_amount_cents = excluded.settled_amount_cents,
    settled_currency = excluded.settled_currency,
    reference_amount_cents = excluded.reference_amount_cents,
    reference_currency = excluded.reference_currency,
    fx_reference_rate = excluded.fx_reference_rate,
    fx_rate = excluded.fx_rate,
    fx_source = excluded.fx_source,
    fx_date = excluded.fx_date,
    due_date = excluded.due_date,
    paid_at = excluded.paid_at,
    account_id = excluded.account_id,
    payment_method = excluded.payment_method,
    notes = excluded.notes,
    updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.finance_sync_pdv_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale public.pdv_sales%ROWTYPE;
  v_status text;
  v_amount integer;
  v_currency text;
  v_amount_brl integer;
BEGIN
  SELECT * INTO v_sale FROM public.pdv_sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_status := CASE WHEN v_sale.status = 'cancelada' THEN 'canceled' ELSE 'received' END;
  v_currency := CASE WHEN COALESCE(v_sale.total_brl_cents, 0) > 0 THEN 'BRL' ELSE 'EUR' END;
  v_amount := CASE WHEN v_currency = 'BRL' THEN v_sale.total_brl_cents ELSE v_sale.total_eur_cents END;
  v_amount_brl := CASE WHEN v_currency = 'BRL' THEN v_sale.total_brl_cents ELSE NULL END;

  INSERT INTO public.finance_transactions (
    type, status, description, amount_cents, currency, amount_brl_cents,
    settled_amount_cents, settled_currency,
    due_date, paid_at, category_id, account_id, payment_method,
    source_module, source_id, is_automatic, notes, created_by
  ) VALUES (
    'income', v_status,
    'Venda PDV ' || COALESCE(v_sale.sale_code, v_sale.id::text),
    COALESCE(v_amount, 0), v_currency, v_amount_brl,
    CASE WHEN v_status = 'received' THEN COALESCE(v_amount, 0) ELSE NULL END,
    CASE WHEN v_status = 'received' THEN v_currency ELSE NULL END,
    (v_sale.closed_at AT TIME ZONE 'UTC')::date,
    CASE WHEN v_status = 'received' THEN v_sale.closed_at ELSE NULL END,
    public.finance_category_id('PDV', 'income'),
    public.finance_account_id_for_payment(v_sale.payment_method),
    v_sale.payment_method, 'pdv', v_sale.id, true,
    CASE WHEN v_sale.status = 'cancelada'
      THEN COALESCE(v_sale.void_reason, 'Venda anulada no PDV')
      ELSE v_sale.notes END,
    v_sale.cashier_id
  )
  ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
    status = excluded.status,
    description = excluded.description,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    amount_brl_cents = excluded.amount_brl_cents,
    settled_amount_cents = excluded.settled_amount_cents,
    settled_currency = excluded.settled_currency,
    due_date = excluded.due_date,
    paid_at = excluded.paid_at,
    account_id = excluded.account_id,
    payment_method = excluded.payment_method,
    notes = excluded.notes,
    updated_at = now();
END;
$function$;

DROP TRIGGER IF EXISTS trg_finance_sync_orders ON public.orders;
CREATE TRIGGER trg_finance_sync_orders
  AFTER INSERT OR UPDATE OF
    payment_status, amount_cents, currency, payment_method,
    payment_amount_cents, payment_currency, settled_amount_cents,
    settled_currency, payment_account_id, paid_at, fx_reference_rate,
    fx_reference_date, fx_rate, fx_source
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.finance_sync_order_trigger();

DO $backfill$
DECLARE v_order_id uuid;
BEGIN
  FOR v_order_id IN SELECT id FROM public.orders LOOP
    PERFORM public.finance_sync_order(v_order_id);
  END LOOP;
END;
$backfill$;

REVOKE ALL ON FUNCTION public.finance_sync_order(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_sync_pdv_sale(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_sync_order_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_sync_pdv_sale_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_sync_order(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_pdv_sale(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_order_trigger() TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_pdv_sale_trigger() TO service_role;
