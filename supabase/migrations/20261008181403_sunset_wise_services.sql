-- Retain legacy Wise/payment history, but make new Wise activity impossible.
ALTER TABLE public.services
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

DROP FUNCTION public.pdv_request_wise_payment(uuid, uuid, text, numeric, text, text);
DROP FUNCTION public.pdv_cancel_wise_attempt(uuid, uuid, text);
DROP FUNCTION public.pdv_confirm_wise_payment(text, integer, text, jsonb);
DROP FUNCTION public.wise_next_reference();

-- Keep historical rows readable, but no authenticated client may create or
-- reconcile a new Wise payment/event/attempt through PostgREST.
DROP POLICY IF EXISTS "Staff manage wise_events" ON public.wise_events;
DROP POLICY IF EXISTS "Staff manage wise_payments" ON public.wise_payments;
DROP POLICY IF EXISTS pdv_payment_attempts_staff_write ON public.pdv_payment_attempts;
REVOKE INSERT, UPDATE, DELETE ON public.wise_events, public.wise_payments,
  public.pdv_payment_attempts FROM anon, authenticated;

DELETE FROM public.integration_settings WHERE provider = 'wise';
ALTER TABLE public.integration_settings DROP CONSTRAINT integration_settings_provider_check;
ALTER TABLE public.integration_settings ADD CONSTRAINT integration_settings_provider_check
  CHECK (provider IN ('mercadopago', 'whatsapp', 'uazapi'));

-- Lock the exact historic rows before changing dates. No values, items,
-- stock, customer, codes or payment methods are modified.
DO $$
DECLARE
  v_dionny public.pdv_sales%ROWTYPE;
  v_camila public.pdv_sales%ROWTYPE;
  v_tab public.pdv_tabs%ROWTYPE;
  v_tx public.finance_transactions%ROWTYPE;
BEGIN
  -- Supabase Preview starts without PDV data. A populated database must
  -- contain the exact two guarded sales; it can never silently skip them.
  IF NOT EXISTS (SELECT 1 FROM public.pdv_sales) THEN RETURN; END IF;
  SELECT * INTO v_dionny FROM public.pdv_sales
    WHERE id = 'fe4298aa-ef2d-47b4-8285-cf1494d74555' FOR UPDATE;
  SELECT * INTO v_camila FROM public.pdv_sales
    WHERE id = '4a28bf1a-0df3-4280-80bc-f3addb231944' FOR UPDATE;
  IF v_dionny.id IS NULL OR v_dionny.sale_code <> 'PDV-20261008-0001'
    OR v_dionny.status <> 'concluida' OR v_dionny.total_eur_cents <> 280
    OR coalesce(v_dionny.total_brl_cents,0) <> 0
    OR v_dionny.closed_at::date NOT IN ('2026-10-08','2026-08-31')
    OR v_camila.id IS NULL OR v_camila.sale_code <> 'PDV-20261008-0002'
    OR v_camila.status <> 'concluida' OR v_camila.total_eur_cents <> 500
    OR coalesce(v_camila.total_brl_cents,0) <> 0
    OR v_camila.closed_at::date NOT IN ('2026-10-08','2026-08-31') THEN
    RAISE EXCEPTION 'PDV August backfill preflight failed: sales differ';
  END IF;

  SELECT * INTO v_tab FROM public.pdv_tabs
    WHERE id='8d9f7e1c-810b-46d3-8b87-626b992be656' FOR UPDATE;
  IF v_tab.id IS NULL OR v_tab.sale_id<>v_dionny.id
    OR v_tab.tab_code<>'CMD-20260703-0003' OR v_tab.status<>'fechada'
    OR v_tab.closed_at::date NOT IN ('2026-10-08','2026-08-31') THEN
    RAISE EXCEPTION 'PDV August backfill preflight failed: Dionny tab differs';
  END IF;
  SELECT * INTO v_tab FROM public.pdv_tabs
    WHERE id='9f5a84a2-c145-47a5-b8fd-6065ad5962bd' FOR UPDATE;
  IF v_tab.id IS NULL OR v_tab.sale_id<>v_camila.id
    OR v_tab.tab_code<>'CMD-20260713-0003' OR v_tab.status<>'fechada'
    OR v_tab.closed_at::date NOT IN ('2026-10-08','2026-08-31') THEN
    RAISE EXCEPTION 'PDV August backfill preflight failed: Camila tab differs';
  END IF;

  SELECT * INTO v_tx FROM public.finance_transactions
    WHERE id='ee530019-bc9d-4842-9f08-c7c80e16f03f' FOR UPDATE;
  IF v_tx.id IS NULL OR v_tx.source_module<>'pdv' OR v_tx.source_id<>v_dionny.id
    OR v_tx.status<>'received' OR v_tx.amount_cents<>280 OR v_tx.currency<>'EUR'
    OR v_tx.settled_amount_cents<>280 OR v_tx.settled_currency<>'EUR'
    OR v_tx.paid_at::date NOT IN ('2026-10-08','2026-08-31') THEN
    RAISE EXCEPTION 'PDV August backfill preflight failed: Dionny finance differs';
  END IF;
  SELECT * INTO v_tx FROM public.finance_transactions
    WHERE id='4582d234-3cbf-4b32-b973-5ed689e66510' FOR UPDATE;
  IF v_tx.id IS NULL OR v_tx.source_module<>'pdv' OR v_tx.source_id<>v_camila.id
    OR v_tx.status<>'received' OR v_tx.amount_cents<>500 OR v_tx.currency<>'EUR'
    OR v_tx.settled_amount_cents<>500 OR v_tx.settled_currency<>'EUR'
    OR v_tx.paid_at::date NOT IN ('2026-10-08','2026-08-31') THEN
    RAISE EXCEPTION 'PDV August backfill preflight failed: Camila finance differs';
  END IF;

  UPDATE public.pdv_sales SET closed_at='2026-08-31 12:00:00+00'
    WHERE id=v_dionny.id AND closed_at IS DISTINCT FROM '2026-08-31 12:00:00+00'::timestamptz;
  UPDATE public.pdv_tabs SET closed_at='2026-08-31 12:00:00+00'
    WHERE id='8d9f7e1c-810b-46d3-8b87-626b992be656'
      AND closed_at IS DISTINCT FROM '2026-08-31 12:00:00+00'::timestamptz;
  PERFORM public.finance_sync_pdv_sale(v_dionny.id);
  UPDATE public.pdv_sales SET closed_at='2026-08-31 12:01:00+00'
    WHERE id=v_camila.id AND closed_at IS DISTINCT FROM '2026-08-31 12:01:00+00'::timestamptz;
  UPDATE public.pdv_tabs SET closed_at='2026-08-31 12:01:00+00'
    WHERE id='9f5a84a2-c145-47a5-b8fd-6065ad5962bd'
      AND closed_at IS DISTINCT FROM '2026-08-31 12:01:00+00'::timestamptz;
  PERFORM public.finance_sync_pdv_sale(v_camila.id);

  IF EXISTS (
    SELECT 1 FROM public.finance_transactions WHERE id IN (
      'ee530019-bc9d-4842-9f08-c7c80e16f03f',
      '4582d234-3cbf-4b32-b973-5ed689e66510')
      AND (status<>'received' OR settled_currency<>'EUR'
        OR due_date<>'2026-08-31' OR paid_at::date<>'2026-08-31')
  ) THEN RAISE EXCEPTION 'PDV August backfill postflight failed'; END IF;
