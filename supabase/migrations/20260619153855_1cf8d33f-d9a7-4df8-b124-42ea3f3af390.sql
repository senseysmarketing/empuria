
-- 1) Permitir novos status / métodos
ALTER TABLE public.pdv_tabs DROP CONSTRAINT IF EXISTS pdv_tabs_status_check;
ALTER TABLE public.pdv_tabs ADD CONSTRAINT pdv_tabs_status_check
  CHECK (status IN ('aberta','fechada','cancelada','aguardando_pagamento'));

ALTER TABLE public.pdv_sales DROP CONSTRAINT IF EXISTS pdv_sales_payment_method_check;
ALTER TABLE public.pdv_sales ADD CONSTRAINT pdv_sales_payment_method_check
  CHECK (payment_method IN ('dinheiro','cartao','pix','transferencia','wise'));

-- Colunas auxiliares na comanda para o fluxo aguardando pagamento
ALTER TABLE public.pdv_tabs
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS awaiting_payment_at timestamptz,
  ADD COLUMN IF NOT EXISTS active_payment_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS pending_sale_snapshot jsonb;

-- 2) Tabela de tentativas de cobrança
CREATE TABLE IF NOT EXISTS public.pdv_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id uuid NOT NULL REFERENCES public.pdv_tabs(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES public.pdv_sales(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'wise' CHECK (provider IN ('wise')),
  reference text NOT NULL UNIQUE,
  attempt_index integer NOT NULL DEFAULT 1,
  amount_eur_cents integer NOT NULL,
  amount_brl_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  discount_type text NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','amount','percent')),
  discount_value numeric(12,2) NOT NULL DEFAULT 0,
  discount_eur_cents integer NOT NULL DEFAULT 0,
  discount_brl_cents integer NOT NULL DEFAULT 0,
  subtotal_eur_cents integer NOT NULL DEFAULT 0,
  subtotal_brl_cents integer NOT NULL DEFAULT 0,
  payment_url text,
  status text NOT NULL DEFAULT 'waiting_payment'
    CHECK (status IN ('waiting_payment','paid','cancelled','expired','pending_conciliation','failed')),
  notes text,
  customer_phone_snapshot text,
  customer_name_snapshot text,
  raw_request jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_webhook jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text
);

CREATE INDEX IF NOT EXISTS idx_pdv_payment_attempts_tab ON public.pdv_payment_attempts(tab_id);
CREATE INDEX IF NOT EXISTS idx_pdv_payment_attempts_status ON public.pdv_payment_attempts(status);

GRANT SELECT, INSERT, UPDATE ON public.pdv_payment_attempts TO authenticated;
GRANT ALL ON public.pdv_payment_attempts TO service_role;

ALTER TABLE public.pdv_payment_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdv_payment_attempts_staff_read" ON public.pdv_payment_attempts;
CREATE POLICY "pdv_payment_attempts_staff_read" ON public.pdv_payment_attempts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'pdv'));

DROP POLICY IF EXISTS "pdv_payment_attempts_staff_write" ON public.pdv_payment_attempts;
CREATE POLICY "pdv_payment_attempts_staff_write" ON public.pdv_payment_attempts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'pdv'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'pdv'));

DROP TRIGGER IF EXISTS trg_pdv_payment_attempts_updated_at ON public.pdv_payment_attempts;
CREATE TRIGGER trg_pdv_payment_attempts_updated_at
  BEFORE UPDATE ON public.pdv_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) finance_account_id_for_payment: aceitar transferencia bancaria
CREATE OR REPLACE FUNCTION public.finance_account_id_for_payment(p_payment_method text)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT id FROM public.finance_accounts
  WHERE name = CASE
    WHEN p_payment_method = 'dinheiro' THEN 'Dinheiro EUR'
    WHEN p_payment_method = 'cartao' THEN 'Cartao'
    WHEN p_payment_method = 'pix' THEN 'Pix'
    WHEN p_payment_method = 'wise' THEN 'Wise EUR'
    WHEN p_payment_method = 'transferencia' THEN 'Wise EUR'
    WHEN p_payment_method IN ('mercadopago','boleto','credit_card') THEN 'Mercado Pago'
    ELSE 'Caixa fisico'
  END
  LIMIT 1
