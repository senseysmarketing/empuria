CREATE OR REPLACE FUNCTION public.pdv_cancel_tab_item(p_item_id uuid, p_actor_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.pdv_tab_items%ROWTYPE;
  v_tab public.pdv_tabs%ROWTYPE;
  v_product record;
  v_reserved_before integer;
  v_reason text := NULLIF(trim(coalesce(p_reason, '')), '');
BEGIN
  IF v_reason IS NULL OR length(v_reason) < 3 THEN RAISE EXCEPTION 'Informe o motivo da remocao'; END IF;
  IF NOT public.has_role(p_actor_id, 'admin') AND NOT public.has_module_access(p_actor_id, 'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para operar comandas';
  END IF;

  SELECT * INTO v_item FROM public.pdv_tab_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item de comanda nao encontrado'; END IF;
  IF v_item.cancelled_at IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO v_tab FROM public.pdv_tabs WHERE id = v_item.tab_id FOR UPDATE;
  IF NOT FOUND OR v_tab.status <> 'aberta' THEN RAISE EXCEPTION 'Comanda nao esta aberta'; END IF;

  IF v_item.product_id IS NOT NULL THEN
    SELECT id, stock_quantity, reserved_stock_quantity, track_stock INTO v_product FROM public.products WHERE id = v_item.product_id FOR UPDATE;
    IF FOUND AND v_product.track_stock THEN
      v_reserved_before := v_product.reserved_stock_quantity;
      UPDATE public.products SET reserved_stock_quantity = GREATEST(reserved_stock_quantity - v_item.qty, 0), updated_at = now() WHERE id = v_product.id;
      INSERT INTO public.product_stock_movements(product_id, type, quantity, previous_stock, new_stock, reason, tab_id, tab_item_id, created_by)
      VALUES (v_product.id, 'liberacao_reserva_comanda', v_item.qty, v_product.stock_quantity, v_product.stock_quantity, 'Remocao item comanda ' || v_tab.tab_code || ' (' || v_reserved_before || ' -> ' || GREATEST(v_reserved_before - v_item.qty, 0) || '): ' || v_reason, v_tab.id, v_item.id, p_actor_id);
    END IF;
  END IF;

  UPDATE public.pdv_tab_items SET cancelled_at = now(), cancelled_by = p_actor_id, cancel_reason = v_reason WHERE id = p_item_id;
  INSERT INTO public.audit_logs(actor_id, action, module, entity_type, entity_id, old_data, new_data)
  VALUES (p_actor_id, 'pdv_tab.item_cancelled', 'pdv', 'pdv_tab_item', p_item_id, to_jsonb(v_item), jsonb_build_object('reason', v_reason));
END;
$function$;