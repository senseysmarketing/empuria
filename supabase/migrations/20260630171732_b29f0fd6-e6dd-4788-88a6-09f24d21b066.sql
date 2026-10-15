
-- 1. Add snapshot columns
ALTER TABLE public.pdv_sales
  ADD COLUMN IF NOT EXISTS customer_name_snapshot text,
  ADD COLUMN IF NOT EXISTS customer_phone_snapshot text;

ALTER TABLE public.pdv_tabs
  ADD COLUMN IF NOT EXISTS customer_name_snapshot text,
  ADD COLUMN IF NOT EXISTS customer_phone_snapshot text;

-- 2. Backfill from current profiles
UPDATE public.pdv_sales s
SET customer_name_snapshot = COALESCE(s.customer_name_snapshot, p.full_name),
    customer_phone_snapshot = COALESCE(s.customer_phone_snapshot, p.phone)
FROM public.profiles p
WHERE p.id = s.customer_id AND (s.customer_name_snapshot IS NULL OR s.customer_phone_snapshot IS NULL);

UPDATE public.pdv_tabs t
SET customer_name_snapshot = COALESCE(t.customer_name_snapshot, p.full_name),
    customer_phone_snapshot = COALESCE(t.customer_phone_snapshot, p.phone)
FROM public.profiles p
WHERE p.id = t.customer_id AND (t.customer_name_snapshot IS NULL OR t.customer_phone_snapshot IS NULL);

