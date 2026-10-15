
-- 1) Remove legacy 'triagem' module permissions (CRM replaced it).
DELETE FROM public.staff_module_permissions WHERE module_key = 'triagem';

-- 2) Create staff_action_permissions for granular subpermissions
CREATE TABLE IF NOT EXISTS public.staff_action_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  is_allowed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, action_key)
);

GRANT SELECT ON public.staff_action_permissions TO authenticated;
GRANT ALL ON public.staff_action_permissions TO service_role;

ALTER TABLE public.staff_action_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff vê próprias ações ou admin tudo" ON public.staff_action_permissions;
CREATE POLICY "Staff vê próprias ações ou admin tudo"
  ON public.staff_action_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Apenas admin altera ações" ON public.staff_action_permissions;
CREATE POLICY "Apenas admin altera ações"
  ON public.staff_action_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_staff_action_permissions_updated_at ON public.staff_action_permissions;
CREATE TRIGGER trg_staff_action_permissions_updated_at
  BEFORE UPDATE ON public.staff_action_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Helper to check action permission
CREATE OR REPLACE FUNCTION public.has_action(_user_id uuid, _action text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.staff_action_permissions
      WHERE user_id = _user_id AND action_key = _action AND is_allowed = true
    )
$$;

-- 4) Update pdv_void_sale to allow staff with pdv.void_sale action
CREATE OR REPLACE FUNCTION public.pdv_void_sale(p_sale_id uuid, p_admin_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale record;
  v_item record;
  v_product record;
  v_new_stock integer;
BEGIN
  IF NOT public.has_action(p_admin_id, 'pdv.void_sale') THEN
    RAISE EXCEPTION 'Sem permissão para anular vendas';
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
$function$;
