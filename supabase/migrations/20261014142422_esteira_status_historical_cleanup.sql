-- Hotfix Pedidos & Esteira: one atomic operation per order action, then guarded legacy cleanup.
-- This file intentionally does not remove legacy enum values or provider integrations.

CREATE OR REPLACE FUNCTION public.esteira_create_order(
  p_payload jsonb, p_actor uuid, p_initiated_from text DEFAULT 'esteira', p_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_method text := p_payload->>'payment_method';
  v_amount integer := (p_payload->>'amount_cents')::integer;
  v_charge integer := (p_payload->>'payment_amount_cents')::integer;
  v_settled integer := (p_payload->>'settled_amount_cents')::integer;
  v_currency text := p_payload->>'currency';
  v_charge_currency text := p_payload->>'payment_currency';
  v_settled_currency text := p_payload->>'settled_currency';
  v_rate numeric := (p_payload->>'fx_rate')::numeric;
BEGIN
  IF p_actor IS NULL OR NOT (public.has_role(p_actor,'admin') OR public.has_module_access(p_actor,'esteira')) THEN
    RAISE EXCEPTION 'Sem permissao para criar pedidos';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR v_method IS NULL OR v_method NOT IN ('pendente','received','gratuito')
    OR v_amount IS NULL OR v_amount < 0 OR v_charge IS NULL OR v_charge < 0
    OR v_currency IS NULL OR v_currency NOT IN ('BRL','EUR')
    OR v_charge_currency IS NULL OR v_charge_currency NOT IN ('BRL','EUR')
    OR nullif(btrim(p_payload->>'customer_name'),'') IS NULL
    OR nullif(btrim(p_payload->>'service_title'),'') IS NULL
    OR p_initiated_from IS NULL OR p_initiated_from NOT IN ('esteira','financeiro') THEN
    RAISE EXCEPTION 'Dados de pedido invalidos';
  END IF;
  IF (v_method='gratuito' AND (v_amount<>0 OR v_charge<>0 OR v_settled IS NOT NULL OR p_payload->>'paid_at' IS NOT NULL))
    OR (v_method='pendente' AND (v_amount<=0 OR v_charge<=0 OR v_settled IS NOT NULL OR p_payload->>'paid_at' IS NOT NULL))
    OR (v_method='received' AND (v_amount<=0 OR v_charge<=0 OR coalesce(v_settled,0)<=0
      OR v_settled_currency IS NULL OR v_settled_currency NOT IN ('BRL','EUR')
      OR p_payload->>'paid_at' IS NULL)) THEN
    RAISE EXCEPTION 'Estado de pagamento incoerente com valores';
  END IF;
  IF (v_currency<>v_charge_currency OR (v_method='received' AND v_charge_currency<>v_settled_currency))
    AND coalesce(v_rate,0)<=0 THEN
    RAISE EXCEPTION 'Cotacao aplicada obrigatoria para conversao';
  END IF;

  INSERT INTO public.orders(
    user_id,customer_name,customer_email,service_id,service_title,amount_cents,currency,
    slot_id,notes,payment_status,payment_method,payment_currency,payment_amount_cents,
    settled_amount_cents,settled_currency,payment_account_id,fx_reference_rate,
    fx_reference_date,fx_rate,fx_source,fx_locked_at,paid_at
  ) VALUES (
    (p_payload->>'user_id')::uuid,p_payload->>'customer_name',p_payload->>'customer_email',
    (p_payload->>'service_id')::uuid,p_payload->>'service_title',v_amount,v_currency,
    (p_payload->>'slot_id')::uuid,p_payload->>'notes',
    CASE WHEN v_method='pendente' THEN 'pendente'::public.order_payment_status
      ELSE 'aprovado'::public.order_payment_status END,
    v_method,v_charge_currency,v_charge,
    CASE WHEN v_method='received' THEN v_settled END,
    CASE WHEN v_method='received' THEN v_settled_currency END,NULL,
    (p_payload->>'fx_reference_rate')::numeric,(p_payload->>'fx_reference_date')::date,
    v_rate,p_payload->>'fx_source',CASE WHEN v_rate IS NOT NULL THEN now() END,
    CASE WHEN v_method='received' THEN (p_payload->>'paid_at')::timestamptz END
  ) RETURNING * INTO v_order;

  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,new_data)
    VALUES (p_actor,'esteira','order',v_order.id,
      CASE WHEN p_initiated_from='financeiro' THEN 'order.create.financeiro'
        ELSE 'order.create.' || v_method END,
      jsonb_build_object('order',to_jsonb(v_order),'reason',p_reason));
  RETURN v_order.id;