-- 3. Update pdv_open_tab to snapshot customer
CREATE OR REPLACE FUNCTION public.pdv_open_tab(p_customer_id uuid, p_opened_by uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tab public.pdv_tabs%ROWTYPE;
  v_profile record;
BEGIN
  IF NOT public.has_role(p_opened_by, 'admin') AND NOT public.has_module_access(p_opened_by, 'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para abrir comandas';
  END IF;

  SELECT id, full_name, phone INTO v_profile FROM public.profiles WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente nao encontrado';
  END IF;

  INSERT INTO public.pdv_tabs(tab_code, customer_id, opened_by, notes, customer_name_snapshot, customer_phone_snapshot)
  VALUES (public.pdv_next_tab_code(now()), p_customer_id, p_opened_by, NULLIF(trim(coalesce(p_notes, '')), ''), v_profile.full_name, v_profile.phone)
  RETURNING * INTO v_tab;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (p_opened_by, 'pdv_tab.opened', 'pdv', 'pdv_tab', v_tab.id,
          jsonb_build_object('tab_code', v_tab.tab_code, 'customer_id', p_customer_id));

  RETURN jsonb_build_object('tab_id', v_tab.id, 'tab_code', v_tab.tab_code, 'existing', false);
END;
$function$;

-- 4. Update pdv_close_sale (direct sale) to snapshot
CREATE OR REPLACE FUNCTION public.pdv_close_sale(p_customer_id uuid, p_cashier_id uuid, p_items jsonb, p_discount_type text, p_discount_value numeric, p_payment_method text, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id uuid; v_sale_code text; v_item jsonb; v_product record; v_qty integer; v_subtotal_eur integer := 0; v_subtotal_brl integer := 0; v_discount_eur integer := 0; v_discount_brl integer := 0; v_total_eur integer; v_total_brl integer; v_new_stock integer; v_available integer;
  v_cust record;
BEGIN
  IF p_payment_method NOT IN ('dinheiro','cartao','pix') THEN RAISE EXCEPTION 'Forma de pagamento invalida'; END IF;
  IF p_discount_type NOT IN ('none','amount','percent') THEN RAISE EXCEPTION 'Tipo de desconto invalido'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Venda sem itens'; END IF;
  SELECT id, full_name, phone INTO v_cust FROM public.profiles WHERE id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente nao encontrado'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::integer;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Quantidade invalida'; END IF;
    SELECT id, name, emoji, price_eur_cents, price_brl_cents, stock_quantity, reserved_stock_quantity, track_stock, is_active INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid FOR UPDATE;
    IF NOT FOUND OR NOT v_product.is_active THEN RAISE EXCEPTION 'Item indisponivel'; END IF;
    v_available := v_product.stock_quantity - v_product.reserved_stock_quantity;
    IF v_product.track_stock AND v_available < v_qty THEN RAISE EXCEPTION 'Estoque disponivel insuficiente para %', v_product.name; END IF;
    v_subtotal_eur := v_subtotal_eur + v_product.price_eur_cents * v_qty;
    v_subtotal_brl := v_subtotal_brl + v_product.price_brl_cents * v_qty;
  END LOOP;

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

  INSERT INTO public.pdv_sales(sale_code, customer_id, cashier_id, subtotal_eur_cents, subtotal_brl_cents, discount_type, discount_value, discount_eur_cents, discount_brl_cents, total_eur_cents, total_brl_cents, payment_method, notes, customer_name_snapshot, customer_phone_snapshot)
  VALUES (v_sale_code, p_customer_id, p_cashier_id, v_subtotal_eur, v_subtotal_brl, p_discount_type, p_discount_value, v_discount_eur, v_discount_brl, v_total_eur, v_total_brl, p_payment_method, p_notes, v_cust.full_name, v_cust.phone)
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::integer;
    SELECT id, name, emoji, price_eur_cents, price_brl_cents, stock_quantity, track_stock INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid FOR UPDATE;
    INSERT INTO public.pdv_sale_items(sale_id, product_id, product_name_snapshot, product_emoji_snapshot, qty, unit_price_eur_cents, unit_price_brl_cents, total_eur_cents, total_brl_cents)
    VALUES (v_sale_id, v_product.id, v_product.name, v_product.emoji, v_qty, v_product.price_eur_cents, v_product.price_brl_cents, v_product.price_eur_cents * v_qty, v_product.price_brl_cents * v_qty);
    IF v_product.track_stock THEN
      v_new_stock := v_product.stock_quantity - v_qty;
      UPDATE public.products SET stock_quantity = v_new_stock, updated_at = now() WHERE id = v_product.id;
      INSERT INTO public.product_stock_movements(product_id, type, quantity, previous_stock, new_stock, reason, sale_id, created_by)
      VALUES (v_product.id, 'venda', v_qty, v_product.stock_quantity, v_new_stock, 'Venda PDV ' || v_sale_code, v_sale_id, p_cashier_id);
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (p_cashier_id, 'venda_fechada', 'pdv', 'pdv_sale', v_sale_id, jsonb_build_object('sale_code', v_sale_code, 'total_eur_cents', v_total_eur, 'payment_method', p_payment_method, 'customer_id', p_customer_id));
  RETURN v_sale_id;
END;
$function$;

-- 5. Update pdv_close_tab to copy snapshot from tab
CREATE OR REPLACE FUNCTION public.pdv_close_tab(p_tab_id uuid, p_cashier_id uuid, p_discount_type text, p_discount_value numeric, p_payment_method text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tab public.pdv_tabs%ROWTYPE; v_item public.pdv_tab_items%ROWTYPE; v_product record;
  v_sale_id uuid; v_sale_code text;
  v_subtotal_eur integer := 0; v_subtotal_brl integer := 0;
  v_discount_eur integer := 0; v_discount_brl integer := 0;
  v_total_eur integer; v_total_brl integer;
  v_sale_item_count integer := 0; v_new_stock integer; v_new_reserved integer;
  v_cust_name text; v_cust_phone text;
BEGIN
  IF NOT public.has_role(p_cashier_id, 'admin') AND NOT public.has_module_access(p_cashier_id, 'pdv') THEN RAISE EXCEPTION 'Sem permissao para fechar comandas'; END IF;
  IF p_payment_method NOT IN ('dinheiro','transferencia') THEN RAISE EXCEPTION 'Forma de pagamento invalida para fechamento direto. Use o fluxo Wise para cobrancas.'; END IF;
  IF p_discount_type NOT IN ('none','amount','percent') THEN RAISE EXCEPTION 'Tipo de desconto invalido'; END IF;

  SELECT * INTO v_tab FROM public.pdv_tabs WHERE id = p_tab_id FOR UPDATE;
  IF NOT FOUND OR v_tab.status <> 'aberta' THEN RAISE EXCEPTION 'Comanda nao esta aberta'; END IF;

  SELECT coalesce(sum(total_eur_cents),0), coalesce(sum(total_brl_cents),0), count(*) INTO v_subtotal_eur, v_subtotal_brl, v_sale_item_count FROM public.pdv_tab_items WHERE tab_id = p_tab_id AND cancelled_at IS NULL;
  IF v_sale_item_count = 0 THEN RAISE EXCEPTION 'Comanda sem itens ativos'; END IF;

  IF p_discount_type = 'amount' THEN
    v_discount_eur := LEAST((p_discount_value*100)::integer, v_subtotal_eur);
    v_discount_brl := LEAST((p_discount_value*100)::integer, v_subtotal_brl);
  ELSIF p_discount_type = 'percent' THEN
    v_discount_eur := FLOOR(v_subtotal_eur * LEAST(GREATEST(p_discount_value,0),100)/100.0)::integer;
    v_discount_brl := FLOOR(v_subtotal_brl * LEAST(GREATEST(p_discount_value,0),100)/100.0)::integer;
  END IF;

  v_total_eur := GREATEST(v_subtotal_eur - v_discount_eur, 0);
  v_total_brl := GREATEST(v_subtotal_brl - v_discount_brl, 0);
  v_sale_code := public.pdv_next_sale_code(now());

  v_cust_name := v_tab.customer_name_snapshot;
  v_cust_phone := v_tab.customer_phone_snapshot;
  IF v_cust_name IS NULL OR v_cust_phone IS NULL THEN
    SELECT COALESCE(v_cust_name, full_name), COALESCE(v_cust_phone, phone) INTO v_cust_name, v_cust_phone FROM public.profiles WHERE id = v_tab.customer_id;
  END IF;

  INSERT INTO public.pdv_sales(sale_code, customer_id, cashier_id, subtotal_eur_cents, subtotal_brl_cents, discount_type, discount_value, discount_eur_cents, discount_brl_cents, total_eur_cents, total_brl_cents, payment_method, notes, customer_name_snapshot, customer_phone_snapshot)
  VALUES (v_sale_code, v_tab.customer_id, p_cashier_id, v_subtotal_eur, v_subtotal_brl, p_discount_type, p_discount_value, v_discount_eur, v_discount_brl, v_total_eur, v_total_brl, p_payment_method, concat_ws(E'\n', NULLIF(trim(coalesce(p_notes,'')),''), 'Comanda ' || v_tab.tab_code), v_cust_name, v_cust_phone)
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

  UPDATE public.pdv_tabs SET status='fechada', closed_by=p_cashier_id, sale_id=v_sale_id, subtotal_eur_cents=v_subtotal_eur, subtotal_brl_cents=v_subtotal_brl, discount_type=p_discount_type, discount_value=p_discount_value, discount_eur_cents=v_discount_eur, discount_brl_cents=v_discount_brl, total_eur_cents=v_total_eur, total_brl_cents=v_total_brl, payment_method=p_payment_method, closed_at=now() WHERE id = p_tab_id;
  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (p_cashier_id, 'pdv_tab.closed', 'pdv', 'pdv_tab', p_tab_id, jsonb_build_object('sale_id', v_sale_id, 'sale_code', v_sale_code, 'total_brl_cents', v_total_brl, 'payment_method', p_payment_method));

  RETURN v_sale_id;
END;
$function$;

-- 6. Update pdv_confirm_wise_payment to copy snapshot
CREATE OR REPLACE FUNCTION public.pdv_confirm_wise_payment(p_reference text, p_amount_cents integer, p_currency text, p_raw jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_attempt public.pdv_payment_attempts%ROWTYPE;
  v_tab public.pdv_tabs%ROWTYPE;
  v_item public.pdv_tab_items%ROWTYPE;
  v_product record;
  v_sale_id uuid; v_sale_code text;
  v_new_stock integer; v_new_reserved integer;
  v_cust_name text; v_cust_phone text;
BEGIN
  SELECT * INTO v_attempt FROM public.pdv_payment_attempts WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('matched', false, 'reason', 'attempt_not_found'); END IF;
  IF v_attempt.status = 'paid' THEN RETURN jsonb_build_object('matched', true, 'duplicate', true, 'attempt_id', v_attempt.id); END IF;
  IF v_attempt.status <> 'waiting_payment' THEN
    UPDATE public.pdv_payment_attempts SET status='pending_conciliation', raw_webhook=p_raw WHERE id=v_attempt.id;
    RETURN jsonb_build_object('matched', false, 'reason', 'attempt_not_waiting', 'status', v_attempt.status);
  END IF;
  IF p_currency IS NOT NULL AND upper(p_currency) <> 'EUR' THEN
    UPDATE public.pdv_payment_attempts SET status='pending_conciliation', raw_webhook=p_raw WHERE id=v_attempt.id;
    RETURN jsonb_build_object('matched', false, 'reason', 'currency_mismatch');
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <> v_attempt.amount_eur_cents THEN
    UPDATE public.pdv_payment_attempts SET status='pending_conciliation', raw_webhook=p_raw WHERE id=v_attempt.id;
    RETURN jsonb_build_object('matched', false, 'reason', 'amount_mismatch', 'expected', v_attempt.amount_eur_cents, 'received', p_amount_cents);
  END IF;
  SELECT * INTO v_tab FROM public.pdv_tabs WHERE id = v_attempt.tab_id FOR UPDATE;
  IF NOT FOUND OR v_tab.status <> 'aguardando_pagamento' THEN
    UPDATE public.pdv_payment_attempts SET status='pending_conciliation', raw_webhook=p_raw WHERE id=v_attempt.id;
    RETURN jsonb_build_object('matched', false, 'reason', 'tab_not_awaiting');
  END IF;

  v_sale_code := public.pdv_next_sale_code(now());
  v_cust_name := v_tab.customer_name_snapshot;
  v_cust_phone := v_tab.customer_phone_snapshot;
  IF v_cust_name IS NULL OR v_cust_phone IS NULL THEN
    SELECT COALESCE(v_cust_name, full_name), COALESCE(v_cust_phone, phone) INTO v_cust_name, v_cust_phone FROM public.profiles WHERE id = v_tab.customer_id;
  END IF;

  INSERT INTO public.pdv_sales(sale_code, customer_id, cashier_id, subtotal_eur_cents, subtotal_brl_cents, discount_type, discount_value, discount_eur_cents, discount_brl_cents, total_eur_cents, total_brl_cents, payment_method, notes, customer_name_snapshot, customer_phone_snapshot)
  VALUES (v_sale_code, v_tab.customer_id, v_attempt.created_by, v_attempt.subtotal_eur_cents, v_attempt.subtotal_brl_cents, v_attempt.discount_type, v_attempt.discount_value, v_attempt.discount_eur_cents, v_attempt.discount_brl_cents, v_attempt.amount_eur_cents, v_attempt.amount_brl_cents, 'wise', concat_ws(E'\n', NULLIF(v_attempt.notes,''), 'Comanda ' || v_tab.tab_code, 'Wise ref ' || v_attempt.reference), v_cust_name, v_cust_phone)
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
        UPDATE public.products SET stock_quantity=v_new_stock, reserved_stock_quantity=v_new_reserved, updated_at=now() WHERE id=v_product.id;
        INSERT INTO public.product_stock_movements(product_id, type, quantity, previous_stock, new_stock, reason, sale_id, tab_id, tab_item_id, created_by)
        VALUES (v_product.id, 'venda_comanda', v_item.qty, v_product.stock_quantity, v_new_stock, 'Wise ' || v_attempt.reference || ' / venda ' || v_sale_code, v_sale_id, v_tab.id, v_item.id, v_attempt.created_by);
      END IF;
    END IF;
  END LOOP;

  UPDATE public.pdv_tabs SET status='fechada', closed_by=v_attempt.created_by, sale_id=v_sale_id, payment_method='wise', closed_at=now(), active_payment_attempt_id=NULL, awaiting_payment_at=NULL, pending_sale_snapshot=NULL WHERE id=v_tab.id;
  UPDATE public.pdv_payment_attempts SET status='paid', paid_at=now(), raw_webhook=p_raw, sale_id=v_sale_id WHERE id=v_attempt.id;
  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_attempt.created_by, 'pdv_tab.wise_paid', 'pdv', 'pdv_payment_attempt', v_attempt.id, jsonb_build_object('sale_id', v_sale_id, 'sale_code', v_sale_code, 'reference', v_attempt.reference, 'total_eur_cents', v_attempt.amount_eur_cents));
  RETURN jsonb_build_object('matched', true, 'sale_id', v_sale_id, 'attempt_id', v_attempt.id);
END;
$function$;
