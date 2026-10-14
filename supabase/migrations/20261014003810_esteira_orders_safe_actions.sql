-- Keep order history, but remove deleted orders from daily operation.
ALTER TABLE public.orders
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.finance_sync_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_status text;
  v_amount integer;
  v_currency text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_order.deleted_at IS NOT NULL THEN
    DELETE FROM public.finance_transactions
      WHERE source_module = 'orders' AND source_id = p_order_id
        AND status = 'pending' AND paid_at IS NULL
        AND settled_amount_cents IS NULL;
    RETURN;
  END IF;

  v_status := CASE
    WHEN v_order.payment_status='aprovado' AND v_order.payment_method='gratuito'
      THEN 'canceled' -- no cash receipt for a courtesy
    WHEN v_order.payment_status='aprovado' THEN 'received'
    WHEN v_order.payment_status='pendente' THEN 'pending'
    ELSE 'canceled'
  END;
  v_amount := COALESCE(v_order.payment_amount_cents, v_order.amount_cents, 0);
  v_currency := COALESCE(v_order.payment_currency, v_order.currency, 'EUR');

  INSERT INTO public.finance_transactions (
    type,status,description,amount_cents,currency,amount_brl_cents,
    settled_amount_cents,settled_currency,reference_amount_cents,reference_currency,
    fx_reference_rate,fx_rate,fx_source,fx_date,due_date,paid_at,
    category_id,account_id,payment_method,source_module,source_id,
    is_automatic,notes,created_by
  ) VALUES (
    'income',v_status,'Pedido ' || COALESCE(v_order.service_title,v_order.id::text),
    v_amount,v_currency,CASE WHEN v_currency='BRL' THEN v_amount END,
    CASE WHEN v_status='received' THEN v_order.settled_amount_cents END,
    CASE WHEN v_status='received' THEN v_order.settled_currency END,
    v_order.amount_cents,v_order.currency,
    v_order.fx_reference_rate,v_order.fx_rate,v_order.fx_source,v_order.fx_reference_date,
    (v_order.created_at AT TIME ZONE 'UTC')::date,
    CASE WHEN v_status='received' THEN v_order.paid_at END,
    public.finance_category_id('Pedidos/Servicos','income'),NULL,
    COALESCE(v_order.payment_method,v_order.payment_provider),'orders',v_order.id,
    true,v_order.notes,v_order.user_id
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
    payment_method=excluded.payment_method,notes=excluded.notes,updated_at=now();
  -- account_id is intentionally omitted from UPDATE: old references are historical.
END $function$;

DROP TRIGGER trg_finance_sync_orders ON public.orders;
CREATE TRIGGER trg_finance_sync_orders
  AFTER INSERT OR UPDATE OF payment_status,amount_cents,currency,payment_method,
    payment_amount_cents,payment_currency,settled_amount_cents,settled_currency,
    payment_account_id,paid_at,fx_reference_rate,fx_reference_date,fx_rate,fx_source,deleted_at
  ON public.orders FOR EACH ROW EXECUTE FUNCTION public.finance_sync_order_trigger();

CREATE OR REPLACE FUNCTION public.on_order_approved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE svc public.services%ROWTYPE;
BEGIN
  IF NEW.payment_status='aprovado' AND
    (TG_OP='INSERT' OR OLD.payment_status <> 'aprovado') THEN
    IF NEW.voucher_code IS NULL THEN
      NEW.voucher_code := 'EMP-' || upper(substr(replace(NEW.id::text,'-',''),1,8));
    END IF;
    IF NEW.executed_at IS NULL AND NEW.delivery_status='aguardando_pagamento' THEN
      SELECT * INTO svc FROM public.services WHERE id=NEW.service_id;
      IF FOUND THEN
        IF svc.kind IN ('consulting','banking') THEN
          NEW.delivery_status := 'aguardando_documentos';
        ELSIF svc.kind IN ('tour','meeting','airport') THEN
          NEW.delivery_status := 'agendado';
        ELSE
          NEW.delivery_status := 'processando';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER trg_on_order_approved ON public.orders;
CREATE TRIGGER trg_on_order_approved BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.on_order_approved();

CREATE OR REPLACE FUNCTION public.on_order_approved_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE svc public.services%ROWTYPE; item text; i integer := 0;
BEGIN
  IF NEW.payment_status='aprovado' AND
    (TG_OP='INSERT' OR OLD.payment_status <> 'aprovado') THEN
    SELECT * INTO svc FROM public.services WHERE id=NEW.service_id;
    IF FOUND AND svc.requires_documents AND NOT EXISTS
      (SELECT 1 FROM public.order_documents WHERE order_id=NEW.id) THEN
      FOR item IN SELECT jsonb_array_elements_text(svc.document_checklist) LOOP
        INSERT INTO public.order_documents(order_id,label,position) VALUES (NEW.id,item,i);
        i := i+1;
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER trg_on_order_approved_after ON public.orders;
CREATE TRIGGER trg_on_order_approved_after AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.on_order_approved_after();

CREATE OR REPLACE FUNCTION public.esteira_settle_order(
  p_order_id uuid,p_actor uuid,p_paid_at date,p_amount_cents integer,p_currency text,
  p_fx_reference_rate numeric DEFAULT NULL,p_fx_reference_date date DEFAULT NULL,
  p_fx_rate numeric DEFAULT NULL,p_fx_source text DEFAULT NULL,p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_order public.orders%ROWTYPE; v_base_currency text;
BEGIN
  IF p_actor IS NULL OR NOT (public.has_role(p_actor,'admin') OR public.has_module_access(p_actor,'esteira')) THEN
    RAISE EXCEPTION 'Sem permissao para dar baixa em pedidos';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.deleted_at IS NOT NULL OR v_order.payment_status <> 'pendente' THEN
    RAISE EXCEPTION 'Apenas pedido pendente e ativo pode receber baixa';
  END IF;
  IF v_order.payment_provider_payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Pagamento confirmado por provedor exige fluxo proprio';
  END IF;
  IF p_paid_at IS NULL OR p_amount_cents IS NULL OR p_amount_cents<=0
    OR COALESCE(v_order.payment_amount_cents,v_order.amount_cents,0)<=0
    OR p_currency IS NULL OR p_currency NOT IN ('BRL','EUR') THEN
    RAISE EXCEPTION 'Data, valor e moeda realizados sao obrigatorios';
  END IF;
  v_base_currency := COALESCE(v_order.payment_currency,v_order.currency);
  IF v_base_currency<>p_currency AND (p_fx_rate IS NULL OR p_fx_rate<=0) THEN
    RAISE EXCEPTION 'Cotacao aplicada obrigatoria para conversao';
  END IF;
  IF p_fx_reference_rate IS NOT NULL AND p_fx_reference_rate<=0 THEN
    RAISE EXCEPTION 'Cotacao de referencia invalida';
  END IF;
  UPDATE public.orders SET payment_status='aprovado',payment_method='manual',
    settled_amount_cents=p_amount_cents,settled_currency=p_currency,
    payment_account_id=NULL,paid_at=(p_paid_at::timestamp + interval '12 hours') AT TIME ZONE 'UTC',
    fx_reference_rate=CASE WHEN v_base_currency<>p_currency THEN p_fx_reference_rate ELSE v_order.fx_reference_rate END,
    fx_reference_date=CASE WHEN v_base_currency<>p_currency THEN p_fx_reference_date ELSE v_order.fx_reference_date END,
    fx_rate=CASE WHEN v_base_currency<>p_currency THEN p_fx_rate ELSE v_order.fx_rate END,
    fx_source=CASE WHEN v_base_currency<>p_currency THEN coalesce(nullif(p_fx_source,''),'MANUAL') ELSE v_order.fx_source END,
    fx_locked_at=CASE WHEN v_base_currency<>p_currency THEN now() ELSE v_order.fx_locked_at END,
    notes=CASE WHEN nullif(btrim(p_note),'') IS NULL THEN v_order.notes
      ELSE concat_ws(E'\n',v_order.notes,btrim(p_note)) END
    WHERE id=p_order_id;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data)
    VALUES (p_actor,'esteira','order',p_order_id,'order.payment.confirm',
      to_jsonb(v_order),jsonb_build_object('paid_at',p_paid_at,'amount_cents',p_amount_cents,
        'currency',p_currency,'fx_rate',p_fx_rate,'note',p_note));
END $function$;

CREATE OR REPLACE FUNCTION public.esteira_delete_order(
  p_order_id uuid,p_actor uuid,p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_order public.orders%ROWTYPE; v_tx public.finance_transactions%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR NOT (public.has_role(p_actor,'admin') OR public.has_module_access(p_actor,'esteira')) THEN
    RAISE EXCEPTION 'Sem permissao para excluir pedido';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Pedido nao encontrado ou ja excluido'; END IF;
  IF v_order.payment_provider_payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Pagamento confirmado por provedor exige fluxo proprio';
  END IF;
  IF v_order.paid_at IS NOT NULL OR COALESCE(v_order.settled_amount_cents,0)>0 THEN
    RAISE EXCEPTION 'Pedido com historico de recebimento deve ser revisado antes da exclusao';
  END IF;
  IF v_order.payment_status='aprovado' AND NOT
    (v_order.amount_cents=0 AND COALESCE(v_order.payment_amount_cents,0)=0
      AND v_order.payment_method='gratuito' AND v_order.executed_at IS NULL
      AND v_order.delivery_status<>'concluido') THEN
    RAISE EXCEPTION 'Estorne a baixa antes de excluir o pedido';
  END IF;
  IF v_order.executed_at IS NOT NULL OR v_order.delivery_status='concluido' THEN
    RAISE EXCEPTION 'Pedido executado nao pode ser excluido';
  END IF;
  SELECT * INTO v_tx FROM public.finance_transactions
    WHERE source_module='orders' AND source_id=p_order_id FOR UPDATE;
  IF FOUND AND (v_tx.paid_at IS NOT NULL OR v_tx.settled_amount_cents>0 OR
      (v_tx.status IN ('received','paid') AND NOT (v_order.payment_method='gratuito' AND v_tx.amount_cents=0))) THEN
    RAISE EXCEPTION 'Receita realizada nao pode ser excluida';
  END IF;
  UPDATE public.orders SET deleted_at=now(),deleted_by=p_actor,payment_status='recusado'
    WHERE id=p_order_id;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data)
    VALUES (p_actor,'esteira','order',p_order_id,'order.delete',to_jsonb(v_order),
      jsonb_build_object('reason',p_reason,'deleted_at',now()));
END $function$;

REVOKE ALL ON FUNCTION public.finance_sync_order(uuid),public.on_order_approved(),
  public.on_order_approved_after(),public.esteira_settle_order(uuid,uuid,date,integer,text,numeric,date,numeric,text,text),
  public.esteira_delete_order(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_sync_order(uuid),public.esteira_settle_order(uuid,uuid,date,integer,text,numeric,date,numeric,text,text),
  public.esteira_delete_order(uuid,uuid,text) TO service_role;