END $function$;

-- A zero-value courtesy is not a receivable, including before legacy cleanup runs.
CREATE OR REPLACE FUNCTION public.finance_sync_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_order public.orders%ROWTYPE; v_status text; v_amount integer; v_currency text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_order.deleted_at IS NOT NULL THEN
    DELETE FROM public.finance_transactions WHERE source_module='orders' AND source_id=p_order_id
      AND status='pending' AND paid_at IS NULL AND settled_amount_cents IS NULL;
    RETURN;
  END IF;
  v_amount := coalesce(v_order.payment_amount_cents,v_order.amount_cents,0);
  v_currency := coalesce(v_order.payment_currency,v_order.currency,'EUR');
  v_status := CASE
    WHEN v_amount=0 THEN 'canceled'
    WHEN v_order.payment_status='aprovado' THEN 'received'
    WHEN v_order.payment_status='pendente' THEN 'pending'
    ELSE 'canceled' END;
  INSERT INTO public.finance_transactions(
    type,status,description,amount_cents,currency,amount_brl_cents,
    settled_amount_cents,settled_currency,reference_amount_cents,reference_currency,
    fx_reference_rate,fx_rate,fx_source,fx_date,due_date,paid_at,
    category_id,account_id,payment_method,source_module,source_id,is_automatic,notes,created_by
  ) VALUES (
    'income',v_status,'Pedido ' || coalesce(v_order.service_title,v_order.id::text),
    v_amount,v_currency,CASE WHEN v_currency='BRL' THEN v_amount END,
    CASE WHEN v_status='received' THEN v_order.settled_amount_cents END,
    CASE WHEN v_status='received' THEN v_order.settled_currency END,
    v_order.amount_cents,v_order.currency,v_order.fx_reference_rate,v_order.fx_rate,
    v_order.fx_source,v_order.fx_reference_date,(v_order.created_at AT TIME ZONE 'UTC')::date,
    CASE WHEN v_status='received' THEN v_order.paid_at END,
    public.finance_category_id('Pedidos/Servicos','income'),NULL,
    coalesce(v_order.payment_method,v_order.payment_provider),'orders',v_order.id,
    true,v_order.notes,v_order.user_id
  ) ON CONFLICT (source_module,source_id) WHERE source_id IS NOT NULL DO UPDATE SET
    status=excluded.status,description=excluded.description,amount_cents=excluded.amount_cents,
    currency=excluded.currency,amount_brl_cents=excluded.amount_brl_cents,
    settled_amount_cents=excluded.settled_amount_cents,settled_currency=excluded.settled_currency,
    reference_amount_cents=excluded.reference_amount_cents,reference_currency=excluded.reference_currency,
    fx_reference_rate=excluded.fx_reference_rate,fx_rate=excluded.fx_rate,fx_source=excluded.fx_source,
    fx_date=excluded.fx_date,due_date=excluded.due_date,paid_at=excluded.paid_at,
    payment_method=excluded.payment_method,notes=excluded.notes,updated_at=now();
  -- Existing account_id remains historical; no new financial account is selected.
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
  IF NOT FOUND OR v_order.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pedido nao encontrado ou ja excluido';
  END IF;
  IF v_order.payment_provider_payment_id IS NOT NULL OR EXISTS(
    SELECT 1 FROM public.order_payment_links WHERE order_id=p_order_id AND status='active')
    OR EXISTS(SELECT 1 FROM public.mercadopago_payments WHERE order_id=p_order_id) THEN
    RAISE EXCEPTION 'Pagamento externo ativo ou confirmado exige fluxo proprio';
  END IF;
  IF v_order.paid_at IS NOT NULL OR coalesce(v_order.settled_amount_cents,0)>0 THEN
    RAISE EXCEPTION 'Pedido com historico de recebimento deve ser revisado antes da exclusao';
  END IF;
  IF v_order.executed_at IS NOT NULL OR v_order.delivery_status='concluido' THEN
    RAISE EXCEPTION 'Pedido executado nao pode ser excluido';
  END IF;
  IF NOT (v_order.payment_status='pendente' OR
    (v_order.payment_status='aprovado' AND v_order.payment_method='gratuito'
      AND v_order.amount_cents=0 AND coalesce(v_order.payment_amount_cents,0)=0)) THEN
    RAISE EXCEPTION 'Estorne a baixa antes de excluir o pedido';
  END IF;
  SELECT * INTO v_tx FROM public.finance_transactions
    WHERE source_module='orders' AND source_id=p_order_id FOR UPDATE;
  IF FOUND AND (v_tx.paid_at IS NOT NULL OR coalesce(v_tx.settled_amount_cents,0)>0
    OR v_tx.status IN ('received','paid')) THEN
    RAISE EXCEPTION 'Receita realizada nao pode ser excluida';
  END IF;
  UPDATE public.orders SET deleted_at=now(),deleted_by=p_actor,payment_status='recusado'
    WHERE id=p_order_id;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data)
    VALUES (p_actor,'esteira','order',p_order_id,'order.delete',to_jsonb(v_order),
      jsonb_build_object('reason',p_reason,'deleted_at',now()));
