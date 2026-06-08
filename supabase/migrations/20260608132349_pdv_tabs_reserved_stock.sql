-- PDV comandas with reserved stock.
-- Keeps quick sales compatible while preventing overselling items reserved in open tabs.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS reserved_stock_quantity integer NOT NULL DEFAULT 0;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS available_stock_quantity integer
  GENERATED ALWAYS AS (GREATEST(stock_quantity - reserved_stock_quantity, 0)) STORED;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_reserved_stock_nonnegative;

ALTER TABLE public.products
  ADD CONSTRAINT products_reserved_stock_nonnegative
  CHECK (reserved_stock_quantity >= 0);

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_reserved_stock_within_physical;

ALTER TABLE public.products
  ADD CONSTRAINT products_reserved_stock_within_physical
  CHECK (reserved_stock_quantity <= stock_quantity);

ALTER TABLE public.pdv_sales
  DROP CONSTRAINT IF EXISTS pdv_sales_payment_method_check;

ALTER TABLE public.pdv_sales
  ADD CONSTRAINT pdv_sales_payment_method_check
  CHECK (payment_method = ANY (ARRAY['dinheiro'::text, 'cartao'::text, 'pix'::text]));

CREATE TABLE IF NOT EXISTS public.pdv_tab_code_counters (
  day date PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pdv_tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_code text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  opened_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sale_id uuid UNIQUE REFERENCES public.pdv_sales(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'aberta'
    CHECK (status = ANY (ARRAY['aberta'::text, 'fechada'::text, 'cancelada'::text])),
  notes text,
  subtotal_eur_cents integer NOT NULL DEFAULT 0,
  subtotal_brl_cents integer NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'none'
    CHECK (discount_type = ANY (ARRAY['none'::text, 'amount'::text, 'percent'::text])),
  discount_value numeric NOT NULL DEFAULT 0,
  discount_eur_cents integer NOT NULL DEFAULT 0,
  discount_brl_cents integer NOT NULL DEFAULT 0,
  total_eur_cents integer NOT NULL DEFAULT 0,
  total_brl_cents integer NOT NULL DEFAULT 0,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pdv_tabs_one_open_per_customer
  ON public.pdv_tabs(customer_id)
  WHERE status = 'aberta';

CREATE INDEX IF NOT EXISTS idx_pdv_tabs_status_opened
  ON public.pdv_tabs(status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_pdv_tabs_customer
  ON public.pdv_tabs(customer_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.pdv_tab_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id uuid NOT NULL REFERENCES public.pdv_tabs(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL,
  product_emoji_snapshot text,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price_eur_cents integer NOT NULL DEFAULT 0,
  unit_price_brl_cents integer NOT NULL DEFAULT 0,
  total_eur_cents integer NOT NULL DEFAULT 0,
  total_brl_cents integer NOT NULL DEFAULT 0,
  added_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdv_tab_items_tab
  ON public.pdv_tab_items(tab_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pdv_tab_items_product
  ON public.pdv_tab_items(product_id)
  WHERE product_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_pdv_tabs_updated_at ON public.pdv_tabs;
CREATE TRIGGER trg_pdv_tabs_updated_at
  BEFORE UPDATE ON public.pdv_tabs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_pdv_tab_items_updated_at ON public.pdv_tab_items;
CREATE TRIGGER trg_pdv_tab_items_updated_at
  BEFORE UPDATE ON public.pdv_tab_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE ON public.pdv_tabs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pdv_tab_items TO authenticated;
GRANT ALL ON public.pdv_tabs TO service_role;
GRANT ALL ON public.pdv_tab_items TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.pdv_tab_code_counters TO service_role;

ALTER TABLE public.pdv_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_tab_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PDV staff view tabs" ON public.pdv_tabs;
CREATE POLICY "PDV staff view tabs"
  ON public.pdv_tabs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_module_access(auth.uid(), 'pdv'));

DROP POLICY IF EXISTS "PDV staff manage tabs" ON public.pdv_tabs;
CREATE POLICY "PDV staff manage tabs"
  ON public.pdv_tabs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_module_access(auth.uid(), 'pdv'));

DROP POLICY IF EXISTS "PDV staff update tabs" ON public.pdv_tabs;
CREATE POLICY "PDV staff update tabs"
  ON public.pdv_tabs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_module_access(auth.uid(), 'pdv'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_module_access(auth.uid(), 'pdv'));

DROP POLICY IF EXISTS "PDV staff view tab items" ON public.pdv_tab_items;
CREATE POLICY "PDV staff view tab items"
  ON public.pdv_tab_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_module_access(auth.uid(), 'pdv'));

DROP POLICY IF EXISTS "PDV staff manage tab items" ON public.pdv_tab_items;
CREATE POLICY "PDV staff manage tab items"
  ON public.pdv_tab_items FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_module_access(auth.uid(), 'pdv'));

DROP POLICY IF EXISTS "PDV staff update tab items" ON public.pdv_tab_items;
CREATE POLICY "PDV staff update tab items"
  ON public.pdv_tab_items FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_module_access(auth.uid(), 'pdv'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_module_access(auth.uid(), 'pdv'));

ALTER TABLE public.product_stock_movements
  ADD COLUMN IF NOT EXISTS tab_id uuid REFERENCES public.pdv_tabs(id) ON DELETE SET NULL;

ALTER TABLE public.product_stock_movements
  ADD COLUMN IF NOT EXISTS tab_item_id uuid REFERENCES public.pdv_tab_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_tab
  ON public.product_stock_movements(tab_id, created_at DESC)
  WHERE tab_id IS NOT NULL;

ALTER TABLE public.product_stock_movements
  DROP CONSTRAINT IF EXISTS product_stock_movements_type_check;

ALTER TABLE public.product_stock_movements
  ADD CONSTRAINT product_stock_movements_type_check
  CHECK (
    type = ANY (
      ARRAY[
        'entrada'::text,
        'saida'::text,
        'ajuste'::text,
        'venda'::text,
        'cancelamento'::text,
        'reserva_comanda'::text,
        'liberacao_reserva_comanda'::text,
        'venda_comanda'::text
      ]
    )
  );

CREATE OR REPLACE FUNCTION public.pdv_next_tab_code(p_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := (p_at AT TIME ZONE 'Europe/Madrid')::date;
  v_next integer;
BEGIN
  INSERT INTO public.pdv_tab_code_counters(day, last_value, updated_at)
  VALUES (v_day, 1, now())
  ON CONFLICT (day) DO UPDATE
    SET last_value = pdv_tab_code_counters.last_value + 1,
        updated_at = now()
  RETURNING last_value INTO v_next;

  RETURN 'CMD-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_next::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.pdv_open_tab(
  p_customer_id uuid,
  p_opened_by uuid,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.pdv_tabs%ROWTYPE;
  v_tab public.pdv_tabs%ROWTYPE;
BEGIN
  IF NOT public.has_role(p_opened_by, 'admin') AND NOT public.has_module_access(p_opened_by, 'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para abrir comandas';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'Cliente nao encontrado';
  END IF;

  SELECT * INTO v_existing
  FROM public.pdv_tabs
  WHERE customer_id = p_customer_id
    AND status = 'aberta'
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'tab_id', v_existing.id,
      'tab_code', v_existing.tab_code,
      'existing', true
    );
  END IF;

  INSERT INTO public.pdv_tabs(tab_code, customer_id, opened_by, notes)
  VALUES (public.pdv_next_tab_code(now()), p_customer_id, p_opened_by, NULLIF(trim(coalesce(p_notes, '')), ''))
  RETURNING * INTO v_tab;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (
    p_opened_by,
    'pdv_tab.opened',
    'pdv',
    'pdv_tab',
    v_tab.id,
    jsonb_build_object('tab_code', v_tab.tab_code, 'customer_id', p_customer_id)
  );

  RETURN jsonb_build_object('tab_id', v_tab.id, 'tab_code', v_tab.tab_code, 'existing', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.pdv_add_tab_item(
  p_tab_id uuid,
  p_product_id uuid,
  p_qty integer,
  p_actor_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tab public.pdv_tabs%ROWTYPE;
  v_product record;
  v_item_id uuid;
  v_available integer;
  v_reserved_before integer;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade invalida';
  END IF;

  IF NOT public.has_role(p_actor_id, 'admin') AND NOT public.has_module_access(p_actor_id, 'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para operar comandas';
  END IF;

  SELECT * INTO v_tab
  FROM public.pdv_tabs
  WHERE id = p_tab_id
  FOR UPDATE;

  IF NOT FOUND OR v_tab.status <> 'aberta' THEN
    RAISE EXCEPTION 'Comanda nao esta aberta';
  END IF;

  SELECT id, name, emoji, price_eur_cents, price_brl_cents, stock_quantity,
         reserved_stock_quantity, track_stock, is_active
    INTO v_product
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

  IF NOT FOUND OR NOT v_product.is_active THEN
    RAISE EXCEPTION 'Item indisponivel';
  END IF;

  v_available := v_product.stock_quantity - v_product.reserved_stock_quantity;
  IF v_product.track_stock AND v_available < p_qty THEN
    RAISE EXCEPTION 'Estoque disponivel insuficiente para %', v_product.name;
  END IF;

  INSERT INTO public.pdv_tab_items(
    tab_id, product_id, product_name_snapshot, product_emoji_snapshot, qty,
    unit_price_eur_cents, unit_price_brl_cents, total_eur_cents, total_brl_cents, added_by
  ) VALUES (
    p_tab_id, v_product.id, v_product.name, v_product.emoji, p_qty,
    v_product.price_eur_cents, v_product.price_brl_cents,
    v_product.price_eur_cents * p_qty, v_product.price_brl_cents * p_qty, p_actor_id
  )
  RETURNING id INTO v_item_id;

  IF v_product.track_stock THEN
    v_reserved_before := v_product.reserved_stock_quantity;
    UPDATE public.products
      SET reserved_stock_quantity = reserved_stock_quantity + p_qty,
          updated_at = now()
      WHERE id = v_product.id;

    INSERT INTO public.product_stock_movements(
      product_id, type, quantity, previous_stock, new_stock, reason, tab_id, tab_item_id, created_by
    ) VALUES (
      v_product.id,
      'reserva_comanda',
      p_qty,
      v_product.stock_quantity,
      v_product.stock_quantity,
      'Reserva comanda ' || v_tab.tab_code || ' (' || v_reserved_before || ' -> ' || (v_reserved_before + p_qty) || ')',
      p_tab_id,
      v_item_id,
      p_actor_id
    );
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (
    p_actor_id,
    'pdv_tab.item_added',
    'pdv',
    'pdv_tab_item',
    v_item_id,
    jsonb_build_object('tab_id', p_tab_id, 'product_id', v_product.id, 'qty', p_qty)
  );

  RETURN v_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pdv_update_tab_item_qty(
  p_item_id uuid,
  p_qty integer,
  p_actor_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.pdv_tab_items%ROWTYPE;
  v_tab public.pdv_tabs%ROWTYPE;
  v_product record;
  v_delta integer;
  v_available integer;
  v_reserved_before integer;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade invalida';
  END IF;

  IF NOT public.has_role(p_actor_id, 'admin') AND NOT public.has_module_access(p_actor_id, 'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para operar comandas';
  END IF;

  SELECT * INTO v_item
  FROM public.pdv_tab_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND OR v_item.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Item de comanda nao encontrado';
  END IF;

  SELECT * INTO v_tab
  FROM public.pdv_tabs
  WHERE id = v_item.tab_id
  FOR UPDATE;

  IF NOT FOUND OR v_tab.status <> 'aberta' THEN
    RAISE EXCEPTION 'Comanda nao esta aberta';
  END IF;

  v_delta := p_qty - v_item.qty;
  IF v_delta = 0 THEN
    RETURN;
  END IF;

  IF v_item.product_id IS NOT NULL THEN
    SELECT id, name, stock_quantity, reserved_stock_quantity, track_stock
      INTO v_product
      FROM public.products
      WHERE id = v_item.product_id
      FOR UPDATE;

    IF FOUND AND v_product.track_stock THEN
      v_available := v_product.stock_quantity - v_product.reserved_stock_quantity;
      IF v_delta > 0 AND v_available < v_delta THEN
        RAISE EXCEPTION 'Estoque disponivel insuficiente para %', v_product.name;
      END IF;

      v_reserved_before := v_product.reserved_stock_quantity;
      UPDATE public.products
        SET reserved_stock_quantity = reserved_stock_quantity + v_delta,
            updated_at = now()
        WHERE id = v_product.id;

      INSERT INTO public.product_stock_movements(
        product_id, type, quantity, previous_stock, new_stock, reason, tab_id, tab_item_id, created_by
      ) VALUES (
        v_product.id,
        CASE WHEN v_delta > 0 THEN 'reserva_comanda' ELSE 'liberacao_reserva_comanda' END,
        abs(v_delta),
        v_product.stock_quantity,
        v_product.stock_quantity,
        'Ajuste de quantidade comanda ' || v_tab.tab_code || ' (' || v_reserved_before || ' -> ' || (v_reserved_before + v_delta) || ')',
        v_tab.id,
        v_item.id,
        p_actor_id
      );
    END IF;
  END IF;

  UPDATE public.pdv_tab_items
    SET qty = p_qty,
        total_eur_cents = unit_price_eur_cents * p_qty,
        total_brl_cents = unit_price_brl_cents * p_qty
    WHERE id = p_item_id;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, old_data, new_data)
  VALUES (
    p_actor_id,
    'pdv_tab.item_qty_updated',
    'pdv',
    'pdv_tab_item',
    p_item_id,
    jsonb_build_object('qty', v_item.qty),
    jsonb_build_object('qty', p_qty)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pdv_cancel_tab_item(
  p_item_id uuid,
  p_actor_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.pdv_tab_items%ROWTYPE;
  v_tab public.pdv_tabs%ROWTYPE;
  v_product record;
  v_reserved_before integer;
  v_reason text := NULLIF(trim(coalesce(p_reason, '')), '');
BEGIN
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da remocao';
  END IF;

  IF NOT public.has_role(p_actor_id, 'admin') AND NOT public.has_action(p_actor_id, 'pdv.remove_tab_item') THEN
    RAISE EXCEPTION 'Sem permissao para remover itens da comanda';
  END IF;

  SELECT * INTO v_item
  FROM public.pdv_tab_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de comanda nao encontrado';
  END IF;
  IF v_item.cancelled_at IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_tab
  FROM public.pdv_tabs
  WHERE id = v_item.tab_id
  FOR UPDATE;

  IF NOT FOUND OR v_tab.status <> 'aberta' THEN
    RAISE EXCEPTION 'Comanda nao esta aberta';
  END IF;

  IF v_item.product_id IS NOT NULL THEN
    SELECT id, stock_quantity, reserved_stock_quantity, track_stock
      INTO v_product
      FROM public.products
      WHERE id = v_item.product_id
      FOR UPDATE;

    IF FOUND AND v_product.track_stock THEN
      v_reserved_before := v_product.reserved_stock_quantity;
      UPDATE public.products
        SET reserved_stock_quantity = GREATEST(reserved_stock_quantity - v_item.qty, 0),
            updated_at = now()
        WHERE id = v_product.id;

      INSERT INTO public.product_stock_movements(
        product_id, type, quantity, previous_stock, new_stock, reason, tab_id, tab_item_id, created_by
      ) VALUES (
        v_product.id,
        'liberacao_reserva_comanda',
        v_item.qty,
        v_product.stock_quantity,
        v_product.stock_quantity,
        'Remocao item comanda ' || v_tab.tab_code || ' (' || v_reserved_before || ' -> ' || GREATEST(v_reserved_before - v_item.qty, 0) || '): ' || v_reason,
        v_tab.id,
        v_item.id,
        p_actor_id
      );
    END IF;
  END IF;

  UPDATE public.pdv_tab_items
    SET cancelled_at = now(),
        cancelled_by = p_actor_id,
        cancel_reason = v_reason
    WHERE id = p_item_id;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, old_data, new_data)
  VALUES (
    p_actor_id,
    'pdv_tab.item_cancelled',
    'pdv',
    'pdv_tab_item',
    p_item_id,
    to_jsonb(v_item),
    jsonb_build_object('reason', v_reason)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pdv_close_tab(
  p_tab_id uuid,
  p_cashier_id uuid,
  p_discount_type text,
  p_discount_value numeric,
  p_payment_method text,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF NOT public.has_role(p_cashier_id, 'admin') AND NOT public.has_module_access(p_cashier_id, 'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para fechar comandas';
  END IF;
  IF p_payment_method NOT IN ('dinheiro','cartao','pix') THEN
    RAISE EXCEPTION 'Forma de pagamento invalida';
  END IF;
  IF p_discount_type NOT IN ('none','amount','percent') THEN
    RAISE EXCEPTION 'Tipo de desconto invalido';
  END IF;

  SELECT * INTO v_tab
  FROM public.pdv_tabs
  WHERE id = p_tab_id
  FOR UPDATE;

  IF NOT FOUND OR v_tab.status <> 'aberta' THEN
    RAISE EXCEPTION 'Comanda nao esta aberta';
  END IF;

  SELECT coalesce(sum(total_eur_cents), 0), coalesce(sum(total_brl_cents), 0), count(*)
    INTO v_subtotal_eur, v_subtotal_brl, v_sale_item_count
    FROM public.pdv_tab_items
    WHERE tab_id = p_tab_id
      AND cancelled_at IS NULL;

  IF v_sale_item_count = 0 THEN
    RAISE EXCEPTION 'Comanda sem itens ativos';
  END IF;

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
    v_sale_code, v_tab.customer_id, p_cashier_id, v_subtotal_eur, v_subtotal_brl,
    p_discount_type, p_discount_value, v_discount_eur, v_discount_brl,
    v_total_eur, v_total_brl, p_payment_method,
    concat_ws(E'\n', NULLIF(trim(coalesce(p_notes, '')), ''), 'Comanda ' || v_tab.tab_code)
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN
    SELECT *
    FROM public.pdv_tab_items
    WHERE tab_id = p_tab_id
      AND cancelled_at IS NULL
    ORDER BY created_at
    FOR UPDATE
  LOOP
    INSERT INTO public.pdv_sale_items (
      sale_id, product_id, product_name_snapshot, product_emoji_snapshot,
      qty, unit_price_eur_cents, unit_price_brl_cents, total_eur_cents, total_brl_cents
    ) VALUES (
      v_sale_id, v_item.product_id, v_item.product_name_snapshot, v_item.product_emoji_snapshot,
      v_item.qty, v_item.unit_price_eur_cents, v_item.unit_price_brl_cents,
      v_item.total_eur_cents, v_item.total_brl_cents
    );

    IF v_item.product_id IS NOT NULL THEN
      SELECT id, stock_quantity, reserved_stock_quantity, track_stock
        INTO v_product
        FROM public.products
        WHERE id = v_item.product_id
        FOR UPDATE;

      IF FOUND AND v_product.track_stock THEN
        IF v_product.reserved_stock_quantity < v_item.qty THEN
          RAISE EXCEPTION 'Reserva de estoque inconsistente para %', v_item.product_name_snapshot;
        END IF;

        v_new_stock := v_product.stock_quantity - v_item.qty;
        v_new_reserved := v_product.reserved_stock_quantity - v_item.qty;
        UPDATE public.products
          SET stock_quantity = v_new_stock,
              reserved_stock_quantity = v_new_reserved,
              updated_at = now()
          WHERE id = v_product.id;

        INSERT INTO public.product_stock_movements(
          product_id, type, quantity, previous_stock, new_stock, reason, sale_id, tab_id, tab_item_id, created_by
        ) VALUES (
          v_product.id,
          'venda_comanda',
          v_item.qty,
          v_product.stock_quantity,
          v_new_stock,
          'Fechamento comanda ' || v_tab.tab_code || ' / venda ' || v_sale_code,
          v_sale_id,
          v_tab.id,
          v_item.id,
          p_cashier_id
        );
      END IF;
    END IF;
  END LOOP;

  UPDATE public.pdv_tabs
    SET status = 'fechada',
        closed_by = p_cashier_id,
        sale_id = v_sale_id,
        subtotal_eur_cents = v_subtotal_eur,
        subtotal_brl_cents = v_subtotal_brl,
        discount_type = p_discount_type,
        discount_value = p_discount_value,
        discount_eur_cents = v_discount_eur,
        discount_brl_cents = v_discount_brl,
        total_eur_cents = v_total_eur,
        total_brl_cents = v_total_brl,
        closed_at = now()
    WHERE id = p_tab_id;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, new_data)
  VALUES (
    p_cashier_id,
    'pdv_tab.closed',
    'pdv',
    'pdv_tab',
    p_tab_id,
    jsonb_build_object('sale_id', v_sale_id, 'sale_code', v_sale_code, 'total_brl_cents', v_total_brl, 'payment_method', p_payment_method)
  );

  RETURN v_sale_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pdv_cancel_tab(
  p_tab_id uuid,
  p_actor_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tab public.pdv_tabs%ROWTYPE;
  v_item public.pdv_tab_items%ROWTYPE;
  v_product record;
  v_reserved_before integer;
  v_reason text := NULLIF(trim(coalesce(p_reason, '')), '');
BEGIN
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento';
  END IF;

  IF NOT public.has_role(p_actor_id, 'admin') AND NOT public.has_action(p_actor_id, 'pdv.cancel_tab') THEN
    RAISE EXCEPTION 'Sem permissao para cancelar comandas';
  END IF;

  SELECT * INTO v_tab
  FROM public.pdv_tabs
  WHERE id = p_tab_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comanda nao encontrada';
  END IF;
  IF v_tab.status <> 'aberta' THEN
    RAISE EXCEPTION 'Apenas comandas abertas podem ser canceladas';
  END IF;

  FOR v_item IN
    SELECT *
    FROM public.pdv_tab_items
    WHERE tab_id = p_tab_id
      AND cancelled_at IS NULL
    FOR UPDATE
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT id, stock_quantity, reserved_stock_quantity, track_stock
        INTO v_product
        FROM public.products
        WHERE id = v_item.product_id
        FOR UPDATE;

      IF FOUND AND v_product.track_stock THEN
        v_reserved_before := v_product.reserved_stock_quantity;
        UPDATE public.products
          SET reserved_stock_quantity = GREATEST(reserved_stock_quantity - v_item.qty, 0),
              updated_at = now()
          WHERE id = v_product.id;

        INSERT INTO public.product_stock_movements(
          product_id, type, quantity, previous_stock, new_stock, reason, tab_id, tab_item_id, created_by
        ) VALUES (
          v_product.id,
          'liberacao_reserva_comanda',
          v_item.qty,
          v_product.stock_quantity,
          v_product.stock_quantity,
          'Cancelamento comanda ' || v_tab.tab_code || ' (' || v_reserved_before || ' -> ' || GREATEST(v_reserved_before - v_item.qty, 0) || '): ' || v_reason,
          v_tab.id,
          v_item.id,
          p_actor_id
        );
      END IF;
    END IF;

    UPDATE public.pdv_tab_items
      SET cancelled_at = now(),
          cancelled_by = p_actor_id,
          cancel_reason = v_reason
      WHERE id = v_item.id;
  END LOOP;

  UPDATE public.pdv_tabs
    SET status = 'cancelada',
        cancelled_by = p_actor_id,
        cancelled_at = now(),
        cancel_reason = v_reason
    WHERE id = p_tab_id;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, old_data, new_data)
  VALUES (
    p_actor_id,
    'pdv_tab.cancelled',
    'pdv',
    'pdv_tab',
    p_tab_id,
    to_jsonb(v_tab),
    jsonb_build_object('reason', v_reason)
  );
END;
$$;

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
  v_available integer;
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

    SELECT id, name, emoji, price_eur_cents, price_brl_cents, stock_quantity,
           reserved_stock_quantity, track_stock, is_active
      INTO v_product
      FROM public.products
      WHERE id = (v_item->>'product_id')::uuid
      FOR UPDATE;

    IF NOT FOUND OR NOT v_product.is_active THEN
      RAISE EXCEPTION 'Item indisponivel';
    END IF;

    v_available := v_product.stock_quantity - v_product.reserved_stock_quantity;
    IF v_product.track_stock AND v_available < v_qty THEN
      RAISE EXCEPTION 'Estoque disponivel insuficiente para %', v_product.name;
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
      WHERE id = (v_item->>'product_id')::uuid
      FOR UPDATE;

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

REVOKE ALL ON FUNCTION public.pdv_next_tab_code(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pdv_open_tab(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pdv_add_tab_item(uuid, uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pdv_update_tab_item_qty(uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pdv_cancel_tab_item(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pdv_close_tab(uuid, uuid, text, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pdv_cancel_tab(uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.pdv_open_tab(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_add_tab_item(uuid, uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_update_tab_item_qty(uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_cancel_tab_item(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_close_tab(uuid, uuid, text, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_cancel_tab(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_close_sale(uuid, uuid, jsonb, text, numeric, text, text) TO service_role;