END $$;

-- Locking the service row also serializes FK inserts, so deletion cannot race
-- with a new order/slot. Historical references always turn deletion into archive.
CREATE FUNCTION public.service_archive_restore_or_delete(
  p_service_id uuid, p_actor uuid, p_action text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_service public.services%ROWTYPE; v_result text;
BEGIN
  IF p_actor IS NULL OR p_action NOT IN ('archive','restore','delete') THEN
    RAISE EXCEPTION 'Invalid service action';
  END IF;
  SELECT * INTO v_service FROM public.services WHERE id=p_service_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service not found'; END IF;
  IF p_action='restore' THEN
    UPDATE public.services SET archived_at=NULL,archived_by=NULL,is_active=false
      WHERE id=p_service_id;
    v_result := 'restored';
  ELSIF p_action='archive' OR EXISTS (SELECT 1 FROM public.orders WHERE service_id=p_service_id)
    OR EXISTS (SELECT 1 FROM public.appointments WHERE service_id=p_service_id)
    OR EXISTS (SELECT 1 FROM public.availability_slots WHERE service_id=p_service_id)
    OR EXISTS (SELECT 1 FROM public.finance_payout_rule_services WHERE service_id=p_service_id) THEN
    UPDATE public.services SET archived_at=coalesce(archived_at,now()),
      archived_by=p_actor,is_active=false WHERE id=p_service_id;
    v_result := 'archived';
  ELSE
    v_result := 'deleted';
  END IF;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data)
    VALUES (p_actor,'configuracoes','service',p_service_id,'services.'||v_result,
      to_jsonb(v_service),jsonb_build_object('result',v_result));
  IF v_result='deleted' THEN DELETE FROM public.services WHERE id=p_service_id; END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.service_archive_restore_or_delete(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_archive_restore_or_delete(uuid,uuid,text)
  TO service_role;
