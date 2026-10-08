-- PDV is the canonical source; Finance mirrors sale state without changing stock.
DO $preflight$
BEGIN
  -- A new Supabase Preview has no sales. A populated database must match the
  -- production baseline exactly; never silently backfill a partial history.
  IF NOT EXISTS (SELECT 1 FROM public.pdv_sales) THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.pdv_sales WHERE status = 'concluida') <> 40
    OR EXISTS (SELECT 1 FROM public.pdv_sales WHERE status = 'pendente')
    OR (SELECT count(*) FROM public.pdv_sales s JOIN public.finance_transactions f
        ON f.source_module = 'pdv' AND f.source_id = s.id
        WHERE s.status = 'concluida' AND f.status = 'received') <> 40
    OR EXISTS (SELECT 1 FROM public.pdv_sales s LEFT JOIN public.finance_transactions f
        ON f.source_module = 'pdv' AND f.source_id = s.id
        WHERE s.status = 'concluida' AND (f.id IS NULL OR f.amount_cents <= 0
          OR f.settled_amount_cents IS NULL OR f.settled_currency IS NULL
          OR f.paid_at IS NULL)) THEN
    RAISE EXCEPTION 'PDV historical preflight differs from 40 aligned paid sales';
  END IF;
END $preflight$;

ALTER TABLE public.pdv_sales
  ADD COLUMN payment_amount_cents integer,
  ADD COLUMN payment_currency text,
  ADD COLUMN settled_amount_cents integer,
  ADD COLUMN settled_currency text,
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN payment_account_id uuid REFERENCES public.finance_accounts(id) ON DELETE SET NULL,
  ADD COLUMN fx_reference_rate numeric,
  ADD COLUMN fx_reference_date date,
  ADD COLUMN fx_rate numeric,
  ADD COLUMN fx_source text,
  ADD COLUMN fx_locked_at timestamptz;

UPDATE public.pdv_sales s SET
  payment_amount_cents = f.amount_cents,
  payment_currency = f.currency,
  settled_amount_cents = f.settled_amount_cents,
  settled_currency = f.settled_currency,
  paid_at = f.paid_at,
  payment_account_id = f.account_id,
  fx_reference_rate = f.fx_reference_rate,
  fx_reference_date = f.fx_date,
  fx_rate = f.fx_rate,
  fx_source = f.fx_source,
  fx_locked_at = CASE WHEN f.fx_rate IS NOT NULL THEN f.paid_at END
FROM public.finance_transactions f
WHERE s.status = 'concluida' AND f.source_module = 'pdv' AND f.source_id = s.id;

ALTER TABLE public.pdv_sales
  ALTER COLUMN payment_method DROP NOT NULL,
  ALTER COLUMN status SET DEFAULT 'pendente',
  DROP CONSTRAINT pdv_sales_status_check,
  ADD CONSTRAINT pdv_sales_status_check CHECK (status IN ('pendente','concluida','cancelada')),
  ADD CONSTRAINT pdv_sales_payment_currency_check CHECK (payment_currency IN ('BRL','EUR')),
  ADD CONSTRAINT pdv_sales_settled_currency_check CHECK (settled_currency IS NULL OR settled_currency IN ('BRL','EUR')),
  ADD CONSTRAINT pdv_sales_payment_amount_check CHECK (payment_amount_cents IS NULL OR payment_amount_cents > 0),
  ADD CONSTRAINT pdv_sales_settled_amount_check CHECK (settled_amount_cents IS NULL OR settled_amount_cents > 0);

CREATE INDEX idx_pdv_sales_payment_account_id
  ON public.pdv_sales(payment_account_id);

-- The legacy direct-close path has no consumers and must not remain a paid bypass.
DROP FUNCTION public.pdv_close_sale(uuid,uuid,jsonb,text,numeric,text,text);

