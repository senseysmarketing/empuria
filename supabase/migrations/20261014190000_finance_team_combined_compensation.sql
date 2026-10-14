-- Etapa 2-A: independent compensation rules per person. Keep the existing
-- finance_save_team_member(jsonb,uuid) contract for the already published UI.
ALTER TABLE public.finance_payout_rules DROP CONSTRAINT finance_payout_rules_rule_type_check;
ALTER TABLE public.finance_payout_rules ADD CONSTRAINT finance_payout_rules_rule_type_check
  CHECK (rule_type IN ('fixed_monthly','goal_cap','revenue_percent','service_percent'));
ALTER TABLE public.finance_payout_rules DROP CONSTRAINT finance_payout_rules_shape_check;
ALTER TABLE public.finance_payout_rules ADD CONSTRAINT finance_payout_rules_shape_check CHECK (
  (rule_type IN ('fixed_monthly','goal_cap') AND amount_cents IS NOT NULL
    AND currency IS NOT NULL AND day_of_month IS NOT NULL AND percentage IS NULL)
  OR (rule_type IN ('revenue_percent','service_percent') AND percentage IS NOT NULL
    AND amount_cents IS NULL AND currency IS NULL AND day_of_month IS NULL)
);

CREATE TABLE IF NOT EXISTS public.finance_payout_skips (
  rule_id uuid NOT NULL REFERENCES public.finance_payout_rules(id),
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  currency text NOT NULL CHECK (currency IN ('BRL','EUR')),
  skipped_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id,period_month,currency)
);
ALTER TABLE public.finance_payout_skips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_payout_skips FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.finance_payout_skips TO service_role;

-- The payee row serializes concurrent rule edits. Same modality/currency and
-- overlapping dates are redundant; distinct modalities can coexist.
CREATE OR REPLACE FUNCTION public.finance_team_rule_overlap_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.is_active AND NEW.archived_at IS NULL THEN
    PERFORM 1 FROM public.finance_payees WHERE id=NEW.payee_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.finance_payout_rules r
      WHERE r.payee_id=NEW.payee_id AND r.id<>NEW.id
        AND r.rule_type=NEW.rule_type AND r.is_active AND r.archived_at IS NULL
        AND r.starts_on<=coalesce(NEW.ends_on,'infinity'::date)
        AND coalesce(r.ends_on,'infinity'::date)>=NEW.starts_on
        AND CASE WHEN NEW.rule_type IN ('fixed_monthly','goal_cap')
          THEN r.currency=NEW.currency
          ELSE (r.include_brl AND NEW.include_brl) OR (r.include_eur AND NEW.include_eur)
        END
    ) THEN
      RAISE EXCEPTION 'Remuneração duplicada para modalidade, moeda e vigência';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER finance_team_rule_overlap_guard ON public.finance_payout_rules;
CREATE TRIGGER finance_team_rule_overlap_guard
  BEFORE INSERT OR UPDATE OF payee_id,rule_type,currency,include_brl,include_eur,
    is_active,archived_at,starts_on,ends_on
  ON public.finance_payout_rules FOR EACH ROW
  EXECUTE FUNCTION public.finance_team_rule_overlap_guard();

