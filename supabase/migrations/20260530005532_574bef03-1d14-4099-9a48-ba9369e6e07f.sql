
-- ================================================
-- PDV Refactor: balcão de venda, estoque, snapshots
-- ================================================

-- 1) Expand products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'produto',
  ADD COLUMN IF NOT EXISTS price_eur_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_brl_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_min_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD CONSTRAINT products_item_type_check
  CHECK (item_type IN ('produto','servico'));

-- backfill price_eur_cents from price_cents where 0
UPDATE public.products SET price_eur_cents = price_cents WHERE price_eur_cents = 0;

-- 2) pdv_sales
CREATE TABLE public.pdv_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  cashier_id uuid NOT NULL,
  subtotal_eur_cents integer NOT NULL DEFAULT 0,
  subtotal_brl_cents integer NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','amount','percent')),
  discount_value numeric NOT NULL DEFAULT 0,
  discount_eur_cents integer NOT NULL DEFAULT 0,
  discount_brl_cents integer NOT NULL DEFAULT 0,
  total_eur_cents integer NOT NULL DEFAULT 0,
  total_brl_cents integer NOT NULL DEFAULT 0,
  payment_method text NOT NULL CHECK (payment_method IN ('dinheiro','cartao')),
  status text NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida','cancelada')),
  notes text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.pdv_sales TO authenticated;
GRANT ALL ON public.pdv_sales TO service_role;

ALTER TABLE public.pdv_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view pdv sales" ON public.pdv_sales
  FOR SELECT TO authenticated USING (is_staff(auth.uid()));
CREATE POLICY "Staff insert pdv sales" ON public.pdv_sales
  FOR INSERT TO authenticated WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "Admins update pdv sales" ON public.pdv_sales
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE INDEX idx_pdv_sales_customer ON public.pdv_sales(customer_id);
CREATE INDEX idx_pdv_sales_cashier ON public.pdv_sales(cashier_id);
CREATE INDEX idx_pdv_sales_closed_at ON public.pdv_sales(closed_at DESC);

-- 3) pdv_sale_items
CREATE TABLE public.pdv_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.pdv_sales(id) ON DELETE CASCADE,
  product_id uuid,
  product_name_snapshot text NOT NULL,
  product_emoji_snapshot text,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price_eur_cents integer NOT NULL DEFAULT 0,
  unit_price_brl_cents integer NOT NULL DEFAULT 0,
  total_eur_cents integer NOT NULL DEFAULT 0,
  total_brl_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.pdv_sale_items TO authenticated;
GRANT ALL ON public.pdv_sale_items TO service_role;

ALTER TABLE public.pdv_sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view pdv sale items" ON public.pdv_sale_items
  FOR SELECT TO authenticated USING (is_staff(auth.uid()));
CREATE POLICY "Staff insert pdv sale items" ON public.pdv_sale_items
  FOR INSERT TO authenticated WITH CHECK (is_staff(auth.uid()));

CREATE INDEX idx_pdv_sale_items_sale ON public.pdv_sale_items(sale_id);

-- 4) product_stock_movements
CREATE TABLE public.product_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('entrada','saida','ajuste','venda','cancelamento')),
  quantity integer NOT NULL,
  previous_stock integer NOT NULL DEFAULT 0,
  new_stock integer NOT NULL DEFAULT 0,
  reason text,
  sale_id uuid REFERENCES public.pdv_sales(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.product_stock_movements TO authenticated;
GRANT ALL ON public.product_stock_movements TO service_role;

ALTER TABLE public.product_stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view stock movements" ON public.product_stock_movements
  FOR SELECT TO authenticated USING (is_staff(auth.uid()));
CREATE POLICY "Staff insert stock movements" ON public.product_stock_movements
  FOR INSERT TO authenticated WITH CHECK (is_staff(auth.uid()));

CREATE INDEX idx_stock_movements_product ON public.product_stock_movements(product_id, created_at DESC);

-- 5) Atomic close-sale function
CREATE OR REPLACE FUNCTION public.pdv_close_sale(
  p_customer_id uuid,
  p_cashier_id uuid,
  p_items jsonb,             -- [{product_id, qty}]
  p_discount_type text,      -- 'none' | 'amount' | 'percent'
  p_discount_value numeric,
  p_payment_method text,     -- 'dinheiro' | 'cartao'
  p_notes text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
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
    RAISE EXCEPTION 'Forma de pagamento inválida';
  END IF;
  IF p_discount_type NOT IN ('none','amount','percent') THEN
    RAISE EXCEPTION 'Tipo de desconto inválido';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Venda sem itens';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;

  -- Validate stock and compute subtotals
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::integer;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;

    SELECT id, name, emoji, price_eur_cents, price_brl_cents, stock_quantity, track_stock, is_active
      INTO v_product
      FROM public.products
      WHERE id = (v_item->>'product_id')::uuid
      FOR UPDATE;

    IF NOT FOUND OR NOT v_product.is_active THEN
      RAISE EXCEPTION 'Item indisponível';
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

  INSERT INTO public.pdv_sales (
    customer_id, cashier_id, subtotal_eur_cents, subtotal_brl_cents,
    discount_type, discount_value, discount_eur_cents, discount_brl_cents,
    total_eur_cents, total_brl_cents, payment_method, notes
  ) VALUES (
    p_customer_id, p_cashier_id, v_subtotal_eur, v_subtotal_brl,
    p_discount_type, p_discount_value, v_discount_eur, v_discount_brl,
    v_total_eur, v_total_brl, p_payment_method, p_notes
  ) RETURNING id INTO v_sale_id;

  -- Insert items + stock movements
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
        'Venda PDV', v_sale_id, p_cashier_id
      );
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (p_cashier_id, 'venda_fechada', 'pdv', 'pdv_sale', v_sale_id,
    jsonb_build_object('total_eur_cents', v_total_eur, 'payment_method', p_payment_method, 'customer_id', p_customer_id));

  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pdv_close_sale(uuid, uuid, jsonb, text, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_close_sale(uuid, uuid, jsonb, text, numeric, text, text) TO service_role;
