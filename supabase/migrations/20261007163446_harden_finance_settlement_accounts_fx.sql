-- Financeiro 1.1: make automatic account resolution currency-aware and
-- repair historical account/currency mismatches without changing money or status.

CREATE OR REPLACE FUNCTION public.finance_account_id_for_payment(
  p_payment_method text,
  p_currency text
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT CASE
      WHEN lower(trim(p_payment_method)) = 'dinheiro' AND upper(trim(p_currency)) = 'EUR'
        THEN 'dinheiro eur'
      WHEN lower(trim(p_payment_method)) = 'dinheiro' AND upper(trim(p_currency)) = 'BRL'
        THEN 'caixa fisico'
      WHEN lower(trim(p_payment_method)) = 'cartao' AND upper(trim(p_currency)) = 'BRL'
        THEN 'cartao'
      WHEN lower(trim(p_payment_method)) = 'pix' AND upper(trim(p_currency)) = 'BRL'
        THEN 'pix'
      WHEN lower(trim(p_payment_method)) = 'wise' AND upper(trim(p_currency)) = 'EUR'
        THEN 'wise eur'
      WHEN lower(trim(p_payment_method)) = 'transferencia' AND upper(trim(p_currency)) = 'EUR'
        THEN 'wise eur'
      WHEN lower(trim(p_payment_method)) = 'transferencia' AND upper(trim(p_currency)) = 'BRL'
        THEN 'banco'
      WHEN lower(trim(p_payment_method)) IN ('mercadopago', 'boleto', 'credit_card')
        AND upper(trim(p_currency)) = 'BRL'
        THEN 'mercado pago'
      ELSE NULL
    END AS normalized_name,
    upper(trim(p_currency)) AS currency
  ), matches AS (
    SELECT account.id
    FROM target
    JOIN public.finance_accounts account
      ON account.normalized_name = target.normalized_name
     AND account.currency = target.currency
     AND account.is_active = true
    WHERE target.normalized_name IS NOT NULL
  )
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(id))[1] ELSE NULL END
  FROM matches
$function$;

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
  v_account_currency text;
  v_amount_brl integer;
  v_payment_method text;
  v_account_id uuid;
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
  v_account_currency := CASE
    WHEN v_status = 'received' THEN COALESCE(v_order.settled_currency, v_currency)
    ELSE v_currency
  END;
  v_amount_brl := CASE WHEN v_currency = 'BRL' THEN v_amount ELSE NULL END;
  v_payment_method := COALESCE(v_order.payment_method, v_order.payment_provider);

  SELECT account.id INTO v_account_id
  FROM public.finance_accounts account
  WHERE account.id = v_order.payment_account_id
    AND account.is_active = true
    AND account.currency = v_account_currency;
  v_account_id := COALESCE(
    v_account_id,
    public.finance_account_id_for_payment(v_payment_method, v_account_currency)
  );

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
    v_account_id,
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
    public.finance_account_id_for_payment(v_sale.payment_method, v_currency),
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

-- If a transaction already carries a compatible, explicit account, safely
-- propagate it back to the canonical order only when the order has none.
UPDATE public.orders order_row
SET payment_account_id = transaction_row.account_id
FROM public.finance_transactions transaction_row
JOIN public.finance_accounts account ON account.id = transaction_row.account_id
WHERE transaction_row.source_module = 'orders'
  AND transaction_row.source_id = order_row.id
  AND order_row.payment_account_id IS NULL
  AND account.is_active = true
  AND account.currency = COALESCE(
    order_row.settled_currency,
    order_row.payment_currency,
    order_row.currency
  );

-- Repair mismatched automatic order transactions. Prefer a compatible account
-- explicitly stored on the order; otherwise use the safe method+currency map.
UPDATE public.finance_transactions transaction_row
SET account_id = COALESCE(
  (
    SELECT account.id
    FROM public.orders order_row
    JOIN public.finance_accounts account ON account.id = order_row.payment_account_id
    WHERE order_row.id = transaction_row.source_id
      AND account.is_active = true
      AND account.currency = CASE
        WHEN transaction_row.status IN ('received', 'paid')
          THEN COALESCE(transaction_row.settled_currency, transaction_row.currency)
        ELSE transaction_row.currency
      END
  ),
  public.finance_account_id_for_payment(
    transaction_row.payment_method,
    CASE
      WHEN transaction_row.status IN ('received', 'paid')
        THEN COALESCE(transaction_row.settled_currency, transaction_row.currency)
      ELSE transaction_row.currency
    END
  )
)
FROM public.finance_accounts current_account
WHERE transaction_row.source_module = 'orders'
  AND current_account.id = transaction_row.account_id
  AND current_account.currency <> CASE
    WHEN transaction_row.status IN ('received', 'paid')
      THEN COALESCE(transaction_row.settled_currency, transaction_row.currency)
    ELSE transaction_row.currency
  END;

-- Repair PDV account references only. Monetary values, status, paid_at and the
-- original PDV sale remain untouched.
UPDATE public.finance_transactions transaction_row
SET account_id = public.finance_account_id_for_payment(
  transaction_row.payment_method,
  CASE
    WHEN transaction_row.status IN ('received', 'paid')
      THEN COALESCE(transaction_row.settled_currency, transaction_row.currency)
    ELSE transaction_row.currency
  END
)
FROM public.finance_accounts current_account
WHERE transaction_row.source_module = 'pdv'
  AND current_account.id = transaction_row.account_id
  AND current_account.currency <> CASE
    WHEN transaction_row.status IN ('received', 'paid')
      THEN COALESCE(transaction_row.settled_currency, transaction_row.currency)
    ELSE transaction_row.currency
  END;

-- Clear any incompatible account left on the canonical order itself. A safe
-- fallback is used only when method+currency resolve unambiguously.
UPDATE public.orders order_row
SET payment_account_id = public.finance_account_id_for_payment(
  COALESCE(order_row.payment_method, order_row.payment_provider),
  COALESCE(order_row.settled_currency, order_row.payment_currency, order_row.currency)
)
FROM public.finance_accounts current_account
WHERE current_account.id = order_row.payment_account_id
  AND current_account.currency <> COALESCE(
    order_row.settled_currency,
    order_row.payment_currency,
    order_row.currency
  );

DO $validation$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.finance_transactions transaction_row
    JOIN public.finance_accounts account ON account.id = transaction_row.account_id
    WHERE account.currency <> CASE
      WHEN transaction_row.status IN ('received', 'paid')
        THEN COALESCE(transaction_row.settled_currency, transaction_row.currency)
      ELSE transaction_row.currency
    END
  ) THEN
    RAISE EXCEPTION 'Finance account/currency mismatch remains after backfill';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders order_row
    JOIN public.finance_accounts account ON account.id = order_row.payment_account_id
    WHERE account.currency <> COALESCE(
      order_row.settled_currency,
      order_row.payment_currency,
      order_row.currency
    )
  ) THEN
    RAISE EXCEPTION 'Order account/currency mismatch remains after backfill';
  END IF;
END;
$validation$;

DROP FUNCTION public.finance_account_id_for_payment(text);

REVOKE ALL ON FUNCTION public.finance_account_id_for_payment(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_sync_order(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_sync_pdv_sale(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_sync_order_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_sync_pdv_sale_trigger()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finance_account_id_for_payment(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_order(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_pdv_sale(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_order_trigger() TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_pdv_sale_trigger() TO service_role;
