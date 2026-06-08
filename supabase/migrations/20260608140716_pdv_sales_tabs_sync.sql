-- Synchronize PDV quick sales with open comandas.
-- Allows multiple open tabs for the same customer and lets PDV operators cancel empty tabs.

DROP INDEX IF EXISTS public.idx_pdv_tabs_one_open_per_customer;

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
  v_tab public.pdv_tabs%ROWTYPE;
BEGIN
  IF NOT public.has_role(p_opened_by, 'admin') AND NOT public.has_module_access(p_opened_by, 'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para abrir comandas';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'Cliente nao encontrado';
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
  v_active_items integer;
  v_reason text := NULLIF(trim(coalesce(p_reason, '')), '');
BEGIN
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento';
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

  IF NOT public.has_role(p_actor_id, 'admin') AND NOT public.has_action(p_actor_id, 'pdv.cancel_tab') THEN
    IF NOT (v_active_items = 0 AND public.has_module_access(p_actor_id, 'pdv')) THEN
      RAISE EXCEPTION 'Sem permissao para cancelar comandas com itens';
    END IF;
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

REVOKE ALL ON FUNCTION public.pdv_open_tab(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pdv_cancel_tab(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_open_tab(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_cancel_tab(uuid, uuid, text) TO service_role;
