-- PDV history support: human sale codes and controlled voiding.

CREATE TABLE IF NOT EXISTS public.pdv_sale_code_counters (
  sale_date date PRIMARY KEY,
  next_value integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.pdv_sale_code_counters TO service_role;

ALTER TABLE public.pdv_sale_code_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view pdv sale counters" ON public.pdv_sale_code_counters
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));

ALTER TABLE public.pdv_sales
  ADD COLUMN IF NOT EXISTS sale_code text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason text;

WITH numbered AS (
  SELECT
    id,
    'PDV-' || to_char(closed_at AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' ||
      lpad(row_number() OVER (
        PARTITION BY (closed_at AT TIME ZONE 'UTC')::date
        ORDER BY closed_at, id
      )::text, 4, '0') AS generated_code
  FROM public.pdv_sales
  WHERE sale_code IS NULL OR btrim(sale_code) = ''
)
UPDATE public.pdv_sales s
SET sale_code = numbered.generated_code
FROM numbered
WHERE s.id = numbered.id;

ALTER TABLE public.pdv_sales
  ALTER COLUMN sale_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pdv_sales_sale_code
  ON public.pdv_sales (sale_code);

CREATE INDEX IF NOT EXISTS idx_pdv_sales_status_closed_at
  ON public.pdv_sales (status, closed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pdv_sales_payment_closed_at
  ON public.pdv_sales (payment_method, closed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pdv_sales_voided_by
  ON public.pdv_sales (voided_by);

CREATE OR REPLACE FUNCTION public.pdv_next_sale_code(p_closed_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_date date := (p_closed_at AT TIME ZONE 'UTC')::date;
  v_next integer;
BEGIN
  INSERT INTO public.pdv_sale_code_counters (sale_date, next_value)
  VALUES (v_sale_date, 2)
  ON CONFLICT (sale_date) DO UPDATE
    SET next_value = public.pdv_sale_code_counters.next_value + 1,
        updated_at = now()
  RETURNING next_value - 1 INTO v_next;

  RETURN 'PDV-' || to_char(v_sale_date, 'YYYYMMDD') || '-' || lpad(v_next::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.pdv_next_sale_code(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_next_sale_code(timestamptz) TO service_role;

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
  IF p_payment_method NOT IN ('dinheiro','cartao') THEN
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

REVOKE ALL ON FUNCTION public.pdv_close_sale(uuid, uuid, jsonb, text, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_close_sale(uuid, uuid, jsonb, text, numeric, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.pdv_void_sale(
  p_sale_id uuid,
  p_admin_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_item record;
  v_product record;
  v_new_stock integer;
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem anular vendas';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe um motivo para anular a venda';
  END IF;

  SELECT *
    INTO v_sale
    FROM public.pdv_sales
    WHERE id = p_sale_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda nao encontrada';
  END IF;

  IF v_sale.status = 'cancelada' OR v_sale.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Venda ja anulada';
  END IF;

  FOR v_item IN
    SELECT product_id, qty, product_name_snapshot
    FROM public.pdv_sale_items
    WHERE sale_id = p_sale_id
  LOOP
    IF v_item.product_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT id, name, stock_quantity, track_stock
      INTO v_product
      FROM public.products
      WHERE id = v_item.product_id
      FOR UPDATE;

    IF FOUND AND v_product.track_stock THEN
      v_new_stock := v_product.stock_quantity + v_item.qty;
      UPDATE public.products
      SET stock_quantity = v_new_stock,
          updated_at = now()
      WHERE id = v_product.id;

      INSERT INTO public.product_stock_movements (
        product_id, type, quantity, previous_stock, new_stock, reason, sale_id, created_by
      ) VALUES (
        v_product.id,
        'cancelamento',
        v_item.qty,
        v_product.stock_quantity,
        v_new_stock,
        'Anulacao da venda ' || v_sale.sale_code || ': ' || btrim(p_reason),
        p_sale_id,
        p_admin_id
      );
    END IF;
  END LOOP;

  UPDATE public.pdv_sales
  SET status = 'cancelada',
      voided_at = now(),
      voided_by = p_admin_id,
      void_reason = btrim(p_reason),
      updated_at = now()
  WHERE id = p_sale_id;

  INSERT INTO public.audit_logs (actor_id, action, module, entity_type, entity_id, old_data, new_data)
  VALUES (
    p_admin_id,
    'pdv_sale.voided',
    'pdv',
    'pdv_sale',
    p_sale_id,
    jsonb_build_object('status', v_sale.status),
    jsonb_build_object('status', 'cancelada', 'sale_code', v_sale.sale_code, 'reason', btrim(p_reason))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pdv_void_sale(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_void_sale(uuid, uuid, text) TO service_role;