$$;

-- 4) Ajuste pdv_close_tab para aceitar dinheiro/transferencia (Wise vai por outro fluxo)
CREATE OR REPLACE FUNCTION public.pdv_close_tab(p_tab_id uuid, p_cashier_id uuid, p_discount_type text, p_discount_value numeric, p_payment_method text, p_notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_tab public.pdv_tabs%ROWTYPE;
  v_item public.pdv_tab_items%ROWTYPE;
  v_product record;
  v_sale_id uuid;
  v_sale_code text;
  v_subtotal_eur integer := 0;
  v_subtotal_brl integer := 0;
  v_discount_eur integer := 0;
  v_discount_brl integer := 0;
  v_total_eur integer;
  v_total_brl integer;
  v_sale_item_count integer := 0;
  v_new_stock integer;
  v_new_reserved integer;
BEGIN
  IF NOT public.has_role(p_cashier_id, 'admin') AND NOT public.has_module_access(p_cashier_id, 'pdv') THEN RAISE EXCEPTION 'Sem permissao para fechar comandas'; END IF;
  IF p_payment_method NOT IN ('dinheiro','transferencia') THEN RAISE EXCEPTION 'Forma de pagamento invalida para fechamento direto. Use o fluxo Wise para cobrancas.'; END IF;
  IF p_discount_type NOT IN ('none','amount','percent') THEN RAISE EXCEPTION 'Tipo de desconto invalido'; END IF;

  SELECT * INTO v_tab FROM public.pdv_tabs WHERE id = p_tab_id FOR UPDATE;
  IF NOT FOUND OR v_tab.status <> 'aberta' THEN RAISE EXCEPTION 'Comanda nao esta aberta'; END IF;

  SELECT coalesce(sum(total_eur_cents), 0), coalesce(sum(total_brl_cents), 0), count(*) INTO v_subtotal_eur, v_subtotal_brl, v_sale_item_count FROM public.pdv_tab_items WHERE tab_id = p_tab_id AND cancelled_at IS NULL;
  IF v_sale_item_count = 0 THEN RAISE EXCEPTION 'Comanda sem itens ativos'; END IF;

  IF p_discount_type = 'amount' THEN
    v_discount_eur := LEAST((p_discount_value * 100)::integer, v_subtotal_eur);
    v_discount_brl := LEAST((p_discount_value * 100)::integer, v_subtotal_brl);
  ELSIF p_discount_type = 'percent' THEN
    v_discount_eur := FLOOR(v_subtotal_eur * LEAST(GREATEST(p_discount_value,0),100) / 100.0)::integer;
    v_discount_brl := FLOOR(v_subtotal_brl * LEAST(GREATEST(p_discount_value,0),100) / 100.0)::integer;
  END IF;

  v_total_eur := GREATEST(v_subtotal_eur - v_discount_eur, 0);
  v_total_brl := GREATEST(v_subtotal_brl - v_discount_brl, 0);
  v_sale_code := public.pdv_next_sale_code(now());

  INSERT INTO public.pdv_sales(sale_code, customer_id, cashier_id, subtotal_eur_cents, subtotal_brl_cents, discount_type, discount_value, discount_eur_cents, discount_brl_cents, total_eur_cents, total_brl_cents, payment_method, notes)
  VALUES (v_sale_code, v_tab.customer_id, p_cashier_id, v_subtotal_eur, v_subtotal_brl, p_discount_type, p_discount_value, v_discount_eur, v_discount_brl, v_total_eur, v_total_brl, p_payment_method, concat_ws(E'\n', NULLIF(trim(coalesce(p_notes, '')), ''), 'Comanda ' || v_tab.tab_code))
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM public.pdv_tab_items WHERE tab_id = p_tab_id AND cancelled_at IS NULL ORDER BY created_at FOR UPDATE LOOP
    INSERT INTO public.pdv_sale_items(sale_id, product_id, product_name_snapshot, product_emoji_snapshot, qty, unit_price_eur_cents, unit_price_brl_cents, total_eur_cents, total_brl_cents)
    VALUES (v_sale_id, v_item.product_id, v_item.product_name_snapshot, v_item.product_emoji_snapshot, v_item.qty, v_item.unit_price_eur_cents, v_item.unit_price_brl_cents, v_item.total_eur_cents, v_item.total_brl_cents);

    IF v_item.product_id IS NOT NULL THEN
      SELECT id, stock_quantity, reserved_stock_quantity, track_stock INTO v_product FROM public.products WHERE id = v_item.product_id FOR UPDATE;
      IF FOUND AND v_product.track_stock THEN
        IF v_product.reserved_stock_quantity < v_item.qty THEN RAISE EXCEPTION 'Reserva de estoque inconsistente para %', v_item.product_name_snapshot; END IF;
        v_new_stock := v_product.stock_quantity - v_item.qty;
        v_new_reserved := v_product.reserved_stock_quantity - v_item.qty;
        UPDATE public.products SET stock_quantity = v_new_stock, reserved_stock_quantity = v_new_reserved, updated_at = now() WHERE id = v_product.id;
        INSERT INTO public.product_stock_movements(product_id, type, quantity, previous_stock, new_stock, reason, sale_id, tab_id, tab_item_id, created_by)
        VALUES (v_product.id, 'venda_comanda', v_item.qty, v_product.stock_quantity, v_new_stock, 'Fechamento comanda ' || v_tab.tab_code || ' / venda ' || v_sale_code, v_sale_id, v_tab.id, v_item.id, p_cashier_id);
      END IF;
    END IF;
  END LOOP;

  UPDATE public.pdv_tabs SET status = 'fechada', closed_by = p_cashier_id, sale_id = v_sale_id, subtotal_eur_cents = v_subtotal_eur, subtotal_brl_cents = v_subtotal_brl, discount_type = p_discount_type, discount_value = p_discount_value, discount_eur_cents = v_discount_eur, discount_brl_cents = v_discount_brl, total_eur_cents = v_total_eur, total_brl_cents = v_total_brl, payment_method = p_payment_method, closed_at = now() WHERE id = p_tab_id;
  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (p_cashier_id, 'pdv_tab.closed', 'pdv', 'pdv_tab', p_tab_id, jsonb_build_object('sale_id', v_sale_id, 'sale_code', v_sale_code, 'total_brl_cents', v_total_brl, 'payment_method', p_payment_method));

  RETURN v_sale_id;
END;
$function$;

-- 5) Solicitar cobrança Wise
CREATE OR REPLACE FUNCTION public.pdv_request_wise_payment(
  p_tab_id uuid,
  p_actor_id uuid,
  p_discount_type text,
  p_discount_value numeric,
  p_payment_url text,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tab public.pdv_tabs%ROWTYPE;
  v_subtotal_eur integer := 0;
  v_subtotal_brl integer := 0;
  v_items integer := 0;
  v_discount_eur integer := 0;
  v_discount_brl integer := 0;
  v_total_eur integer;
  v_total_brl integer;
  v_attempt_id uuid;
  v_attempt_index integer := 1;
  v_reference text;
  v_short_code text;
  v_customer record;
BEGIN
  IF NOT public.has_role(p_actor_id, 'admin') AND NOT public.has_module_access(p_actor_id, 'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para emitir cobranca Wise';
  END IF;
  IF p_discount_type NOT IN ('none','amount','percent') THEN
    RAISE EXCEPTION 'Tipo de desconto invalido';
  END IF;

  SELECT * INTO v_tab FROM public.pdv_tabs WHERE id = p_tab_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda nao encontrada'; END IF;
  IF v_tab.status <> 'aberta' THEN RAISE EXCEPTION 'Comanda precisa estar aberta para gerar cobranca'; END IF;

  SELECT coalesce(sum(total_eur_cents),0), coalesce(sum(total_brl_cents),0), count(*)
    INTO v_subtotal_eur, v_subtotal_brl, v_items
  FROM public.pdv_tab_items WHERE tab_id = p_tab_id AND cancelled_at IS NULL;
  IF v_items = 0 THEN RAISE EXCEPTION 'Comanda sem itens ativos'; END IF;

  IF p_discount_type = 'amount' THEN
    v_discount_eur := LEAST((p_discount_value * 100)::integer, v_subtotal_eur);
    v_discount_brl := LEAST((p_discount_value * 100)::integer, v_subtotal_brl);
  ELSIF p_discount_type = 'percent' THEN
    v_discount_eur := FLOOR(v_subtotal_eur * LEAST(GREATEST(p_discount_value,0),100) / 100.0)::integer;
    v_discount_brl := FLOOR(v_subtotal_brl * LEAST(GREATEST(p_discount_value,0),100) / 100.0)::integer;
  END IF;

  v_total_eur := GREATEST(v_subtotal_eur - v_discount_eur, 0);
  v_total_brl := GREATEST(v_subtotal_brl - v_discount_brl, 0);
  IF v_total_eur <= 0 THEN RAISE EXCEPTION 'Total da cobranca invalido'; END IF;

  SELECT coalesce(max(attempt_index),0) + 1 INTO v_attempt_index
    FROM public.pdv_payment_attempts WHERE tab_id = p_tab_id;

  v_short_code := upper(regexp_replace(v_tab.tab_code, '[^A-Z0-9]', '', 'g'));
  v_short_code := right(v_short_code, 10);
  v_reference := 'PDV-' || v_short_code || '-A' || v_attempt_index::text;

  SELECT full_name, phone INTO v_customer FROM public.profiles WHERE id = v_tab.customer_id;

  INSERT INTO public.pdv_payment_attempts(
    tab_id, provider, reference, attempt_index,
    amount_eur_cents, amount_brl_cents, currency,
    discount_type, discount_value, discount_eur_cents, discount_brl_cents,
    subtotal_eur_cents, subtotal_brl_cents,
    payment_url, status, notes,
    customer_phone_snapshot, customer_name_snapshot,
    raw_request, created_by
  )
  VALUES (
    p_tab_id, 'wise', v_reference, v_attempt_index,
    v_total_eur, v_total_brl, 'EUR',
    p_discount_type, p_discount_value, v_discount_eur, v_discount_brl,
    v_subtotal_eur, v_subtotal_brl,
    p_payment_url, 'waiting_payment', NULLIF(trim(coalesce(p_notes,'')), ''),
    v_customer.phone, v_customer.full_name,
    jsonb_build_object('total_eur_cents', v_total_eur, 'tab_code', v_tab.tab_code),
    p_actor_id
  )
  RETURNING id INTO v_attempt_id;

  UPDATE public.pdv_tabs SET
    status = 'aguardando_pagamento',
    payment_method = 'wise',
    awaiting_payment_at = now(),
    active_payment_attempt_id = v_attempt_id,
    pending_sale_snapshot = jsonb_build_object(
      'subtotal_eur_cents', v_subtotal_eur,
      'subtotal_brl_cents', v_subtotal_brl,
      'discount_type', p_discount_type,
      'discount_value', p_discount_value,
      'discount_eur_cents', v_discount_eur,
      'discount_brl_cents', v_discount_brl,
      'total_eur_cents', v_total_eur,
      'total_brl_cents', v_total_brl,
      'notes', NULLIF(trim(coalesce(p_notes,'')), '')
    ),
    subtotal_eur_cents = v_subtotal_eur,
    subtotal_brl_cents = v_subtotal_brl,
    discount_type = p_discount_type,
    discount_value = p_discount_value,
    discount_eur_cents = v_discount_eur,
    discount_brl_cents = v_discount_brl,
    total_eur_cents = v_total_eur,
    total_brl_cents = v_total_brl
  WHERE id = p_tab_id;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (p_actor_id, 'pdv_tab.wise_requested', 'pdv', 'pdv_payment_attempt', v_attempt_id,
          jsonb_build_object('tab_id', p_tab_id, 'reference', v_reference, 'amount_eur_cents', v_total_eur));

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'reference', v_reference,
    'amount_eur_cents', v_total_eur,
    'amount_brl_cents', v_total_brl,
    'payment_url', p_payment_url,
    'customer_phone', v_customer.phone,
    'customer_name', v_customer.full_name
  );
END;
$$;

-- 6) Cancelar / reabrir cobrança
CREATE OR REPLACE FUNCTION public.pdv_cancel_wise_attempt(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_attempt public.pdv_payment_attempts%ROWTYPE;
  v_tab public.pdv_tabs%ROWTYPE;
  v_reason text := NULLIF(trim(coalesce(p_reason,'')), '');
BEGIN
  IF NOT public.has_role(p_actor_id, 'admin') AND NOT public.has_module_access(p_actor_id, 'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para cancelar cobranca';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento';
  END IF;

  SELECT * INTO v_attempt FROM public.pdv_payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tentativa nao encontrada'; END IF;
  IF v_attempt.status <> 'waiting_payment' THEN RAISE EXCEPTION 'Tentativa nao esta aguardando pagamento'; END IF;

  SELECT * INTO v_tab FROM public.pdv_tabs WHERE id = v_attempt.tab_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda nao encontrada'; END IF;

  UPDATE public.pdv_payment_attempts SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = p_actor_id,
    cancel_reason = v_reason
  WHERE id = p_attempt_id;

  IF v_tab.status = 'aguardando_pagamento' AND v_tab.active_payment_attempt_id = p_attempt_id THEN
    UPDATE public.pdv_tabs SET
      status = 'aberta',
      payment_method = NULL,
      awaiting_payment_at = NULL,
      active_payment_attempt_id = NULL,
      pending_sale_snapshot = NULL
    WHERE id = v_tab.id;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (p_actor_id, 'pdv_tab.wise_cancelled', 'pdv', 'pdv_payment_attempt', p_attempt_id,
          jsonb_build_object('tab_id', v_attempt.tab_id, 'reason', v_reason));
END;
$$;

-- 7) Confirmar pagamento (chamado pelo webhook)
CREATE OR REPLACE FUNCTION public.pdv_confirm_wise_payment(
  p_reference text,
  p_amount_cents integer,
  p_currency text,
  p_raw jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_attempt public.pdv_payment_attempts%ROWTYPE;
  v_tab public.pdv_tabs%ROWTYPE;
  v_item public.pdv_tab_items%ROWTYPE;
  v_product record;
  v_sale_id uuid;
  v_sale_code text;
  v_new_stock integer;
  v_new_reserved integer;
BEGIN
  SELECT * INTO v_attempt FROM public.pdv_payment_attempts
   WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'attempt_not_found');
  END IF;

  IF v_attempt.status = 'paid' THEN
    RETURN jsonb_build_object('matched', true, 'duplicate', true, 'attempt_id', v_attempt.id);
  END IF;

  IF v_attempt.status <> 'waiting_payment' THEN
    UPDATE public.pdv_payment_attempts SET status = 'pending_conciliation', raw_webhook = p_raw
      WHERE id = v_attempt.id;
    RETURN jsonb_build_object('matched', false, 'reason', 'attempt_not_waiting', 'status', v_attempt.status);
  END IF;

  IF p_currency IS NOT NULL AND upper(p_currency) <> 'EUR' THEN
    UPDATE public.pdv_payment_attempts SET status = 'pending_conciliation', raw_webhook = p_raw
      WHERE id = v_attempt.id;
    RETURN jsonb_build_object('matched', false, 'reason', 'currency_mismatch');
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <> v_attempt.amount_eur_cents THEN
    UPDATE public.pdv_payment_attempts SET status = 'pending_conciliation', raw_webhook = p_raw
      WHERE id = v_attempt.id;
    RETURN jsonb_build_object('matched', false, 'reason', 'amount_mismatch',
                              'expected', v_attempt.amount_eur_cents, 'received', p_amount_cents);
  END IF;

  SELECT * INTO v_tab FROM public.pdv_tabs WHERE id = v_attempt.tab_id FOR UPDATE;
  IF NOT FOUND OR v_tab.status <> 'aguardando_pagamento' THEN
    UPDATE public.pdv_payment_attempts SET status = 'pending_conciliation', raw_webhook = p_raw
      WHERE id = v_attempt.id;
    RETURN jsonb_build_object('matched', false, 'reason', 'tab_not_awaiting');
  END IF;

  v_sale_code := public.pdv_next_sale_code(now());

  INSERT INTO public.pdv_sales(
    sale_code, customer_id, cashier_id,
    subtotal_eur_cents, subtotal_brl_cents,
    discount_type, discount_value, discount_eur_cents, discount_brl_cents,
    total_eur_cents, total_brl_cents,
    payment_method, notes
  ) VALUES (
    v_sale_code, v_tab.customer_id, v_attempt.created_by,
    v_attempt.subtotal_eur_cents, v_attempt.subtotal_brl_cents,
    v_attempt.discount_type, v_attempt.discount_value, v_attempt.discount_eur_cents, v_attempt.discount_brl_cents,
    v_attempt.amount_eur_cents, v_attempt.amount_brl_cents,
    'wise',
    concat_ws(E'\n', NULLIF(v_attempt.notes,''), 'Comanda ' || v_tab.tab_code, 'Wise ref ' || v_attempt.reference)
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM public.pdv_tab_items WHERE tab_id = v_tab.id AND cancelled_at IS NULL ORDER BY created_at FOR UPDATE LOOP
    INSERT INTO public.pdv_sale_items(sale_id, product_id, product_name_snapshot, product_emoji_snapshot, qty, unit_price_eur_cents, unit_price_brl_cents, total_eur_cents, total_brl_cents)
    VALUES (v_sale_id, v_item.product_id, v_item.product_name_snapshot, v_item.product_emoji_snapshot, v_item.qty, v_item.unit_price_eur_cents, v_item.unit_price_brl_cents, v_item.total_eur_cents, v_item.total_brl_cents);

    IF v_item.product_id IS NOT NULL THEN
      SELECT id, stock_quantity, reserved_stock_quantity, track_stock INTO v_product FROM public.products WHERE id = v_item.product_id FOR UPDATE;
      IF FOUND AND v_product.track_stock THEN
        IF v_product.reserved_stock_quantity < v_item.qty THEN RAISE EXCEPTION 'Reserva inconsistente para %', v_item.product_name_snapshot; END IF;
        v_new_stock := v_product.stock_quantity - v_item.qty;
        v_new_reserved := v_product.reserved_stock_quantity - v_item.qty;
        UPDATE public.products SET stock_quantity = v_new_stock, reserved_stock_quantity = v_new_reserved, updated_at = now() WHERE id = v_product.id;
        INSERT INTO public.product_stock_movements(product_id, type, quantity, previous_stock, new_stock, reason, sale_id, tab_id, tab_item_id, created_by)
        VALUES (v_product.id, 'venda_comanda', v_item.qty, v_product.stock_quantity, v_new_stock, 'Wise ' || v_attempt.reference || ' / venda ' || v_sale_code, v_sale_id, v_tab.id, v_item.id, v_attempt.created_by);
      END IF;
    END IF;
  END LOOP;

  UPDATE public.pdv_tabs SET
    status = 'fechada',
    closed_by = v_attempt.created_by,
    sale_id = v_sale_id,
    payment_method = 'wise',
    closed_at = now(),
    active_payment_attempt_id = NULL,
    awaiting_payment_at = NULL,
    pending_sale_snapshot = NULL
  WHERE id = v_tab.id;

  UPDATE public.pdv_payment_attempts SET
    status = 'paid',
    paid_at = now(),
    raw_webhook = p_raw,
    sale_id = v_sale_id
  WHERE id = v_attempt.id;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_attempt.created_by, 'pdv_tab.wise_paid', 'pdv', 'pdv_payment_attempt', v_attempt.id,
          jsonb_build_object('sale_id', v_sale_id, 'sale_code', v_sale_code, 'reference', v_attempt.reference, 'total_eur_cents', v_attempt.amount_eur_cents));

  RETURN jsonb_build_object('matched', true, 'sale_id', v_sale_id, 'attempt_id', v_attempt.id);
END;
$$;
