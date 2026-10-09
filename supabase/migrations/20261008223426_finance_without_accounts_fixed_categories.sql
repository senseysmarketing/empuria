-- Accounts remain historical only. New PDV settlements and monthly occurrences have no account.
CREATE OR REPLACE FUNCTION public.pdv_settle_sale(
  p_sale_id uuid,p_actor_id uuid,p_paid_at date,p_settled_amount_cents integer,
  p_settled_currency text,p_account_id uuid DEFAULT NULL,
  p_fx_reference_rate numeric DEFAULT NULL,p_fx_reference_date date DEFAULT NULL,
  p_fx_rate numeric DEFAULT NULL,p_fx_source text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_sale public.pdv_sales%ROWTYPE;
BEGIN
  IF NOT public.has_role(p_actor_id,'admin')
    AND NOT public.has_module_access(p_actor_id,'pdv') THEN
    RAISE EXCEPTION 'Sem permissao para dar baixa no PDV';
  END IF;
  IF p_paid_at IS NULL OR p_settled_amount_cents IS NULL OR p_settled_amount_cents <= 0
    OR p_settled_currency IS NULL OR p_settled_currency NOT IN ('BRL','EUR') THEN
    RAISE EXCEPTION 'Dados de baixa invalidos';
  END IF;
  SELECT * INTO v_sale FROM public.pdv_sales WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.status <> 'pendente' THEN
    RAISE EXCEPTION 'Apenas venda pendente pode receber baixa';
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
    payment_account_id=NULL,
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
        'account_id',NULL,'fx_rate',p_fx_rate));
END $function$;

CREATE OR REPLACE FUNCTION public.finance_ensure_month(p_month date, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE v_rule public.finance_recurring_rules%ROWTYPE;
  v_due date;
  v_last_day integer;
BEGIN
  IF p_month IS NULL OR p_month <> date_trunc('month',p_month)::date THEN
    RAISE EXCEPTION 'Month must be its first day';
  END IF;
  v_last_day := extract(day FROM (p_month + interval '1 month - 1 day'))::integer;
  FOR v_rule IN SELECT * FROM public.finance_recurring_rules
    WHERE is_active AND frequency='monthly' AND starts_on<=p_month
      AND (ends_on IS NULL OR ends_on>=p_month)
      AND NOT EXISTS (SELECT 1 FROM public.finance_recurring_skips s
        WHERE s.rule_id=finance_recurring_rules.id AND s.period_month=p_month)
  LOOP
    v_due := p_month + (least(v_rule.day_of_month,v_last_day)-1);
    INSERT INTO public.finance_transactions (
      type,status,description,amount_cents,currency,due_date,category_id,
      account_id,source_module,source_id,is_automatic,notes,created_by
    ) VALUES (
      v_rule.type,'pending',v_rule.description,v_rule.amount_cents,v_rule.currency,
      v_due,v_rule.category_id,NULL,
      'recurring:'||to_char(p_month,'YYYY-MM'),v_rule.id,true,'Recorrência mensal',
      coalesce(p_actor,v_rule.created_by)
    ) ON CONFLICT (source_module,source_id) WHERE source_id IS NOT NULL DO NOTHING;
  END LOOP;
  PERFORM public.finance_sync_team_payouts(p_month,p_actor,NULL,false);
END $function$;

REVOKE ALL ON FUNCTION public.pdv_settle_sale(uuid,uuid,date,integer,text,uuid,numeric,date,numeric,text),
  public.finance_ensure_month(date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_settle_sale(uuid,uuid,date,integer,text,uuid,numeric,date,numeric,text),
  public.finance_ensure_month(date,uuid) TO service_role;