CREATE OR REPLACE FUNCTION public.finance_sync_team_payouts(
  p_month date,p_actor uuid DEFAULT NULL,p_payee_id uuid DEFAULT NULL,
  p_revive_voided boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_payee public.finance_payees%ROWTYPE;
  v_rule public.finance_payout_rules%ROWTYPE;
  v_payout public.finance_payouts%ROWTYPE;
  v_stale public.finance_payouts%ROWTYPE;
  v_tx public.finance_transactions%ROWTYPE;
  v_category_id uuid;
  v_currencies text[];
  v_currency text;
  v_base bigint;
  v_amount bigint;
  v_due date;
  v_description text;
  v_tx_id uuid;
BEGIN
  IF p_month IS NULL OR p_month<>date_trunc('month',p_month)::date THEN
    RAISE EXCEPTION 'Month must be its first day';
  END IF;
  IF p_revive_voided AND p_actor IS NULL THEN RAISE EXCEPTION 'Actor required'; END IF;
  SELECT id INTO v_category_id FROM public.finance_categories
    WHERE name='Equipe' AND type='expense' AND is_active LIMIT 1;
  IF v_category_id IS NULL THEN RAISE EXCEPTION 'Finance category Equipe unavailable'; END IF;
  FOR v_payee IN SELECT * FROM public.finance_payees
    WHERE is_active AND archived_at IS NULL AND (p_payee_id IS NULL OR id=p_payee_id)
    ORDER BY id FOR UPDATE
  LOOP
    FOR v_rule IN SELECT * FROM public.finance_payout_rules
      WHERE payee_id=v_payee.id AND is_active AND archived_at IS NULL
        AND starts_on<=p_month AND (ends_on IS NULL OR ends_on>=p_month)
      ORDER BY id FOR UPDATE
    LOOP
      v_currencies:=ARRAY[]::text[];
      IF v_rule.rule_type IN ('fixed_monthly','goal_cap') THEN
        v_currencies:=ARRAY[v_rule.currency];
      ELSE
        IF v_rule.include_brl THEN v_currencies:=array_append(v_currencies,'BRL'); END IF;
        IF v_rule.include_eur THEN v_currencies:=array_append(v_currencies,'EUR'); END IF;
      END IF;
      v_due:=CASE WHEN v_rule.rule_type IN ('fixed_monthly','goal_cap') THEN
        p_month+(least(v_rule.day_of_month,
          extract(day FROM p_month+interval '1 month - 1 day')::integer)-1)
        ELSE (p_month+interval '1 month - 1 day')::date END;
      v_description:=v_payee.name||' · '||CASE v_rule.rule_type
        WHEN 'fixed_monthly' THEN 'Fixo'
        WHEN 'goal_cap' THEN 'Comissão por metas'
        WHEN 'revenue_percent' THEN '% da receita'
        ELSE '% dos serviços' END;

      FOR v_stale IN SELECT * FROM public.finance_payouts
        WHERE rule_id=v_rule.id AND period_month=p_month
          AND NOT (currency=ANY(v_currencies)) AND voided_at IS NULL
        ORDER BY id FOR UPDATE
      LOOP
        SELECT * INTO v_tx FROM public.finance_transactions
          WHERE source_module='team_payout' AND source_id=v_stale.id FOR UPDATE;
        IF v_tx.status='paid' THEN CONTINUE; END IF;
        IF v_tx.id IS NOT NULL AND v_tx.status<>'pending' THEN
          RAISE EXCEPTION 'Unexpected team payout transaction status %',v_tx.status;
        END IF;
        UPDATE public.finance_payouts SET voided_at=now(),voided_by=p_actor,
          void_reason='Moeda removida da configuração',finance_transaction_id=NULL
          WHERE id=v_stale.id;
        IF v_tx.id IS NOT NULL THEN DELETE FROM public.finance_transactions WHERE id=v_tx.id; END IF;
      END LOOP;

      FOREACH v_currency IN ARRAY v_currencies LOOP
        IF EXISTS (SELECT 1 FROM public.finance_payout_skips s
          WHERE s.rule_id=v_rule.id AND s.period_month=p_month AND s.currency=v_currency) THEN
          CONTINUE;
        END IF;
        IF v_rule.rule_type IN ('fixed_monthly','goal_cap') THEN
          v_base:=v_rule.amount_cents;
          v_amount:=v_rule.amount_cents;
        ELSE
          v_base:=public.finance_payout_base(v_rule.id,p_month,v_currency);
          v_amount:=round(v_base*v_rule.percentage/100)::bigint;
        END IF;
        IF v_base<0 OR v_amount<0 OR v_base>2147483647 OR v_amount>2147483647 THEN
          RAISE EXCEPTION 'Payout amount outside supported cents range';
        END IF;
        SELECT * INTO v_payout FROM public.finance_payouts
          WHERE rule_id=v_rule.id AND period_month=p_month AND currency=v_currency FOR UPDATE;
        IF v_payout.id IS NOT NULL AND v_payout.voided_at IS NOT NULL THEN
          IF NOT p_revive_voided THEN CONTINUE; END IF;
          UPDATE public.finance_payouts SET voided_at=NULL,voided_by=NULL,void_reason=NULL
            WHERE id=v_payout.id;
        END IF;
        IF v_payout.id IS NULL THEN
          IF v_amount=0 THEN CONTINUE; END IF;
          INSERT INTO public.finance_payouts(payee_id,rule_id,period_month,currency,
            base_amount_cents,percentage,amount_cents,created_by)
          VALUES(v_payee.id,v_rule.id,p_month,v_currency,v_base,v_rule.percentage,
            v_amount,coalesce(p_actor,v_rule.created_by)) RETURNING * INTO v_payout;
        END IF;
        SELECT * INTO v_tx FROM public.finance_transactions
          WHERE source_module='team_payout' AND source_id=v_payout.id FOR UPDATE;
        IF v_tx.status='paid' THEN CONTINUE; END IF;
        IF v_tx.id IS NOT NULL AND v_tx.status<>'pending' THEN
          RAISE EXCEPTION 'Unexpected team payout transaction status %',v_tx.status;
        END IF;
        UPDATE public.finance_payouts SET base_amount_cents=v_base,
          percentage=v_rule.percentage,amount_cents=v_amount WHERE id=v_payout.id;
        IF v_amount=0 THEN
          IF v_tx.id IS NOT NULL THEN
            UPDATE public.finance_payouts SET finance_transaction_id=NULL WHERE id=v_payout.id;
            DELETE FROM public.finance_transactions WHERE id=v_tx.id;
          END IF;
          CONTINUE;
        END IF;
        IF v_tx.id IS NULL THEN
          INSERT INTO public.finance_transactions(type,status,description,amount_cents,currency,
            due_date,category_id,source_module,source_id,is_automatic,created_by)
          VALUES('expense','pending',v_description,v_amount,v_currency,v_due,v_category_id,
            'team_payout',v_payout.id,true,coalesce(p_actor,v_rule.created_by))
          RETURNING id INTO v_tx_id;
          UPDATE public.finance_payouts SET finance_transaction_id=v_tx_id WHERE id=v_payout.id;
        ELSE
          UPDATE public.finance_transactions SET amount_cents=v_amount,
            description=v_description,due_date=v_due,category_id=v_category_id,
            currency=v_currency WHERE id=v_tx.id;
          IF v_payout.finance_transaction_id IS DISTINCT FROM v_tx.id THEN
            UPDATE public.finance_payouts SET finance_transaction_id=v_tx.id
              WHERE id=v_payout.id;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- New API is additive. The old save RPC remains callable by the published UI.
CREATE OR REPLACE FUNCTION public.finance_save_team_compensation(p_data jsonb,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_payee_id uuid;
  v_payee public.finance_payees%ROWTYPE;
  v_rule public.finance_payout_rules%ROWTYPE;
  v_item jsonb;
  v_month date;
  v_start date;
  v_mode text;
  v_rule_id uuid;
  v_type text;
  v_amount integer;
  v_currency text;
  v_percentage numeric(7,4);
  v_day integer;
  v_brl boolean;
  v_eur boolean;
  v_services uuid[];
  v_old_services uuid[];
  v_changed boolean;
  v_tx public.finance_transactions%ROWTYPE;
  v_payout public.finance_payouts%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_data IS NULL OR jsonb_typeof(p_data->'rules')<>'array' THEN
    RAISE EXCEPTION 'Actor and rules required';
  END IF;
  v_month:=(p_data->>'month')::date;
  IF v_month IS NULL OR v_month<>date_trunc('month',v_month)::date THEN
    RAISE EXCEPTION 'Invalid month';
  END IF;
  v_mode:=coalesce(p_data->>'mode','current');
  IF v_mode NOT IN ('current','next_month') THEN RAISE EXCEPTION 'Invalid apply mode'; END IF;
  v_start:=CASE WHEN v_mode='current' THEN v_month ELSE (v_month+interval '1 month')::date END;
  IF length(btrim(coalesce(p_data->>'name',''))) NOT BETWEEN 2 AND 120
    OR p_data->>'type' NOT IN ('team','contractor','partner','supplier','other')
    OR length(coalesce(p_data->>'notes',''))>500
    OR jsonb_array_length(p_data->'rules')=0
    OR jsonb_array_length(p_data->'rules')>12 THEN
    RAISE EXCEPTION 'Invalid team member configuration';
  END IF;
  v_payee_id:=nullif(p_data->>'payeeId','')::uuid;
  IF v_payee_id IS NULL THEN
    IF v_mode<>'current' THEN RAISE EXCEPTION 'New person starts this month'; END IF;
    INSERT INTO public.finance_payees(name,type,notes,created_by)
      VALUES(btrim(p_data->>'name'),p_data->>'type',nullif(btrim(p_data->>'notes'),''),p_actor)
      RETURNING id INTO v_payee_id;
  ELSE
    SELECT * INTO v_payee FROM public.finance_payees WHERE id=v_payee_id FOR UPDATE;
    IF NOT FOUND OR v_payee.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Payee unavailable'; END IF;
    -- profile_id is deliberately untouched: legacy links remain intact.
    UPDATE public.finance_payees SET name=btrim(p_data->>'name'),type=p_data->>'type',
      notes=nullif(btrim(p_data->>'notes'),'') WHERE id=v_payee_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'rules') LOOP
    v_rule_id:=nullif(v_item->>'id','')::uuid;
    v_type:=v_item->>'ruleType';
    v_amount:=nullif(v_item->>'amountCents','')::integer;
    v_currency:=v_item->>'currency';
    v_percentage:=nullif(v_item->>'percentage','')::numeric(7,4);
    v_day:=nullif(v_item->>'dayOfMonth','')::integer;
    v_brl:=coalesce((v_item->>'includeBrl')::boolean,false);
    v_eur:=coalesce((v_item->>'includeEur')::boolean,false);
    SELECT coalesce(array_agg(DISTINCT x.value::uuid ORDER BY x.value::uuid),ARRAY[]::uuid[])
      INTO v_services FROM jsonb_array_elements_text(coalesce(v_item->'serviceIds','[]'::jsonb)) x(value);
    IF cardinality(v_services)>50 OR v_type NOT IN
      ('fixed_monthly','goal_cap','revenue_percent','service_percent') THEN
      RAISE EXCEPTION 'Invalid remuneration';
    END IF;
    IF v_type IN ('fixed_monthly','goal_cap') THEN
      IF v_amount IS NULL OR v_amount<0 OR v_currency NOT IN ('BRL','EUR')
        OR v_day NOT BETWEEN 1 AND 31 OR cardinality(v_services)>0 THEN
        RAISE EXCEPTION 'Fixed/goal remuneration requires amount, currency and due day';
      END IF;
      v_percentage:=NULL; v_brl:=true; v_eur:=true;
    ELSE
      IF v_percentage IS NULL OR v_percentage<=0 OR v_percentage>100
        OR NOT (v_brl OR v_eur)
        OR (v_type='service_percent' AND cardinality(v_services)=0)
        OR (v_type='revenue_percent' AND cardinality(v_services)>0) THEN
        RAISE EXCEPTION 'Percentage remuneration requires rate and currency/services';
      END IF;
      v_amount:=NULL; v_currency:=NULL; v_day:=NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_services) x
      WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE id=x)) THEN
      RAISE EXCEPTION 'Unknown service';
    END IF;
    IF v_rule_id IS NOT NULL THEN
      SELECT * INTO v_rule FROM public.finance_payout_rules
        WHERE id=v_rule_id AND payee_id=v_payee_id AND archived_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Remuneration not found for payee'; END IF;
      SELECT coalesce(array_agg(service_id ORDER BY service_id),ARRAY[]::uuid[])
        INTO v_old_services FROM public.finance_payout_rule_services WHERE rule_id=v_rule_id;
      v_changed:=(v_rule.rule_type,v_rule.amount_cents,v_rule.currency,v_rule.percentage,
        v_rule.include_brl,v_rule.include_eur,v_rule.day_of_month,v_old_services)
        IS DISTINCT FROM (v_type,v_amount,v_currency,v_percentage,v_brl,v_eur,v_day,v_services);
      IF NOT v_changed THEN CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM public.finance_payouts p
        JOIN public.finance_transactions t ON t.id=p.finance_transaction_id
        WHERE p.rule_id=v_rule_id AND p.period_month>=v_start AND t.status='paid') THEN
        RAISE EXCEPTION 'Paid remuneration must be explicitly reversed before editing';
      END IF;
      IF v_rule.starts_on<v_start THEN
        UPDATE public.finance_payout_rules SET ends_on=(v_start-interval '1 month')::date
          WHERE id=v_rule_id;
        v_rule_id:=NULL;
      END IF;
      -- Existing pending occurrence is voided only for this rule, never siblings.
      IF v_mode='current' THEN
        FOR v_payout IN SELECT * FROM public.finance_payouts
          WHERE rule_id=v_rule.id AND period_month=v_month AND voided_at IS NULL
          ORDER BY id FOR UPDATE LOOP
          SELECT * INTO v_tx FROM public.finance_transactions
            WHERE source_module='team_payout' AND source_id=v_payout.id FOR UPDATE;
          IF v_tx.id IS NOT NULL THEN
            PERFORM public.finance_delete_pending_transaction(v_tx.id,p_actor,
              'Regra de remuneração alterada');
          ELSE
            UPDATE public.finance_payouts SET voided_at=now(),voided_by=p_actor,
              void_reason='Regra de remuneração alterada' WHERE id=v_payout.id;
          END IF;
        END LOOP;
        IF v_rule_id IS NOT NULL THEN
          UPDATE public.finance_payouts SET voided_at=NULL,voided_by=NULL,void_reason=NULL
            WHERE rule_id=v_rule_id AND period_month=v_month AND voided_at IS NOT NULL
              AND finance_transaction_id IS NULL;
        END IF;
      END IF;
    ELSE
      v_changed:=true;
    END IF;
    IF v_rule_id IS NULL THEN
      INSERT INTO public.finance_payout_rules(payee_id,rule_type,amount_cents,currency,
        percentage,include_brl,include_eur,day_of_month,starts_on,created_by)
      VALUES(v_payee_id,v_type,v_amount,v_currency,v_percentage,v_brl,v_eur,v_day,v_start,p_actor)
      RETURNING id INTO v_rule_id;
    ELSE
      UPDATE public.finance_payout_rules SET rule_type=v_type,amount_cents=v_amount,
        currency=v_currency,percentage=v_percentage,include_brl=v_brl,include_eur=v_eur,
        day_of_month=v_day,is_active=true WHERE id=v_rule_id;
    END IF;
    PERFORM public.finance_set_payout_rule_services(v_rule_id,v_services);
  END LOOP;
  IF v_payee_id IS NOT NULL THEN
    PERFORM public.finance_sync_team_payouts(v_start,p_actor,v_payee_id,false);
  END IF;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,new_data)
    VALUES(p_actor,'financeiro','finance_payee',v_payee_id,
      'finance.team_compensation.save',p_data);
  RETURN v_payee_id;
