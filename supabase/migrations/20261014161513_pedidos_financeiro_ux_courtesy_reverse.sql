-- Keep the existing reversal contract, but make the reason optional for the UI.
-- The canonical transaction and its audit row continue to change atomically.
CREATE OR REPLACE FUNCTION public.finance_reverse_settlement(
  p_id uuid, p_actor uuid, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_tx public.finance_transactions%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Estorno solicitado pelo administrador');
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Actor is required';
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
      to_jsonb(v_tx),jsonb_build_object('reason',v_reason,'new_status','pending'));
END $function$;

REVOKE ALL ON FUNCTION public.finance_reverse_settlement(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_reverse_settlement(uuid,uuid,text) TO service_role;

-- The order itself remains soft-deleted and audited; only its non-financial,
-- canceled zero-value mirror is removed from operational Finance queries.
CREATE FUNCTION public.finance_remove_deleted_courtesy_mirror()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
    AND NEW.amount_cents=0 AND coalesce(NEW.payment_amount_cents,0)=0
    AND NEW.paid_at IS NULL AND NEW.settled_amount_cents IS NULL THEN
    DELETE FROM public.finance_transactions
      WHERE source_module='orders' AND source_id=NEW.id AND amount_cents=0
        AND status='canceled' AND paid_at IS NULL AND settled_amount_cents IS NULL;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.finance_remove_deleted_courtesy_mirror() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_finance_remove_deleted_courtesy_mirror
  AFTER UPDATE OF deleted_at ON public.orders FOR EACH ROW
  EXECUTE FUNCTION public.finance_remove_deleted_courtesy_mirror();

DELETE FROM public.finance_transactions t USING public.orders o
  WHERE t.source_module='orders' AND t.source_id=o.id AND o.deleted_at IS NOT NULL
    AND o.amount_cents=0 AND coalesce(o.payment_amount_cents,0)=0
    AND t.amount_cents=0 AND t.status='canceled'
    AND t.paid_at IS NULL AND t.settled_amount_cents IS NULL
    AND o.paid_at IS NULL AND o.settled_amount_cents IS NULL;