END $function$;

-- Preserve the existing settlement reversal for other sources; harden only Orders.
CREATE OR REPLACE FUNCTION public.finance_reverse_settlement(
  p_id uuid,p_actor uuid,p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tx public.finance_transactions%ROWTYPE; v_order public.orders%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR length(btrim(coalesce(p_reason,'')))<3 THEN
    RAISE EXCEPTION 'Actor and reason are required';
  END IF;
  SELECT * INTO v_tx FROM public.finance_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_tx.status NOT IN ('received','paid') THEN
    RAISE EXCEPTION 'Only realized transactions can be reversed';
  END IF;
  IF v_tx.source_module='pdv' THEN RAISE EXCEPTION 'PDV must be changed at its source'; END IF;
  IF v_tx.source_module='orders' THEN
    IF NOT (public.has_role(p_actor,'admin') OR public.has_module_access(p_actor,'esteira')) THEN
      RAISE EXCEPTION 'Sem permissao para estornar baixa de pedido';
    END IF;
    SELECT * INTO v_order FROM public.orders WHERE id=v_tx.source_id FOR UPDATE;
    IF NOT FOUND OR v_order.deleted_at IS NOT NULL OR v_order.payment_status<>'aprovado'
      OR v_order.payment_method='gratuito' THEN
      RAISE EXCEPTION 'Pedido recebido e ativo nao encontrado';
    END IF;
    IF v_order.payment_provider_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Provider-confirmed payment requires its commercial refund flow';
    END IF;
    UPDATE public.orders SET payment_status='pendente',paid_at=NULL,
      settled_amount_cents=NULL,settled_currency=NULL,payment_account_id=NULL,
      fx_reference_rate=NULL,fx_reference_date=NULL,fx_rate=NULL,fx_source=NULL,fx_locked_at=NULL
      WHERE id=v_order.id;
  ELSIF v_tx.source_module='manual' OR v_tx.source_module='team_payout'
    OR v_tx.source_module LIKE 'recurring:%' THEN
    UPDATE public.finance_transactions SET status='pending',settled_amount_cents=NULL,
      settled_currency=NULL,paid_at=NULL,account_id=NULL,fx_reference_rate=NULL,
      fx_rate=NULL,fx_source=NULL,fx_date=NULL WHERE id=p_id;
  ELSE
    RAISE EXCEPTION 'Transaction source must be corrected at origin';
  END IF;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data)
    VALUES (p_actor,'financeiro','finance_transaction',p_id,'finance.transaction.reverse',
      to_jsonb(v_tx),jsonb_build_object('reason',p_reason,'new_status','pending'));