END $$;

CREATE OR REPLACE FUNCTION public.finance_skip_goal_commission(p_rule_id uuid,p_month date,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rule public.finance_payout_rules%ROWTYPE;
  v_payout public.finance_payouts%ROWTYPE;
  v_tx public.finance_transactions%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_month IS NULL OR p_month<>date_trunc('month',p_month)::date THEN
    RAISE EXCEPTION 'Actor/month required';
  END IF;
  SELECT * INTO v_rule FROM public.finance_payout_rules WHERE id=p_rule_id FOR UPDATE;
  IF NOT FOUND OR v_rule.rule_type<>'goal_cap' OR v_rule.archived_at IS NOT NULL
    OR v_rule.starts_on>p_month OR (v_rule.ends_on IS NOT NULL AND v_rule.ends_on<p_month) THEN
    RAISE EXCEPTION 'Goal commission not active in month';
  END IF;
  SELECT * INTO v_payout FROM public.finance_payouts WHERE rule_id=p_rule_id
    AND period_month=p_month AND currency=v_rule.currency FOR UPDATE;
  IF v_payout.id IS NOT NULL THEN
    SELECT * INTO v_tx FROM public.finance_transactions
      WHERE source_module='team_payout' AND source_id=v_payout.id FOR UPDATE;
    IF v_tx.status='paid' THEN RAISE EXCEPTION 'Paid commission cannot be skipped'; END IF;
    IF v_tx.id IS NOT NULL THEN
      PERFORM public.finance_delete_pending_transaction(v_tx.id,p_actor,'Sem comissão neste mês');
    ELSIF v_payout.voided_at IS NULL THEN
      UPDATE public.finance_payouts SET voided_at=now(),voided_by=p_actor,
        void_reason='Sem comissão neste mês' WHERE id=v_payout.id;
    END IF;
  END IF;
  INSERT INTO public.finance_payout_skips(rule_id,period_month,currency,skipped_by,reason)
    VALUES(p_rule_id,p_month,v_rule.currency,p_actor,'Sem comissão neste mês')
    ON CONFLICT (rule_id,period_month,currency) DO NOTHING;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,new_data)
    VALUES(p_actor,'financeiro','finance_payout_rule',p_rule_id,
      'finance.goal_commission.skip',jsonb_build_object('month',p_month,'currency',v_rule.currency));
