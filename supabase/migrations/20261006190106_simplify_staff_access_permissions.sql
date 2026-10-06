-- Bloco 2: staff opera todos os modulos normais; Financeiro/Caixa permanece admin-only.

CREATE OR REPLACE FUNCTION public.has_module_access(_user_id uuid, _module text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _module = 'financeiro'
      THEN public.has_role(_user_id, 'admin'::public.app_role)
    ELSE public.is_staff(_user_id)
  END
$$;

-- Preserve the existing explicit grants for the RLS helper.
REVOKE ALL ON FUNCTION public.has_module_access(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_module_access(uuid, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Admins manage CRM columns" ON public.crm_columns;
CREATE POLICY "Staff manage CRM columns"
  ON public.crm_columns FOR ALL TO authenticated
  USING (public.is_staff((SELECT auth.uid())))
  WITH CHECK (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins manage CRM distribution settings" ON public.crm_distribution_settings;
CREATE POLICY "Staff manage CRM distribution settings"
  ON public.crm_distribution_settings FOR ALL TO authenticated
  USING (public.is_staff((SELECT auth.uid())))
  WITH CHECK (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins manage CRM distribution members" ON public.crm_distribution_members;
CREATE POLICY "Staff manage CRM distribution members"
  ON public.crm_distribution_members FOR ALL TO authenticated
  USING (public.is_staff((SELECT auth.uid())))
  WITH CHECK (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins view audit logs" ON public.audit_logs;
CREATE POLICY "Staff view audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can read client error logs" ON public.client_error_logs;
CREATE POLICY "Staff can read client error logs"
  ON public.client_error_logs FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins manage club subscriptions" ON public.club_subscriptions;
CREATE POLICY "Staff manage club subscriptions"
  ON public.club_subscriptions FOR ALL TO authenticated
  USING (public.is_staff((SELECT auth.uid())))
  WITH CHECK (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins manage integration events" ON public.integration_events;
CREATE POLICY "Staff manage integration events"
  ON public.integration_events FOR ALL TO authenticated
  USING (public.is_staff((SELECT auth.uid())))
  WITH CHECK (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can read pdv activity logs" ON public.pdv_activity_logs;
CREATE POLICY "Staff can read pdv activity logs"
  ON public.pdv_activity_logs FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins update pdv sales" ON public.pdv_sales;
CREATE POLICY "Staff update pdv sales"
  ON public.pdv_sales FOR UPDATE TO authenticated
  USING (public.is_staff((SELECT auth.uid())))
  WITH CHECK (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins view pdv sale counters" ON public.pdv_sale_code_counters;
CREATE POLICY "Staff view pdv sale counters"
  ON public.pdv_sale_code_counters FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins view impersonation logs" ON public.impersonation_logs;
CREATE POLICY "Staff view impersonation logs"
  ON public.impersonation_logs FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins insert impersonation logs" ON public.impersonation_logs;
CREATE POLICY "Staff insert own impersonation logs"
  ON public.impersonation_logs FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff((SELECT auth.uid()))
    AND admin_id = (SELECT auth.uid())
  );

CREATE OR REPLACE FUNCTION public.pdv_void_sale(
  p_sale_id uuid,
  p_admin_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale record;
  v_item record;
  v_product record;
  v_new_stock integer;
BEGIN
  IF NOT public.is_staff(p_admin_id) THEN
    RAISE EXCEPTION 'Sem permissao para anular vendas';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe um motivo para anular a venda';
  END IF;

  SELECT * INTO v_sale FROM public.pdv_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda nao encontrada';
  END IF;
  IF v_sale.status = 'cancelada' OR v_sale.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Venda ja anulada';
  END IF;

  FOR v_item IN
    SELECT product_id, qty, product_name_snapshot
    FROM public.pdv_sale_items WHERE sale_id = p_sale_id
  LOOP
    IF v_item.product_id IS NULL THEN CONTINUE; END IF;

    SELECT id, name, stock_quantity, track_stock
      INTO v_product FROM public.products WHERE id = v_item.product_id FOR UPDATE;

    IF FOUND AND v_product.track_stock THEN
      v_new_stock := v_product.stock_quantity + v_item.qty;
      UPDATE public.products SET stock_quantity = v_new_stock, updated_at = now()
        WHERE id = v_product.id;

      INSERT INTO public.product_stock_movements (
        product_id, type, quantity, previous_stock, new_stock, reason, sale_id, created_by
      ) VALUES (
        v_product.id, 'cancelamento', v_item.qty, v_product.stock_quantity, v_new_stock,
        'Anulacao da venda ' || v_sale.sale_code || ': ' || btrim(p_reason),
        p_sale_id, p_admin_id
      );
    END IF;
  END LOOP;

  UPDATE public.pdv_sales
    SET status = 'cancelada', voided_at = now(), voided_by = p_admin_id,
        void_reason = btrim(p_reason), updated_at = now()
    WHERE id = p_sale_id;

  INSERT INTO public.audit_logs (actor_id, action, module, entity_type, entity_id, old_data, new_data)
  VALUES (
    p_admin_id, 'pdv_sale.voided', 'pdv', 'pdv_sale', p_sale_id,
    jsonb_build_object('status', v_sale.status),
    jsonb_build_object('status', 'cancelada', 'sale_code', v_sale.sale_code, 'reason', btrim(p_reason))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pdv_cancel_tab(
  p_tab_id uuid,
  p_actor_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tab public.pdv_tabs%ROWTYPE;
  v_item public.pdv_tab_items%ROWTYPE;
  v_product record;
  v_reserved_before integer;
  v_active_items integer;
  v_reason text := NULLIF(trim(coalesce(p_reason, '')), '');
BEGIN
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento';
  END IF;

  IF NOT public.is_staff(p_actor_id) THEN
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

  SELECT count(*) INTO v_active_items
  FROM public.pdv_tab_items
  WHERE tab_id = p_tab_id
    AND cancelled_at IS NULL;

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
        cancelled_at = now(),
        cancelled_by = p_actor_id,
        cancel_reason = v_reason
    WHERE id = p_tab_id;

  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, old_data)
  VALUES (
    p_actor_id,
    'pdv_tab.cancelled',
    'pdv',
    'pdv_tab',
    p_tab_id,
    jsonb_build_object(
      'tab_code', v_tab.tab_code,
      'customer_id', v_tab.customer_id,
      'reason', v_reason,
      'active_items', v_active_items
    )
  );
END;
$$;

-- These privileged RPCs are invoked only by server functions through service_role.
REVOKE ALL ON FUNCTION public.pdv_void_sale(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pdv_cancel_tab(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_void_sale(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_cancel_tab(uuid, uuid, text) TO service_role;