END $function$;

REVOKE ALL ON FUNCTION public.esteira_create_order(jsonb,uuid,text,text),
  public.finance_sync_order(uuid),public.esteira_delete_order(uuid,uuid,text),
  public.finance_reverse_settlement(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.esteira_create_order(jsonb,uuid,text,text),
  public.finance_sync_order(uuid),public.esteira_delete_order(uuid,uuid,text),
  public.finance_reverse_settlement(uuid,uuid,text) TO service_role;

-- The live dashboard keeps its contract, but excludes archived and non-financial orders
-- from the "Serviços mais vendidos" ranking.
CREATE OR REPLACE FUNCTION public.finance_dashboard_month(p_month date)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_daily jsonb; v_services jsonb; v_expenses jsonb;
  v_recurring jsonb; v_team jsonb; v_totals jsonb;
BEGIN
  IF p_month IS NULL OR extract(day FROM p_month) <> 1 THEN
    RAISE EXCEPTION 'Month must be its first day';
  END IF;
  PERFORM public.finance_ensure_month(p_month, NULL);
  SELECT jsonb_object_agg(c.currency, jsonb_build_object(
    'received', coalesce(realized.received, 0),
    'paid', coalesce(realized.paid, 0),
    'receivable', coalesce(obligations.receivable, 0),
    'payable', coalesce(obligations.payable, 0),
    'realizedBalance', coalesce(realized.received, 0) - coalesce(realized.paid, 0)
  )) INTO v_totals
  FROM (VALUES ('BRL'::text), ('EUR'::text)) c(currency)
  LEFT JOIN LATERAL (
    SELECT sum(settled_amount_cents) FILTER (WHERE type = 'income')::bigint AS received,
      sum(settled_amount_cents) FILTER (WHERE type = 'expense')::bigint AS paid
    FROM public.finance_transactions
    WHERE status IN ('received','paid') AND settled_currency = c.currency
      AND paid_at >= p_month AND paid_at < p_month + interval '1 month'
  ) realized ON true
  LEFT JOIN LATERAL (
    SELECT sum(amount_cents) FILTER (WHERE type = 'income')::bigint AS receivable,
      sum(amount_cents) FILTER (WHERE type = 'expense')::bigint AS payable
    FROM public.finance_transactions
    WHERE status = 'pending' AND currency = c.currency
      AND due_date >= p_month AND due_date < p_month + interval '1 month'
  ) obligations ON true;

  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.day, d.currency), '[]'::jsonb)
    INTO v_daily FROM (
    SELECT paid_at::date AS day, settled_currency AS currency,
      sum(settled_amount_cents) FILTER (WHERE type = 'income')::bigint AS income_cents,
      sum(settled_amount_cents) FILTER (WHERE type = 'expense')::bigint AS expense_cents
    FROM public.finance_transactions
    WHERE status IN ('received','paid') AND paid_at >= p_month
      AND paid_at < p_month + interval '1 month' AND settled_currency IN ('BRL','EUR')
    GROUP BY paid_at::date, settled_currency
  ) d;

  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sales_count DESC, s.service_title), '[]'::jsonb)
    INTO v_services FROM (
    SELECT o.service_id, coalesce(max(o.service_title), 'Serviço sem nome') AS service_title,
      count(*)::integer AS sales_count,
      count(*) FILTER (WHERE o.payment_status = 'aprovado')::integer AS paid_count,
      count(*) FILTER (WHERE o.payment_status = 'pendente')::integer AS pending_count,
      jsonb_build_object(
        'BRL', jsonb_build_object(
          'sold_cents', coalesce(sum(coalesce(o.payment_amount_cents,o.amount_cents)) FILTER
            (WHERE coalesce(o.payment_currency,o.currency) = 'BRL'),0),
          'received_cents', coalesce(sum(o.settled_amount_cents) FILTER
            (WHERE o.payment_status = 'aprovado' AND o.settled_currency = 'BRL'),0),
          'receivable_cents', coalesce(sum(coalesce(o.payment_amount_cents,o.amount_cents)) FILTER
            (WHERE o.payment_status = 'pendente' AND coalesce(o.payment_currency,o.currency) = 'BRL'),0)),
        'EUR', jsonb_build_object(
          'sold_cents', coalesce(sum(coalesce(o.payment_amount_cents,o.amount_cents)) FILTER
            (WHERE coalesce(o.payment_currency,o.currency) = 'EUR'),0),
          'received_cents', coalesce(sum(o.settled_amount_cents) FILTER
            (WHERE o.payment_status = 'aprovado' AND o.settled_currency = 'EUR'),0),
          'receivable_cents', coalesce(sum(coalesce(o.payment_amount_cents,o.amount_cents)) FILTER
            (WHERE o.payment_status = 'pendente' AND coalesce(o.payment_currency,o.currency) = 'EUR'),0))
      ) AS currencies
    FROM public.orders o
    WHERE o.created_at >= p_month AND o.created_at < p_month + interval '1 month'
      AND o.deleted_at IS NULL AND o.payment_status IN ('aprovado','pendente')
      AND coalesce(o.payment_amount_cents,o.amount_cents,0)>0
      AND coalesce(o.payment_currency,o.currency) IN ('BRL','EUR')
    GROUP BY o.service_id, CASE WHEN o.service_id IS NULL THEN o.service_title END
  ) s;

  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.currency, e.amount_cents DESC), '[]'::jsonb)
    INTO v_expenses FROM (
    SELECT t.category_id, coalesce(c.name, 'Sem categoria') AS category_name,
      CASE WHEN t.status = 'paid' THEN t.settled_currency ELSE t.currency END AS currency,
      sum(CASE WHEN t.status = 'paid' THEN t.settled_amount_cents ELSE t.amount_cents END)::bigint AS amount_cents
    FROM public.finance_transactions t
    LEFT JOIN public.finance_categories c ON c.id = t.category_id
    WHERE t.type = 'expense' AND t.status IN ('paid','pending')
      AND t.source_module <> 'partner_distribution'
      AND t.due_date >= p_month AND t.due_date < p_month + interval '1 month'
      AND (CASE WHEN t.status = 'paid' THEN t.settled_currency ELSE t.currency END) IN ('BRL','EUR')
    GROUP BY t.category_id, c.name,
      CASE WHEN t.status = 'paid' THEN t.settled_currency ELSE t.currency END
  ) e;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.currency), '[]'::jsonb)
    INTO v_recurring FROM (
    SELECT c.currency,
      coalesce((SELECT sum(t.settled_amount_cents) FROM public.finance_transactions t
        WHERE t.source_module LIKE 'recurring:%' AND t.status = 'paid'
          AND t.settled_currency = c.currency AND t.paid_at >= p_month
          AND t.paid_at < p_month + interval '1 month'), 0)::bigint AS paid_cents,
      coalesce((SELECT sum(t.amount_cents) FROM public.finance_transactions t
        WHERE t.source_module LIKE 'recurring:%' AND t.status = 'pending'
          AND t.currency = c.currency AND t.due_date >= p_month
          AND t.due_date < p_month + interval '1 month'), 0)::bigint AS pending_cents
    FROM (VALUES ('BRL'::text), ('EUR'::text)) c(currency)
  ) r;

  SELECT coalesce(jsonb_agg(to_jsonb(team) ORDER BY team.currency), '[]'::jsonb)
    INTO v_team FROM (
    SELECT c.currency,
      coalesce((SELECT sum(t.amount_cents) FROM public.finance_transactions t
        WHERE t.source_module = 'team_payout' AND t.status = 'pending'
          AND t.currency = c.currency AND t.due_date >= p_month
          AND t.due_date < p_month + interval '1 month'), 0)::bigint AS payable_cents,
      coalesce((SELECT sum(t.settled_amount_cents) FROM public.finance_transactions t
        WHERE t.source_module = 'team_payout' AND t.status = 'paid'
          AND t.settled_currency = c.currency AND t.paid_at >= p_month
          AND t.paid_at < p_month + interval '1 month'), 0)::bigint AS paid_cents
    FROM (VALUES ('BRL'::text), ('EUR'::text)) c(currency)
  ) team;
  RETURN jsonb_build_object('totals', v_totals, 'daily', v_daily,
    'services', v_services, 'expenses', v_expenses,
    'recurring', v_recurring, 'team', v_team,
    'snapshot', public.finance_month_snapshot(p_month, false));