CREATE OR REPLACE FUNCTION public.finance_sync_pdv_sale(p_sale_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_sale public.pdv_sales%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO v_sale FROM public.pdv_sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_status := CASE v_sale.status WHEN 'pendente' THEN 'pending'
    WHEN 'concluida' THEN 'received' ELSE 'canceled' END;
  INSERT INTO public.finance_transactions (
    type,status,description,amount_cents,currency,amount_brl_cents,
    settled_amount_cents,settled_currency,reference_amount_cents,reference_currency,
    fx_reference_rate,fx_rate,fx_source,fx_date,due_date,paid_at,
    category_id,account_id,payment_method,source_module,source_id,
    is_automatic,notes,created_by
  ) VALUES (
    'income',v_status,'Venda PDV ' || v_sale.sale_code,
    v_sale.payment_amount_cents,v_sale.payment_currency,
    CASE WHEN v_sale.payment_currency='BRL' THEN v_sale.payment_amount_cents END,
    CASE WHEN v_status='received' THEN v_sale.settled_amount_cents END,
    CASE WHEN v_status='received' THEN v_sale.settled_currency END,
    v_sale.payment_amount_cents,v_sale.payment_currency,
    CASE WHEN v_status='received' THEN v_sale.fx_reference_rate END,
    CASE WHEN v_status='received' THEN v_sale.fx_rate END,
    CASE WHEN v_status='received' THEN v_sale.fx_source END,
    CASE WHEN v_status='received' THEN v_sale.fx_reference_date END,
    (v_sale.closed_at AT TIME ZONE 'UTC')::date,
    CASE WHEN v_status='received' THEN v_sale.paid_at END,
    public.finance_category_id('PDV','income'),
    CASE WHEN v_status='received' THEN v_sale.payment_account_id END,
    v_sale.payment_method,'pdv',v_sale.id,true,
    CASE WHEN v_status='canceled' THEN coalesce(v_sale.void_reason,'Venda anulada no PDV')
      ELSE v_sale.notes END,v_sale.cashier_id
  ) ON CONFLICT (source_module,source_id) WHERE source_id IS NOT NULL DO UPDATE SET
    status=excluded.status,description=excluded.description,
    amount_cents=excluded.amount_cents,currency=excluded.currency,
    amount_brl_cents=excluded.amount_brl_cents,
    settled_amount_cents=excluded.settled_amount_cents,
    settled_currency=excluded.settled_currency,
    reference_amount_cents=excluded.reference_amount_cents,
    reference_currency=excluded.reference_currency,
    fx_reference_rate=excluded.fx_reference_rate,fx_rate=excluded.fx_rate,
    fx_source=excluded.fx_source,fx_date=excluded.fx_date,
    due_date=excluded.due_date,paid_at=excluded.paid_at,
    account_id=excluded.account_id,payment_method=excluded.payment_method,
    notes=excluded.notes,updated_at=now();
END $function$;

DROP TRIGGER trg_finance_sync_pdv_sales ON public.pdv_sales;
CREATE TRIGGER trg_finance_sync_pdv_sales
  AFTER INSERT OR UPDATE OF status,payment_amount_cents,payment_currency,
    settled_amount_cents,settled_currency,paid_at,payment_account_id,
    fx_reference_rate,fx_reference_date,fx_rate,fx_source,closed_at,
    voided_at,void_reason
  ON public.pdv_sales FOR EACH ROW
  EXECUTE FUNCTION public.finance_sync_pdv_sale_trigger();

-- Keep the old RPC signature during deployment, but ignore the old method arg.
CREATE OR REPLACE FUNCTION public.pdv_close_tab(
  p_tab_id uuid,p_cashier_id uuid,p_discount_type text,p_discount_value numeric,
  p_payment_method text,p_notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_tab public.pdv_tabs%ROWTYPE; v_item public.pdv_tab_items%ROWTYPE; v_product record;
  v_sale_id uuid; v_sale_code text;
  v_subtotal_eur integer := 0; v_subtotal_brl integer := 0;
  v_discount_eur integer := 0; v_discount_brl integer := 0;
  v_total_eur integer; v_total_brl integer;
  v_sale_item_count integer := 0; v_new_stock integer; v_new_reserved integer;
  v_cust_name text; v_cust_phone text;
BEGIN
  IF NOT public.has_role(p_cashier_id,'admin')
    AND NOT public.has_module_access(p_cashier_id,'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para finalizar comandas';
  END IF;
  IF p_discount_type NOT IN ('none','amount','percent') OR p_discount_value IS NULL
    OR p_discount_value < 0 THEN RAISE EXCEPTION 'Desconto invalido'; END IF;
  SELECT * INTO v_tab FROM public.pdv_tabs WHERE id=p_tab_id FOR UPDATE;
  IF NOT FOUND OR v_tab.status <> 'aberta' THEN RAISE EXCEPTION 'Comanda nao esta aberta'; END IF;
  SELECT coalesce(sum(total_eur_cents),0),coalesce(sum(total_brl_cents),0),count(*)
    INTO v_subtotal_eur,v_subtotal_brl,v_sale_item_count
    FROM public.pdv_tab_items WHERE tab_id=p_tab_id AND cancelled_at IS NULL;
  IF v_sale_item_count=0 THEN RAISE EXCEPTION 'Comanda sem itens ativos'; END IF;
  IF p_discount_type='amount' THEN
    v_discount_eur := LEAST((p_discount_value*100)::integer,v_subtotal_eur);
    v_discount_brl := LEAST((p_discount_value*100)::integer,v_subtotal_brl);
  ELSIF p_discount_type='percent' THEN
    v_discount_eur := FLOOR(v_subtotal_eur*LEAST(p_discount_value,100)/100.0)::integer;
    v_discount_brl := FLOOR(v_subtotal_brl*LEAST(p_discount_value,100)/100.0)::integer;
  END IF;
  v_total_eur := GREATEST(v_subtotal_eur-v_discount_eur,0);
  v_total_brl := GREATEST(v_subtotal_brl-v_discount_brl,0);
  IF v_total_eur <= 0 AND v_total_brl <= 0 THEN
    RAISE EXCEPTION 'Total da comanda deve ser maior que zero';
  END IF;
  v_sale_code := public.pdv_next_sale_code(now());
  v_cust_name := v_tab.customer_name_snapshot;
  v_cust_phone := v_tab.customer_phone_snapshot;
  IF v_cust_name IS NULL OR v_cust_phone IS NULL THEN
    SELECT coalesce(v_cust_name,full_name),coalesce(v_cust_phone,phone)
      INTO v_cust_name,v_cust_phone FROM public.profiles WHERE id=v_tab.customer_id;
  END IF;
  INSERT INTO public.pdv_sales (
    sale_code,customer_id,cashier_id,subtotal_eur_cents,subtotal_brl_cents,
    discount_type,discount_value,discount_eur_cents,discount_brl_cents,
    total_eur_cents,total_brl_cents,payment_amount_cents,payment_currency,
    payment_method,status,notes,customer_name_snapshot,customer_phone_snapshot
  ) VALUES (
    v_sale_code,v_tab.customer_id,p_cashier_id,v_subtotal_eur,v_subtotal_brl,
    p_discount_type,p_discount_value,v_discount_eur,v_discount_brl,
    v_total_eur,v_total_brl,CASE WHEN v_total_eur>0 THEN v_total_eur ELSE v_total_brl END,
    CASE WHEN v_total_eur>0 THEN 'EUR' ELSE 'BRL' END,
    NULL,'pendente',concat_ws(E'\n',nullif(trim(coalesce(p_notes,'')),''),
      'Comanda ' || v_tab.tab_code),v_cust_name,v_cust_phone
  ) RETURNING id INTO v_sale_id;
  FOR v_item IN SELECT * FROM public.pdv_tab_items
    WHERE tab_id=p_tab_id AND cancelled_at IS NULL ORDER BY created_at FOR UPDATE LOOP
    INSERT INTO public.pdv_sale_items (
      sale_id,product_id,product_name_snapshot,product_emoji_snapshot,qty,
      unit_price_eur_cents,unit_price_brl_cents,total_eur_cents,total_brl_cents
    ) VALUES (v_sale_id,v_item.product_id,v_item.product_name_snapshot,
      v_item.product_emoji_snapshot,v_item.qty,v_item.unit_price_eur_cents,
      v_item.unit_price_brl_cents,v_item.total_eur_cents,v_item.total_brl_cents);
    IF v_item.product_id IS NOT NULL THEN
      SELECT id,stock_quantity,reserved_stock_quantity,track_stock INTO v_product
        FROM public.products WHERE id=v_item.product_id FOR UPDATE;
      IF FOUND AND v_product.track_stock THEN
        IF v_product.reserved_stock_quantity < v_item.qty THEN
          RAISE EXCEPTION 'Reserva de estoque inconsistente para %',v_item.product_name_snapshot;
        END IF;
        v_new_stock := v_product.stock_quantity-v_item.qty;
        v_new_reserved := v_product.reserved_stock_quantity-v_item.qty;
        UPDATE public.products SET stock_quantity=v_new_stock,
          reserved_stock_quantity=v_new_reserved,updated_at=now() WHERE id=v_product.id;
        INSERT INTO public.product_stock_movements (
          product_id,type,quantity,previous_stock,new_stock,reason,
          sale_id,tab_id,tab_item_id,created_by
        ) VALUES (v_product.id,'venda_comanda',v_item.qty,v_product.stock_quantity,
          v_new_stock,'Finalizacao comanda ' || v_tab.tab_code || ' / venda ' || v_sale_code,
          v_sale_id,v_tab.id,v_item.id,p_cashier_id);
      END IF;
    END IF;
  END LOOP;
  UPDATE public.pdv_tabs SET status='fechada',closed_by=p_cashier_id,sale_id=v_sale_id,
    subtotal_eur_cents=v_subtotal_eur,subtotal_brl_cents=v_subtotal_brl,
    discount_type=p_discount_type,discount_value=p_discount_value,
    discount_eur_cents=v_discount_eur,discount_brl_cents=v_discount_brl,
    total_eur_cents=v_total_eur,total_brl_cents=v_total_brl,
    payment_method=NULL,closed_at=now() WHERE id=p_tab_id;
  INSERT INTO public.audit_logs(actor_id,action,module,entity_type,entity_id,new_data)
    VALUES (p_cashier_id,'pdv_tab.finalized','pdv','pdv_tab',p_tab_id,
      jsonb_build_object('sale_id',v_sale_id,'sale_code',v_sale_code,
        'payment_status','pendente'));
  RETURN v_sale_id;
END $function$;

CREATE FUNCTION public.pdv_settle_sale(
  p_sale_id uuid,p_actor_id uuid,p_paid_at date,p_settled_amount_cents integer,
  p_settled_currency text,p_account_id uuid,
  p_fx_reference_rate numeric DEFAULT NULL,p_fx_reference_date date DEFAULT NULL,
  p_fx_rate numeric DEFAULT NULL,p_fx_source text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_sale public.pdv_sales%ROWTYPE; v_account public.finance_accounts%ROWTYPE;
BEGIN
  IF NOT public.has_role(p_actor_id,'admin')
    AND NOT public.has_module_access(p_actor_id,'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para dar baixa no PDV';
  END IF;
  IF p_paid_at IS NULL OR p_settled_amount_cents IS NULL OR p_settled_amount_cents <= 0
    OR p_settled_currency IS NULL OR p_settled_currency NOT IN ('BRL','EUR')
    OR p_account_id IS NULL THEN
    RAISE EXCEPTION 'Dados de baixa invalidos';
  END IF;
  SELECT * INTO v_sale FROM public.pdv_sales WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.status <> 'pendente' THEN
    RAISE EXCEPTION 'Apenas venda pendente pode receber baixa';
  END IF;
  SELECT * INTO v_account FROM public.finance_accounts WHERE id=p_account_id FOR SHARE;
  IF NOT FOUND OR NOT v_account.is_active OR v_account.currency<>p_settled_currency THEN
    RAISE EXCEPTION 'Conta inativa ou incompativel com a moeda realizada';
  END IF;
  IF v_sale.payment_currency<>p_settled_currency THEN
    IF p_fx_rate IS NULL OR p_fx_rate<=0 THEN
      RAISE EXCEPTION 'Cotacao aplicada obrigatoria para conversao';
    END IF;
  ELSIF p_fx_rate IS NOT NULL OR p_fx_reference_rate IS NOT NULL THEN
    RAISE EXCEPTION 'FX nao se aplica quando as moedas coincidem';
  END IF;
  IF p_fx_reference_rate IS NOT NULL AND p_fx_reference_rate<=0 THEN
    RAISE EXCEPTION 'Cotacao de referencia invalida';
  END IF;
  UPDATE public.pdv_sales SET status='concluida',
    settled_amount_cents=p_settled_amount_cents,settled_currency=p_settled_currency,
    paid_at=(p_paid_at::timestamp + interval '12 hours') AT TIME ZONE 'UTC',
    payment_account_id=p_account_id,
    fx_reference_rate=CASE WHEN payment_currency<>p_settled_currency THEN p_fx_reference_rate END,
    fx_reference_date=CASE WHEN payment_currency<>p_settled_currency THEN p_fx_reference_date END,
    fx_rate=CASE WHEN payment_currency<>p_settled_currency THEN p_fx_rate END,
    fx_source=CASE WHEN payment_currency<>p_settled_currency THEN coalesce(nullif(p_fx_source,''),'MANUAL') END,
    fx_locked_at=CASE WHEN payment_currency<>p_settled_currency THEN now() END,
    updated_at=now() WHERE id=p_sale_id;
  INSERT INTO public.audit_logs(actor_id,action,module,entity_type,entity_id,old_data,new_data)
    VALUES (p_actor_id,'pdv_sale.settled','pdv','pdv_sale',p_sale_id,
      jsonb_build_object('status','pendente','payment_amount_cents',v_sale.payment_amount_cents,
        'payment_currency',v_sale.payment_currency),
      jsonb_build_object('status','concluida','settled_amount_cents',p_settled_amount_cents,
        'settled_currency',p_settled_currency,'paid_at',p_paid_at,
        'account_id',p_account_id,'fx_rate',p_fx_rate));
END $function$;

CREATE FUNCTION public.pdv_reverse_sale_payment(
  p_sale_id uuid,p_actor_id uuid,p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_sale public.pdv_sales%ROWTYPE;
BEGIN
  IF NOT public.has_role(p_actor_id,'admin')
    AND NOT public.has_module_access(p_actor_id,'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para estornar baixa no PDV';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))<3 THEN
    RAISE EXCEPTION 'Informe motivo do estorno';
  END IF;
  SELECT * INTO v_sale FROM public.pdv_sales WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.status<>'concluida' THEN
    RAISE EXCEPTION 'Apenas venda paga pode ter baixa estornada';
  END IF;
  UPDATE public.pdv_sales SET status='pendente',settled_amount_cents=NULL,
    settled_currency=NULL,paid_at=NULL,payment_account_id=NULL,
    fx_reference_rate=NULL,fx_reference_date=NULL,fx_rate=NULL,
    fx_source=NULL,fx_locked_at=NULL,updated_at=now() WHERE id=p_sale_id;
  INSERT INTO public.audit_logs(actor_id,action,module,entity_type,entity_id,old_data,new_data)
    VALUES (p_actor_id,'pdv_sale.settlement_reversed','pdv','pdv_sale',p_sale_id,
      jsonb_build_object('status','concluida','settled_amount_cents',v_sale.settled_amount_cents,
        'settled_currency',v_sale.settled_currency,'paid_at',v_sale.paid_at,
        'account_id',v_sale.payment_account_id),
      jsonb_build_object('status','pendente','reason',btrim(p_reason)));
END $function$;

CREATE OR REPLACE FUNCTION public.pdv_void_sale(p_sale_id uuid,p_admin_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_sale public.pdv_sales%ROWTYPE; v_item record; v_product record; v_new_stock integer;
BEGIN
  IF NOT public.is_staff(p_admin_id) THEN
    RAISE EXCEPTION 'Sem permissao para cancelar vendas';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))<5 THEN
    RAISE EXCEPTION 'Informe motivo para cancelar a venda';
  END IF;
  SELECT * INTO v_sale FROM public.pdv_sales WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda nao encontrada'; END IF;
  IF v_sale.status<>'pendente' OR v_sale.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Estorne a baixa antes de cancelar; apenas venda pendente pode ser cancelada';
  END IF;
  FOR v_item IN SELECT product_id,qty,product_name_snapshot
    FROM public.pdv_sale_items WHERE sale_id=p_sale_id LOOP
    IF v_item.product_id IS NULL THEN CONTINUE; END IF;
    SELECT id,stock_quantity,track_stock INTO v_product FROM public.products
      WHERE id=v_item.product_id FOR UPDATE;
    IF FOUND AND v_product.track_stock THEN
      v_new_stock := v_product.stock_quantity+v_item.qty;
      UPDATE public.products SET stock_quantity=v_new_stock,updated_at=now()
        WHERE id=v_product.id;
      INSERT INTO public.product_stock_movements(
        product_id,type,quantity,previous_stock,new_stock,reason,sale_id,created_by
      ) VALUES (v_product.id,'cancelamento',v_item.qty,v_product.stock_quantity,
        v_new_stock,'Cancelamento da venda ' || v_sale.sale_code || ': ' || btrim(p_reason),
        p_sale_id,p_admin_id);
    END IF;
  END LOOP;
  UPDATE public.pdv_sales SET status='cancelada',voided_at=now(),voided_by=p_admin_id,
    void_reason=btrim(p_reason),updated_at=now() WHERE id=p_sale_id;
  INSERT INTO public.audit_logs(actor_id,action,module,entity_type,entity_id,old_data,new_data)
    VALUES (p_admin_id,'pdv_sale.voided','pdv','pdv_sale',p_sale_id,
      jsonb_build_object('status','pendente'),
      jsonb_build_object('status','cancelada','sale_code',v_sale.sale_code,
        'reason',btrim(p_reason)));
END $function$;

CREATE OR REPLACE FUNCTION public.finance_dashboard_month(p_month date)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_daily jsonb; v_services jsonb; v_expenses jsonb;
  v_recurring jsonb; v_team jsonb; v_totals jsonb; v_pdv jsonb;
BEGIN
  IF p_month IS NULL OR extract(day FROM p_month)<>1 THEN
    RAISE EXCEPTION 'Month must be its first day';
  END IF;
  PERFORM public.finance_ensure_month(p_month,NULL);
  SELECT jsonb_object_agg(c.currency,jsonb_build_object(
    'received',coalesce(realized.received,0),'paid',coalesce(realized.paid,0),
    'receivable',coalesce(obligations.receivable,0),'payable',coalesce(obligations.payable,0),
    'realizedBalance',coalesce(realized.received,0)-coalesce(realized.paid,0)
  )) INTO v_totals FROM (VALUES ('BRL'::text),('EUR'::text)) c(currency)
  LEFT JOIN LATERAL (
    SELECT sum(settled_amount_cents) FILTER (WHERE type='income')::bigint AS received,
      sum(settled_amount_cents) FILTER (WHERE type='expense')::bigint AS paid
    FROM public.finance_transactions WHERE status IN ('received','paid')
      AND settled_currency=c.currency AND paid_at>=p_month
      AND paid_at<p_month+interval '1 month'
  ) realized ON true
  LEFT JOIN LATERAL (
    SELECT sum(amount_cents) FILTER (WHERE type='income')::bigint AS receivable,
      sum(amount_cents) FILTER (WHERE type='expense')::bigint AS payable
    FROM public.finance_transactions WHERE status='pending' AND currency=c.currency
      AND due_date>=p_month AND due_date<p_month+interval '1 month'
  ) obligations ON true;
  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.day,d.currency),'[]'::jsonb)
    INTO v_daily FROM (
    SELECT paid_at::date AS day,settled_currency AS currency,
      sum(settled_amount_cents) FILTER (WHERE type='income')::bigint AS income_cents,
      sum(settled_amount_cents) FILTER (WHERE type='expense')::bigint AS expense_cents
    FROM public.finance_transactions WHERE status IN ('received','paid')
      AND paid_at>=p_month AND paid_at<p_month+interval '1 month'
      AND settled_currency IN ('BRL','EUR')
    GROUP BY paid_at::date,settled_currency
  ) d;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sales_count DESC,s.service_title),'[]'::jsonb)
    INTO v_services FROM (
    SELECT o.service_id,coalesce(max(o.service_title),'Serviço sem nome') AS service_title,
      count(*)::integer AS sales_count,
      count(*) FILTER (WHERE o.payment_status='aprovado')::integer AS paid_count,
      count(*) FILTER (WHERE o.payment_status='pendente')::integer AS pending_count,
      jsonb_build_object(
        'BRL',jsonb_build_object(
          'sold_cents',coalesce(sum(coalesce(o.payment_amount_cents,o.amount_cents)) FILTER
            (WHERE coalesce(o.payment_currency,o.currency)='BRL'),0),
          'received_cents',coalesce(sum(o.settled_amount_cents) FILTER
            (WHERE o.payment_status='aprovado' AND o.settled_currency='BRL'),0),
          'receivable_cents',coalesce(sum(coalesce(o.payment_amount_cents,o.amount_cents)) FILTER
            (WHERE o.payment_status='pendente' AND coalesce(o.payment_currency,o.currency)='BRL'),0)),
        'EUR',jsonb_build_object(
          'sold_cents',coalesce(sum(coalesce(o.payment_amount_cents,o.amount_cents)) FILTER
            (WHERE coalesce(o.payment_currency,o.currency)='EUR'),0),
          'received_cents',coalesce(sum(o.settled_amount_cents) FILTER
            (WHERE o.payment_status='aprovado' AND o.settled_currency='EUR'),0),
          'receivable_cents',coalesce(sum(coalesce(o.payment_amount_cents,o.amount_cents)) FILTER
            (WHERE o.payment_status='pendente' AND coalesce(o.payment_currency,o.currency)='EUR'),0))
      ) AS currencies
    FROM public.orders o WHERE o.created_at>=p_month
      AND o.created_at<p_month+interval '1 month'
      AND o.payment_status IN ('aprovado','pendente')
      AND coalesce(o.payment_currency,o.currency) IN ('BRL','EUR')
    GROUP BY o.service_id,CASE WHEN o.service_id IS NULL THEN o.service_title END
  ) s;
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.currency,e.amount_cents DESC),'[]'::jsonb)
    INTO v_expenses FROM (
    SELECT t.category_id,coalesce(c.name,'Sem categoria') AS category_name,
      CASE WHEN t.status='paid' THEN t.settled_currency ELSE t.currency END AS currency,
      sum(CASE WHEN t.status='paid' THEN t.settled_amount_cents ELSE t.amount_cents END)::bigint
        AS amount_cents
    FROM public.finance_transactions t
    LEFT JOIN public.finance_categories c ON c.id=t.category_id
    WHERE t.type='expense' AND t.status IN ('paid','pending')
      AND t.source_module<>'partner_distribution'
      AND t.due_date>=p_month AND t.due_date<p_month+interval '1 month'
      AND (CASE WHEN t.status='paid' THEN t.settled_currency ELSE t.currency END) IN ('BRL','EUR')
    GROUP BY t.category_id,c.name,
      CASE WHEN t.status='paid' THEN t.settled_currency ELSE t.currency END
  ) e;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.currency),'[]'::jsonb)
    INTO v_recurring FROM (
    SELECT c.currency,
      coalesce((SELECT sum(t.settled_amount_cents) FROM public.finance_transactions t
        WHERE t.source_module LIKE 'recurring:%' AND t.status='paid'
          AND t.settled_currency=c.currency AND t.paid_at>=p_month
          AND t.paid_at<p_month+interval '1 month'),0)::bigint AS paid_cents,
      coalesce((SELECT sum(t.amount_cents) FROM public.finance_transactions t
        WHERE t.source_module LIKE 'recurring:%' AND t.status='pending'
          AND t.currency=c.currency AND t.due_date>=p_month
          AND t.due_date<p_month+interval '1 month'),0)::bigint AS pending_cents
    FROM (VALUES ('BRL'::text),('EUR'::text)) c(currency)
  ) r;
  SELECT coalesce(jsonb_agg(to_jsonb(team) ORDER BY team.currency),'[]'::jsonb)
    INTO v_team FROM (
    SELECT c.currency,
      coalesce((SELECT sum(t.amount_cents) FROM public.finance_transactions t
        WHERE t.source_module='team_payout' AND t.status='pending'
          AND t.currency=c.currency AND t.due_date>=p_month
          AND t.due_date<p_month+interval '1 month'),0)::bigint AS payable_cents,
      coalesce((SELECT sum(t.settled_amount_cents) FROM public.finance_transactions t
        WHERE t.source_module='team_payout' AND t.status='paid'
          AND t.settled_currency=c.currency AND t.paid_at>=p_month
          AND t.paid_at<p_month+interval '1 month'),0)::bigint AS paid_cents
    FROM (VALUES ('BRL'::text),('EUR'::text)) c(currency)
  ) team;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.currency),'[]'::jsonb)
    INTO v_pdv FROM (
    SELECT c.currency,
      coalesce((SELECT sum(t.settled_amount_cents) FROM public.finance_transactions t
        WHERE t.source_module='pdv' AND t.status='received'
          AND t.settled_currency=c.currency AND t.paid_at>=p_month
          AND t.paid_at<p_month+interval '1 month'),0)::bigint AS received_cents,
      coalesce((SELECT sum(t.amount_cents) FROM public.finance_transactions t
        WHERE t.source_module='pdv' AND t.status='pending'
          AND t.currency=c.currency AND t.due_date>=p_month
          AND t.due_date<p_month+interval '1 month'),0)::bigint AS pending_cents
    FROM (VALUES ('BRL'::text),('EUR'::text)) c(currency)
  ) p;
  RETURN jsonb_build_object('totals',v_totals,'daily',v_daily,
    'services',v_services,'expenses',v_expenses,'recurring',v_recurring,
    'team',v_team,'pdv',v_pdv,
    'snapshot',public.finance_month_snapshot(p_month,false));
END $function$;

REVOKE ALL ON FUNCTION public.pdv_close_tab(uuid,uuid,text,numeric,text,text),
  public.finance_sync_pdv_sale(uuid),public.pdv_settle_sale(uuid,uuid,date,integer,text,uuid,numeric,date,numeric,text),
  public.pdv_reverse_sale_payment(uuid,uuid,text),public.pdv_void_sale(uuid,uuid,text),
  public.finance_dashboard_month(date)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_close_tab(uuid,uuid,text,numeric,text,text),
  public.finance_sync_pdv_sale(uuid),public.pdv_settle_sale(uuid,uuid,date,integer,text,uuid,numeric,date,numeric,text),
  public.pdv_reverse_sale_payment(uuid,uuid,text),public.pdv_void_sale(uuid,uuid,text),
  public.finance_dashboard_month(date) TO service_role;