END $$;

CREATE OR REPLACE FUNCTION public.finance_set_team_rule_state(p_rule_id uuid,p_month date,
  p_action text,p_remove_pending boolean,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rule public.finance_payout_rules%ROWTYPE;
  v_payout public.finance_payouts%ROWTYPE;
  v_tx public.finance_transactions%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_month IS NULL OR p_month<>date_trunc('month',p_month)::date
    OR p_action NOT IN ('pause','reactivate','remove') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  SELECT * INTO v_rule FROM public.finance_payout_rules WHERE id=p_rule_id FOR UPDATE;
  IF NOT FOUND OR v_rule.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Rule unavailable'; END IF;
  IF p_action IN ('pause','remove') AND p_remove_pending THEN
    FOR v_payout IN SELECT * FROM public.finance_payouts
      WHERE rule_id=p_rule_id AND period_month=p_month AND voided_at IS NULL
      ORDER BY id FOR UPDATE LOOP
      SELECT * INTO v_tx FROM public.finance_transactions
        WHERE source_module='team_payout' AND source_id=v_payout.id FOR UPDATE;
      IF v_tx.status='pending' THEN
        PERFORM public.finance_delete_pending_transaction(v_tx.id,p_actor,
          'Remuneração pausada ou removida');
      ELSIF v_tx.id IS NULL THEN
        UPDATE public.finance_payouts SET voided_at=now(),voided_by=p_actor,
          void_reason='Remuneração pausada ou removida' WHERE id=v_payout.id;
      END IF;
    END LOOP;
  END IF;
  IF p_action='pause' THEN
    UPDATE public.finance_payout_rules SET is_active=false WHERE id=p_rule_id;
  ELSIF p_action='reactivate' THEN
    UPDATE public.finance_payout_rules SET is_active=true WHERE id=p_rule_id;
    PERFORM public.finance_sync_team_payouts(p_month,p_actor,v_rule.payee_id,true);
  ELSE
    UPDATE public.finance_payout_rules SET is_active=false,archived_at=now(),archived_by=p_actor
      WHERE id=p_rule_id;
  END IF;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,new_data)
    VALUES(p_actor,'financeiro','finance_payout_rule',p_rule_id,
      'finance.team_rule.'||p_action,jsonb_build_object('month',p_month,
        'remove_pending',p_remove_pending));