END $function$;

REVOKE ALL ON FUNCTION public.finance_dashboard_month(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_dashboard_month(date) TO service_role;

-- Guarded, repeatable cleanup of four classified rows. The EUR 100 pending order is
-- checked but never updated. Old row images remain in audit_logs.
DO $cleanup$
DECLARE
  v_id uuid;
  v_order public.orders%ROWTYPE;
  v_tx public.finance_transactions%ROWTYPE;
  v_before_paid integer;
  v_after_paid integer;
  v_before_brl bigint;
  v_before_eur bigint;
  v_after_brl bigint;
  v_after_eur bigint;
  v_old jsonb;
  v_target_ids uuid[] := ARRAY[
    '473f92f9-7b87-4642-a8c4-cf0aee2c418e'::uuid,
    'f766a6e6-89a3-45bf-982d-d18721bd5f08'::uuid,
    '9d04ca1a-c510-4214-b894-230d83a087b4'::uuid,
    'f8ab0491-f03d-4008-824d-ad4b7e1c688f'::uuid,
    'bbc0354a-4f8d-4007-931d-6f60c334c520'::uuid
  ];
BEGIN
  -- Supabase GitHub Preview branches are data-less by default. A non-empty database
  -- must match the exact guarded production candidates; only a truly empty one skips.
  IF NOT EXISTS (SELECT 1 FROM public.orders) THEN RETURN; END IF;
  SELECT count(*),coalesce(sum(settled_amount_cents) FILTER (WHERE settled_currency='BRL'),0),
    coalesce(sum(settled_amount_cents) FILTER (WHERE settled_currency='EUR'),0)
    INTO v_before_paid,v_before_brl,v_before_eur
    FROM public.finance_transactions WHERE source_module='orders' AND status='received';
  IF (SELECT count(*) FROM public.orders WHERE id=ANY(v_target_ids))<>5 THEN
    RAISE EXCEPTION 'Hotfix preflight: os cinco pedidos alvo nao foram encontrados';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_payment_links WHERE order_id=ANY(v_target_ids))
    OR EXISTS (SELECT 1 FROM public.mercadopago_payments WHERE order_id=ANY(v_target_ids)) THEN
    RAISE EXCEPTION 'Hotfix preflight: existe pagamento ou link externo nos pedidos alvo';
  END IF;

  FOREACH v_id IN ARRAY v_target_ids LOOP
    SELECT * INTO STRICT v_order FROM public.orders WHERE id=v_id FOR UPDATE;
    SELECT * INTO STRICT v_tx FROM public.finance_transactions
      WHERE source_module='orders' AND source_id=v_id FOR UPDATE;
    IF v_order.payment_provider_payment_id IS NOT NULL OR v_order.executed_at IS NOT NULL
      OR v_order.delivery_status='concluido' THEN
      RAISE EXCEPTION 'Hotfix preflight: provedor ou execucao no pedido %',v_id;
    END IF;

    IF v_id='9d04ca1a-c510-4214-b894-230d83a087b4'::uuid THEN
      IF v_order.deleted_at IS NOT NULL OR v_order.payment_status<>'pendente'
        OR v_order.customer_name IS DISTINCT FROM 'Tomaz Leandro Cavalcante Souza'
        OR v_order.service_title IS DISTINCT FROM 'Reunião para Trâmites de Visto'
        OR v_order.amount_cents<>10000 OR v_order.payment_amount_cents IS DISTINCT FROM 10000
        OR v_order.currency<>'EUR' OR v_order.payment_currency IS DISTINCT FROM 'EUR'
        OR v_order.paid_at IS NOT NULL OR v_order.settled_amount_cents IS NOT NULL
        OR v_tx.status<>'pending' OR v_tx.amount_cents<>10000
        OR v_tx.paid_at IS NOT NULL OR v_tx.settled_amount_cents IS NOT NULL THEN
        RAISE EXCEPTION 'Hotfix preflight: pendente EUR 100 mudou';
      END IF;
      CONTINUE;
    END IF;

    IF v_id IN ('473f92f9-7b87-4642-a8c4-cf0aee2c418e'::uuid,
      'f766a6e6-89a3-45bf-982d-d18721bd5f08'::uuid) THEN
      IF v_order.payment_status<>'recusado' OR v_order.amount_cents<>0
        OR coalesce(v_order.payment_amount_cents,-1)<>0 OR v_order.currency<>'EUR'
        OR v_order.payment_currency IS DISTINCT FROM 'EUR' OR v_order.paid_at IS NOT NULL
        OR v_order.settled_amount_cents IS NOT NULL OR v_order.payment_provider IS DISTINCT FROM 'wise'
        OR v_order.service_title IS DISTINCT FROM 'Consultoria de Abertura de Conta Bancária'
        OR (v_id='473f92f9-7b87-4642-a8c4-cf0aee2c418e'::uuid
          AND v_order.customer_name IS DISTINCT FROM 'Marcus Vinicius Veloso')
        OR (v_id='f766a6e6-89a3-45bf-982d-d18721bd5f08'::uuid
          AND v_order.customer_name IS DISTINCT FROM 'Evaldo Luis Oliveira da Silva')
        OR v_tx.status<>'canceled' OR v_tx.amount_cents<>0
        OR v_tx.paid_at IS NOT NULL OR v_tx.settled_amount_cents IS NOT NULL THEN
        RAISE EXCEPTION 'Hotfix preflight: cortesia recusada % mudou',v_id;
      END IF;
      IF v_order.deleted_at IS NULL THEN
        v_old := to_jsonb(v_order);
        UPDATE public.orders SET deleted_at=now(),deleted_by=NULL WHERE id=v_id;
        INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data,metadata)
          VALUES (NULL,'esteira','order',v_id,'order.hotfix.archive_zero',v_old,
            jsonb_build_object('deleted_at',(SELECT deleted_at FROM public.orders WHERE id=v_id)),
            jsonb_build_object('migration','20261014142422'));
      END IF;
      CONTINUE;
    END IF;

    IF v_id='f8ab0491-f03d-4008-824d-ad4b7e1c688f'::uuid THEN
      IF v_order.amount_cents<>0 OR coalesce(v_order.payment_amount_cents,-1)<>0
        OR v_order.customer_name IS DISTINCT FROM 'Andre Achutti'
        OR v_order.service_title IS DISTINCT FROM 'Consultoria de Abertura de Conta Bancária'
        OR v_order.currency<>'EUR' OR v_order.payment_currency IS DISTINCT FROM 'EUR'
        OR v_order.paid_at IS NOT NULL OR v_order.settled_amount_cents IS NOT NULL
        OR v_tx.amount_cents<>0 OR v_tx.paid_at IS NOT NULL
        OR v_tx.settled_amount_cents IS NOT NULL THEN
        RAISE EXCEPTION 'Hotfix preflight: cortesia pendente mudou';
      END IF;
      IF v_order.payment_status='aprovado' AND v_order.payment_method='gratuito'
        AND v_order.deleted_at IS NULL AND v_tx.status='canceled' THEN CONTINUE; END IF;
      IF v_order.payment_status<>'pendente' OR v_order.deleted_at IS NOT NULL
        OR v_tx.status<>'pending' THEN
        RAISE EXCEPTION 'Hotfix preflight: estado inesperado da cortesia pendente';
      END IF;
      v_old := to_jsonb(v_order);
      UPDATE public.orders SET payment_status='aprovado',payment_method='gratuito' WHERE id=v_id;
      INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data,metadata)
        VALUES (NULL,'esteira','order',v_id,'order.hotfix.classify_courtesy',v_old,
          jsonb_build_object('payment_status','aprovado','payment_method','gratuito'),
          jsonb_build_object('migration','20261014142422'));
      CONTINUE;
    END IF;

    IF v_id='bbc0354a-4f8d-4007-931d-6f60c334c520'::uuid THEN
      IF v_order.payment_status<>'recusado' OR v_order.amount_cents<>20000
        OR v_order.customer_name IS DISTINCT FROM 'Gabriel Facioli'
        OR v_order.service_title IS DISTINCT FROM 'Recepção no Aeroporto'
        OR v_order.currency<>'EUR' OR v_order.payment_amount_cents IS DISTINCT FROM 114000
        OR v_order.payment_currency IS DISTINCT FROM 'BRL' OR v_tx.status<>'canceled'
        OR v_tx.amount_cents<>114000 OR v_tx.paid_at IS NOT NULL
        OR v_tx.settled_amount_cents IS NOT NULL
        OR v_order.payment_provider IS NOT NULL THEN
        RAISE EXCEPTION 'Hotfix preflight: teste Gabriel divergiu';
      END IF;
      IF v_order.deleted_at IS NOT NULL AND v_order.paid_at IS NULL
        AND v_order.settled_amount_cents IS NULL AND v_order.payment_method IS NULL THEN CONTINUE; END IF;
      IF v_order.deleted_at IS NOT NULL OR v_order.payment_method IS DISTINCT FROM 'received'
        OR v_order.paid_at::date IS DISTINCT FROM '2026-10-13'::date
        OR v_order.settled_amount_cents IS DISTINCT FROM 114000
        OR v_order.settled_currency IS DISTINCT FROM 'BRL'
        OR v_order.fx_rate IS DISTINCT FROM 5.7
        OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id=v_id
          AND action='order.cancel' AND new_data->>'reason'='Teste') THEN
        RAISE EXCEPTION 'Hotfix preflight: nao comprovado cancelamento de teste Gabriel';
      END IF;
      v_old := to_jsonb(v_order);
      UPDATE public.orders SET payment_method=NULL,paid_at=NULL,settled_amount_cents=NULL,
        settled_currency=NULL,payment_account_id=NULL,fx_reference_rate=NULL,
        fx_reference_date=NULL,fx_rate=NULL,fx_source=NULL,fx_locked_at=NULL,
        deleted_at=now(),deleted_by=NULL WHERE id=v_id;
      INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data,metadata)
        VALUES (NULL,'esteira','order',v_id,'order.hotfix.archive_test',v_old,
          jsonb_build_object('deleted_at',(SELECT deleted_at FROM public.orders WHERE id=v_id),
            'reason','Teste cancelado sem pagamento confirmado'),
          jsonb_build_object('migration','20261014142422'));
    END IF;
  END LOOP;

  SELECT count(*),coalesce(sum(settled_amount_cents) FILTER (WHERE settled_currency='BRL'),0),
    coalesce(sum(settled_amount_cents) FILTER (WHERE settled_currency='EUR'),0)
    INTO v_after_paid,v_after_brl,v_after_eur
    FROM public.finance_transactions WHERE source_module='orders' AND status='received';
  IF (v_before_paid,v_before_brl,v_before_eur) IS DISTINCT FROM
    (v_after_paid,v_after_brl,v_after_eur) THEN
    RAISE EXCEPTION 'Hotfix cleanup alterou recebimentos reais';
  END IF;
END $cleanup$;
