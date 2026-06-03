CREATE OR REPLACE FUNCTION public.pdv_close_sale(
  p_customer_id uuid,
  p_cashier_id uuid,
  p_items jsonb,
  p_discount_type text,
  p_discount_value numeric,
  p_payment_method text,
  p_notes text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_sale_code text;
  v_item jsonb;
  v_product record;
  v_qty integer;
  v_subtotal_eur integer := 0;
  v_subtotal_brl integer := 0;
  v_discount_eur integer := 0;
  v_discount_brl integer := 0;
  v_total_eur integer;
  v_total_brl integer;
  v_new_stock integer;
BEGIN
  IF p_payment_method NOT IN ('dinheiro','cartao','pix') THEN
    RAISE EXCEPTION 'Forma de pagamento invalida';
  END IF;
  IF p_discount_type NOT IN ('none','amount','percent') THEN
    RAISE EXCEPTION 'Tipo de desconto invalido';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Venda sem itens';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'Cliente nao encontrado';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::integer;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Quantidade invalida'; END IF;

    SELECT id, name, emoji, price_eur_cents, price_brl_cents, stock_quantity, track_stock, is_active
      INTO v_product
      FROM public.products
      WHERE id = (v_item->>'product_id')::uuid
      FOR UPDATE;

    IF NOT FOUND OR NOT v_product.is_active THEN
      RAISE EXCEPTION 'Item indisponivel';
    END IF;
    IF v_product.track_stock AND v_product.stock_quantity < v_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para %', v_product.name;
    END IF;

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

  INSERT INTO public.pdv_sales (
    sale_code, customer_id, cashier_id, subtotal_eur_cents, subtotal_brl_cents,
    discount_type, discount_value, discount_eur_cents, discount_brl_cents,
    total_eur_cents, total_brl_cents, payment_method, notes
  ) VALUES (
    v_sale_code, p_customer_id, p_cashier_id, v_subtotal_eur, v_subtotal_brl,
    p_discount_type, p_discount_value, v_discount_eur, v_discount_brl,
    v_total_eur, v_total_brl, p_payment_method, p_notes
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::integer;
    SELECT id, name, emoji, price_eur_cents, price_brl_cents, stock_quantity, track_stock
      INTO v_product
      FROM public.products
      WHERE id = (v_item->>'product_id')::uuid;

    INSERT INTO public.pdv_sale_items (
      sale_id, product_id, product_name_snapshot, product_emoji_snapshot,
      qty, unit_price_eur_cents, unit_price_brl_cents, total_eur_cents, total_brl_cents
    ) VALUES (
      v_sale_id, v_product.id, v_product.name, v_product.emoji,
      v_qty, v_product.price_eur_cents, v_product.price_brl_cents,
      v_product.price_eur_cents * v_qty, v_product.price_brl_cents * v_qty
    );

    IF v_product.track_stock THEN
      v_new_stock := v_product.stock_quantity - v_qty;
      UPDATE public.products SET stock_quantity = v_new_stock, updated_at = now()
        WHERE id = v_product.id;
      INSERT INTO public.product_stock_movements (
        product_id, type, quantity, previous_stock, new_stock, reason, sale_id, created_by
      ) VALUES (
        v_product.id, 'venda', v_qty, v_product.stock_quantity, v_new_stock,
        'Venda PDV ' || v_sale_code, v_sale_id, p_cashier_id
      );
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (p_cashier_id, 'venda_fechada', 'pdv', 'pdv_sale', v_sale_id,
    jsonb_build_object(
      'sale_code', v_sale_code,
      'total_eur_cents', v_total_eur,
      'payment_method', p_payment_method,
      'customer_id', p_customer_id
    ));

  RETURN v_sale_id;
END;
$$;

INSERT INTO public.finance_accounts (name, type, currency, is_active)
SELECT 'Pix', 'gateway', 'BRL', true
WHERE NOT EXISTS (SELECT 1 FROM public.finance_accounts WHERE name = 'Pix');

CREATE OR REPLACE FUNCTION public.finance_account_id_for_payment(p_payment_method text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.finance_accounts
  WHERE name = CASE
    WHEN p_payment_method = 'dinheiro' THEN 'Dinheiro EUR'
    WHEN p_payment_method = 'cartao' THEN 'Cartao'
    WHEN p_payment_method = 'pix' THEN 'Pix'
    WHEN p_payment_method IN ('mercadopago', 'boleto', 'credit_card') THEN 'Mercado Pago'
    ELSE 'Caixa fisico'
  END
  LIMIT 1
$$;