END $$;

-- The operator confirmed that these two active records are the same person.
-- Reconcile only the exact pending October records observed in preflight.
-- No paid snapshot, transaction ID, amount, service selection or history is deleted.
DO $$
DECLARE v_old uuid:='522ba577-cb4a-41e2-a8c3-4667f58a6795';
  v_canonical uuid:='e052e873-f1c8-490b-8a44-493bd36483ea';
  v_actor uuid:='37110d33-3ba0-42b4-8a1f-cab7d1a4d30e';
BEGIN
  -- Supabase Preview may clone production after this guarded reconciliation
  -- has already run, then replay this file from the repository. Only a fully
  -- reconciled state (including its audit marker) may be skipped.
  IF EXISTS (SELECT 1 FROM public.finance_payees
      WHERE id=v_old AND archived_at IS NOT NULL AND NOT is_active)
    AND EXISTS (SELECT 1 FROM public.finance_payees
      WHERE id=v_canonical AND archived_at IS NULL AND is_active)
    AND EXISTS (SELECT 1 FROM public.finance_payout_rules
      WHERE id='4a576573-1e03-4dff-811a-f623e44ce936' AND payee_id=v_canonical)
    AND EXISTS (SELECT 1 FROM public.finance_payouts
      WHERE id='c0a9eb72-a4e1-46f7-8158-bc3c07a918c1' AND payee_id=v_canonical)
    AND NOT EXISTS (SELECT 1 FROM public.finance_payout_rules WHERE payee_id=v_old)
    AND NOT EXISTS (SELECT 1 FROM public.finance_payouts WHERE payee_id=v_old)
    AND EXISTS (SELECT 1 FROM public.audit_logs
      WHERE entity_id=v_old AND action='finance.team_payee.consolidate'
        AND new_data->>'canonical_payee_id'=v_canonical::text)
  THEN RETURN; END IF;

  -- Empty Preview seeds do not contain these production records. Any partial
  -- set still falls through to the strict preflight and aborts.
  IF NOT EXISTS (SELECT 1 FROM public.finance_payees WHERE id IN (v_old,v_canonical))
    AND NOT EXISTS (SELECT 1 FROM public.finance_payout_rules WHERE id IN
      ('4a576573-1e03-4dff-811a-f623e44ce936','43c786ce-12d0-472b-9d56-34e9d2496653'))
    AND NOT EXISTS (SELECT 1 FROM public.finance_payouts WHERE id IN
      ('c0a9eb72-a4e1-46f7-8158-bc3c07a918c1','897cb778-928b-4188-b478-6a89ac7ee904'))
  THEN RETURN; END IF;

  IF (SELECT count(*) FROM public.finance_payees WHERE id IN (v_old,v_canonical)
      AND name='Gabriel Facioli' AND type='team' AND profile_id IS NULL
      AND archived_at IS NULL AND created_by=v_actor)<>2
    OR (SELECT count(*) FROM public.finance_payout_rules
      WHERE payee_id=v_old AND id='4a576573-1e03-4dff-811a-f623e44ce936'
        AND rule_type='service_percent' AND percentage=3 AND starts_on='2026-10-01'
        AND ends_on IS NULL AND is_active AND archived_at IS NULL)<>1
    OR (SELECT count(*) FROM public.finance_payout_rules
      WHERE payee_id=v_canonical AND id='43c786ce-12d0-472b-9d56-34e9d2496653'
        AND rule_type='fixed_monthly' AND amount_cents=30000 AND currency='BRL'
        AND day_of_month=5 AND starts_on='2026-10-01'
        AND ends_on IS NULL AND is_active AND archived_at IS NULL)<>1
    OR (SELECT count(*) FROM public.finance_payouts p
      JOIN public.finance_transactions t ON t.id=p.finance_transaction_id
      WHERE p.id='c0a9eb72-a4e1-46f7-8158-bc3c07a918c1' AND p.payee_id=v_old
        AND p.rule_id='4a576573-1e03-4dff-811a-f623e44ce936'
        AND p.period_month='2026-10-01' AND p.currency='EUR'
        AND p.amount_cents=600 AND p.voided_at IS NULL
        AND t.id='30d21aff-ad4f-43dd-ab27-08f9972fba42'
        AND t.status='pending' AND t.amount_cents=600)<>1
    OR (SELECT count(*) FROM public.finance_payouts p
      JOIN public.finance_transactions t ON t.id=p.finance_transaction_id
      WHERE p.id='897cb778-928b-4188-b478-6a89ac7ee904' AND p.payee_id=v_canonical
        AND p.rule_id='43c786ce-12d0-472b-9d56-34e9d2496653'
        AND p.period_month='2026-10-01' AND p.currency='BRL'
        AND p.amount_cents=30000 AND p.voided_at IS NULL
        AND t.id='4da06768-2126-4b5b-ba54-ec24446a9f46'
        AND t.status='pending' AND t.amount_cents=30000)<>1
    OR (SELECT count(*) FROM public.finance_payouts WHERE payee_id=v_old)<>1
    OR (SELECT count(*) FROM public.finance_payout_rules WHERE payee_id=v_old)<>1
  THEN RAISE EXCEPTION 'Gabriel consolidation preflight diverged; no merge performed'; END IF;

  -- This one guarded historical correction is the only exception to the
  -- payout identity trigger. The trigger is re-enabled within the transaction.
  ALTER TABLE public.finance_payouts DISABLE TRIGGER finance_payout_snapshot_guard;
  UPDATE public.finance_payouts SET payee_id=v_canonical
    WHERE id='c0a9eb72-a4e1-46f7-8158-bc3c07a918c1' AND payee_id=v_old;
  ALTER TABLE public.finance_payouts ENABLE TRIGGER finance_payout_snapshot_guard;
  UPDATE public.finance_payout_rules SET payee_id=v_canonical
    WHERE id='4a576573-1e03-4dff-811a-f623e44ce936' AND payee_id=v_old;
  UPDATE public.finance_payees SET is_active=false,archived_at=now(),archived_by=v_actor,
    notes='Consolidado no cadastro '||v_canonical::text||' na Etapa 2-A'
    WHERE id=v_old;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data)
    VALUES(v_actor,'financeiro','finance_payee',v_old,'finance.team_payee.consolidate',
      jsonb_build_object('payee_id',v_old,'rule_id','4a576573-1e03-4dff-811a-f623e44ce936',
        'payout_id','c0a9eb72-a4e1-46f7-8158-bc3c07a918c1'),
      jsonb_build_object('canonical_payee_id',v_canonical,
        'transaction_id','30d21aff-ad4f-43dd-ab27-08f9972fba42'));
END $$;

REVOKE ALL ON FUNCTION public.finance_save_team_compensation(jsonb,uuid),
  public.finance_skip_goal_commission(uuid,date,uuid),
  public.finance_set_team_rule_state(uuid,date,text,boolean,uuid),
  public.finance_sync_team_payouts(date,uuid,uuid,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_save_team_compensation(jsonb,uuid),
  public.finance_skip_goal_commission(uuid,date,uuid),
  public.finance_set_team_rule_state(uuid,date,text,boolean,uuid),
  public.finance_sync_team_payouts(date,uuid,uuid,boolean) TO service_role;
