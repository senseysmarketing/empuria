-- Team payouts remain historical snapshots once paid; pending amounts may track
-- the realized revenue base until settlement. Existing voided payouts stay voided.
CREATE OR REPLACE FUNCTION public.finance_payout_snapshot_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_old_status text; v_new_status text;
BEGIN
  IF (OLD.id, OLD.payee_id, OLD.rule_id, OLD.period_month, OLD.currency, OLD.generated_at)
     IS DISTINCT FROM
     (NEW.id, NEW.payee_id, NEW.rule_id, NEW.period_month, NEW.currency, NEW.generated_at) THEN
    RAISE EXCEPTION 'Payout identity is immutable';
  END IF;
  IF OLD.finance_transaction_id IS NOT NULL THEN
    SELECT status INTO v_old_status FROM public.finance_transactions
      WHERE id = OLD.finance_transaction_id;
  END IF;
  IF NEW.finance_transaction_id IS NOT NULL THEN
    SELECT status INTO v_new_status FROM public.finance_transactions
      WHERE id = NEW.finance_transaction_id;
  END IF;
  IF v_old_status = 'paid' AND
     (OLD.base_amount_cents, OLD.percentage, OLD.amount_cents,
      OLD.finance_transaction_id, OLD.voided_at) IS DISTINCT FROM
     (NEW.base_amount_cents, NEW.percentage, NEW.amount_cents,
      NEW.finance_transaction_id, NEW.voided_at) THEN
    RAISE EXCEPTION 'Paid payout snapshot is immutable';
  END IF;
  IF (OLD.base_amount_cents, OLD.percentage, OLD.amount_cents) IS DISTINCT FROM
     (NEW.base_amount_cents, NEW.percentage, NEW.amount_cents)
     AND (OLD.voided_at IS NOT NULL OR NEW.voided_at IS NOT NULL
          OR v_old_status NOT IN ('pending') AND v_old_status IS NOT NULL) THEN
    RAISE EXCEPTION 'Only active pending payouts can be recalculated';
  END IF;
  IF OLD.finance_transaction_id IS DISTINCT FROM NEW.finance_transaction_id THEN
    IF (OLD.finance_transaction_id IS NOT NULL AND NEW.finance_transaction_id IS NOT NULL)
      OR v_old_status NOT IN ('pending') AND v_old_status IS NOT NULL
      OR (NEW.finance_transaction_id IS NOT NULL AND v_new_status <> 'pending') THEN
      RAISE EXCEPTION 'Payout transaction link cannot be replaced';
    END IF;
  END IF;
  IF (OLD.voided_at, OLD.voided_by, OLD.void_reason) IS DISTINCT FROM
     (NEW.voided_at, NEW.voided_by, NEW.void_reason) THEN
    IF NOT (
      (OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL
        AND NEW.finance_transaction_id IS NULL AND v_old_status IS DISTINCT FROM 'paid')
      OR (OLD.voided_at IS NOT NULL AND NEW.voided_at IS NULL
        AND OLD.finance_transaction_id IS NULL AND NEW.finance_transaction_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'Invalid payout void transition';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Serialize configuration changes per person and reject overlapping active
-- periods, including writes from the legacy UI during deployment.
CREATE FUNCTION public.finance_team_rule_overlap_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.is_active AND NEW.archived_at IS NULL THEN
    PERFORM 1 FROM public.finance_payees WHERE id = NEW.payee_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.finance_payout_rules r
      WHERE r.payee_id = NEW.payee_id AND r.id <> NEW.id
        AND r.is_active AND r.archived_at IS NULL
        AND r.starts_on <= coalesce(NEW.ends_on, 'infinity'::date)
        AND coalesce(r.ends_on, 'infinity'::date) >= NEW.starts_on
    ) THEN
      RAISE EXCEPTION 'Team member already has a configuration for this period';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_team_rule_overlap_guard
  BEFORE INSERT OR UPDATE OF payee_id, is_active, archived_at, starts_on, ends_on
  ON public.finance_payout_rules FOR EACH ROW
  EXECUTE FUNCTION public.finance_team_rule_overlap_guard();

CREATE FUNCTION public.finance_sync_team_payouts(
  p_month date, p_actor uuid DEFAULT NULL, p_payee_id uuid DEFAULT NULL,
  p_revive_voided boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_payee public.finance_payees%ROWTYPE;
  v_rule public.finance_payout_rules%ROWTYPE;
  v_payout public.finance_payouts%ROWTYPE;
  v_stale public.finance_payouts%ROWTYPE;
  v_tx public.finance_transactions%ROWTYPE;
  v_rule_count integer;
  v_category_id uuid;
  v_currencies text[];
  v_currency text;
  v_base bigint;
  v_amount bigint;
  v_due date;
  v_description text;
  v_tx_id uuid;
BEGIN
  IF p_month IS NULL OR p_month <> date_trunc('month', p_month)::date THEN
    RAISE EXCEPTION 'Month must be its first day';
  END IF;
  IF p_revive_voided AND p_actor IS NULL THEN
    RAISE EXCEPTION 'Actor required to revive a voided payout';
  END IF;
  SELECT id INTO v_category_id FROM public.finance_categories
    WHERE name = 'Equipe' AND type = 'expense' AND is_active LIMIT 1;
  IF v_category_id IS NULL THEN RAISE EXCEPTION 'Finance category Equipe unavailable'; END IF;

  FOR v_payee IN SELECT * FROM public.finance_payees
    WHERE is_active AND archived_at IS NULL
      AND (p_payee_id IS NULL OR id = p_payee_id)
    ORDER BY id FOR UPDATE
  LOOP
    SELECT count(*) INTO v_rule_count FROM public.finance_payout_rules
      WHERE payee_id = v_payee.id AND is_active AND archived_at IS NULL
        AND starts_on <= p_month AND (ends_on IS NULL OR ends_on >= p_month);
    IF v_rule_count > 1 THEN
      RAISE EXCEPTION 'More than one team payout configuration for payee % in %',
        v_payee.id, p_month;
    END IF;
    IF v_rule_count = 0 THEN CONTINUE; END IF;
    SELECT * INTO v_rule FROM public.finance_payout_rules
      WHERE payee_id = v_payee.id AND is_active AND archived_at IS NULL
        AND starts_on <= p_month AND (ends_on IS NULL OR ends_on >= p_month)
      FOR UPDATE;
    v_currencies := ARRAY[]::text[];
    IF v_rule.rule_type = 'fixed_monthly' THEN
      v_currencies := ARRAY[v_rule.currency];
    ELSE
      IF v_rule.include_brl THEN v_currencies := array_append(v_currencies, 'BRL'); END IF;
      IF v_rule.include_eur THEN v_currencies := array_append(v_currencies, 'EUR'); END IF;
    END IF;
    v_due := CASE WHEN v_rule.rule_type = 'fixed_monthly' THEN
      p_month + (least(v_rule.day_of_month,
        extract(day FROM p_month + interval '1 month - 1 day')::integer) - 1)
      ELSE (p_month + interval '1 month - 1 day')::date END;
    v_description := 'Repasse - ' || v_payee.name;

    -- A currency removed by a configuration edit can only void an unsettled
    -- payout. Paid rows remain frozen until the explicit reversal path runs.
    FOR v_stale IN SELECT * FROM public.finance_payouts
      WHERE rule_id = v_rule.id AND period_month = p_month
        AND NOT (currency = ANY(v_currencies)) AND voided_at IS NULL
      ORDER BY id FOR UPDATE
    LOOP
      SELECT * INTO v_tx FROM public.finance_transactions
        WHERE source_module = 'team_payout' AND source_id = v_stale.id FOR UPDATE;
      IF v_tx.status = 'paid' THEN CONTINUE; END IF;
      IF v_tx.id IS NOT NULL AND v_tx.status <> 'pending' THEN
        RAISE EXCEPTION 'Unexpected team payout transaction status %', v_tx.status;
      END IF;
      UPDATE public.finance_payouts SET voided_at = now(), voided_by = p_actor,
        void_reason = 'Moeda removida da configuração', finance_transaction_id = NULL
        WHERE id = v_stale.id;
      IF v_tx.id IS NOT NULL THEN DELETE FROM public.finance_transactions WHERE id = v_tx.id; END IF;
    END LOOP;

    FOREACH v_currency IN ARRAY v_currencies LOOP
      IF v_rule.rule_type = 'fixed_monthly' THEN
        v_base := v_rule.amount_cents;
        v_amount := v_rule.amount_cents;
      ELSE
        v_base := public.finance_payout_base(v_rule.id, p_month, v_currency);
        v_amount := round(v_base * v_rule.percentage / 100)::bigint;
      END IF;
      IF v_base < 0 OR v_amount < 0 OR v_base > 2147483647 OR v_amount > 2147483647 THEN
        RAISE EXCEPTION 'Payout base or amount outside supported cents range';
      END IF;
      SELECT * INTO v_payout FROM public.finance_payouts
        WHERE rule_id = v_rule.id AND period_month = p_month AND currency = v_currency
        FOR UPDATE;
      IF v_payout.id IS NOT NULL AND v_payout.voided_at IS NOT NULL THEN
        IF NOT p_revive_voided THEN CONTINUE; END IF;
        UPDATE public.finance_payouts SET voided_at = NULL, voided_by = NULL,
          void_reason = NULL WHERE id = v_payout.id;
      END IF;
      IF v_payout.id IS NULL THEN
        IF v_amount = 0 THEN CONTINUE; END IF;
        INSERT INTO public.finance_payouts (
          payee_id, rule_id, period_month, currency, base_amount_cents,
          percentage, amount_cents, created_by
        ) VALUES (
          v_payee.id, v_rule.id, p_month, v_currency, v_base,
          v_rule.percentage, v_amount, coalesce(p_actor, v_rule.created_by)
        ) RETURNING * INTO v_payout;
      END IF;
      SELECT * INTO v_tx FROM public.finance_transactions
        WHERE source_module = 'team_payout' AND source_id = v_payout.id FOR UPDATE;
      IF v_tx.status = 'paid' THEN CONTINUE; END IF;
      IF v_tx.id IS NOT NULL AND v_tx.status <> 'pending' THEN
        RAISE EXCEPTION 'Unexpected team payout transaction status %', v_tx.status;
      END IF;
      UPDATE public.finance_payouts SET base_amount_cents = v_base,
        percentage = v_rule.percentage, amount_cents = v_amount
        WHERE id = v_payout.id;
      IF v_amount = 0 THEN
        IF v_tx.id IS NOT NULL THEN
          UPDATE public.finance_payouts SET finance_transaction_id = NULL
            WHERE id = v_payout.id;
          DELETE FROM public.finance_transactions WHERE id = v_tx.id;
        END IF;
        CONTINUE;
      END IF;
      IF v_tx.id IS NULL THEN
        INSERT INTO public.finance_transactions (
          type, status, description, amount_cents, currency, due_date, category_id,
          source_module, source_id, is_automatic, created_by
        ) VALUES (
          'expense', 'pending', v_description, v_amount, v_currency, v_due,
          v_category_id, 'team_payout', v_payout.id, true,
          coalesce(p_actor, v_rule.created_by)
        ) RETURNING id INTO v_tx_id;
        UPDATE public.finance_payouts SET finance_transaction_id = v_tx_id
          WHERE id = v_payout.id;
      ELSE
        UPDATE public.finance_transactions SET amount_cents = v_amount,
          description = v_description, due_date = v_due, category_id = v_category_id,
          currency = v_currency WHERE id = v_tx.id;
        IF v_payout.finance_transaction_id IS DISTINCT FROM v_tx.id THEN
          UPDATE public.finance_payouts SET finance_transaction_id = v_tx.id
            WHERE id = v_payout.id;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- A single transaction owns person, configuration versioning, optional paid
-- reversal and current-month recalculation. The UI never writes these tables
-- piecemeal.
CREATE FUNCTION public.finance_save_team_member(p_data jsonb, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_payee_id uuid;
  v_payee public.finance_payees%ROWTYPE;
  v_rule public.finance_payout_rules%ROWTYPE;
  v_next_rule public.finance_payout_rules%ROWTYPE;
  v_payout public.finance_payouts%ROWTYPE;
  v_name text;
  v_type text;
  v_profile_id uuid;
  v_notes text;
  v_rule_type text;
  v_amount integer;
  v_currency text;
  v_percentage numeric(7,4);
  v_include_brl boolean;
  v_include_eur boolean;
  v_day integer;
  v_service_ids uuid[];
  v_old_service_ids uuid[];
  v_month date;
  v_next_month date;
  v_mode text;
  v_reverse_paid boolean;
  v_changed boolean;
  v_new boolean := false;
  v_target_rule_id uuid;
  v_tx_id uuid;
BEGIN
  IF p_actor IS NULL OR p_data IS NULL THEN RAISE EXCEPTION 'Actor and input required'; END IF;
  v_month := (p_data->>'month')::date;
  IF v_month IS NULL OR v_month <> date_trunc('month',v_month)::date THEN
    RAISE EXCEPTION 'Month must be its first day';
  END IF;
  v_next_month := (v_month + interval '1 month')::date;
  v_mode := coalesce(p_data->>'mode','current');
  IF v_mode NOT IN ('current','next_month') THEN RAISE EXCEPTION 'Invalid apply mode'; END IF;
  v_reverse_paid := coalesce((p_data->>'reversePaid')::boolean,false);
  v_payee_id := nullif(p_data->>'payeeId','')::uuid;
  v_name := btrim(coalesce(p_data->>'name',''));
  v_type := p_data->>'type';
  v_profile_id := nullif(p_data->>'profileId','')::uuid;
  v_notes := nullif(btrim(coalesce(p_data->>'notes','')),'');
  v_rule_type := p_data->>'ruleType';
  v_amount := nullif(p_data->>'amountCents','')::integer;
  v_currency := p_data->>'currency';
  v_percentage := nullif(p_data->>'percentage','')::numeric(7,4);
  v_include_brl := coalesce((p_data->>'includeBrl')::boolean,false);
  v_include_eur := coalesce((p_data->>'includeEur')::boolean,false);
  v_day := nullif(p_data->>'dayOfMonth','')::integer;
  SELECT coalesce(array_agg(DISTINCT item.value::uuid ORDER BY item.value::uuid),ARRAY[]::uuid[])
    INTO v_service_ids FROM jsonb_array_elements_text(
      coalesce(p_data->'serviceIds','[]'::jsonb)) item(value);
  IF length(v_name) NOT BETWEEN 2 AND 120
    OR v_type NOT IN ('team','contractor','partner','supplier','other')
    OR v_rule_type NOT IN ('fixed_monthly','revenue_percent','service_percent')
    OR length(coalesce(v_notes,'')) > 500 OR cardinality(v_service_ids) > 50 THEN
    RAISE EXCEPTION 'Invalid team member configuration';
  END IF;
  IF v_rule_type = 'fixed_monthly' THEN
    IF v_amount IS NULL OR v_amount < 0 OR v_currency NOT IN ('BRL','EUR')
      OR v_day NOT BETWEEN 1 AND 31 THEN
      RAISE EXCEPTION 'Fixed payout requires amount, currency and due day';
    END IF;
    v_percentage := NULL;
    v_service_ids := ARRAY[]::uuid[];
    v_include_brl := true;
    v_include_eur := true;
  ELSE
    IF v_percentage IS NULL OR v_percentage <= 0 OR v_percentage > 100
      OR NOT (v_include_brl OR v_include_eur)
      OR (v_rule_type = 'service_percent' AND cardinality(v_service_ids) = 0) THEN
      RAISE EXCEPTION 'Percentage payout requires rate, currency and services where applicable';
    END IF;
    IF v_rule_type = 'revenue_percent' THEN v_service_ids := ARRAY[]::uuid[]; END IF;
    v_amount := NULL;
    v_currency := NULL;
    v_day := NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_service_ids) item
             WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE id=item)) THEN
    RAISE EXCEPTION 'Unknown service';
  END IF;

  IF v_payee_id IS NULL THEN
    IF v_mode <> 'current' THEN RAISE EXCEPTION 'New person starts in selected month'; END IF;
    INSERT INTO public.finance_payees(name,type,profile_id,notes,created_by)
      VALUES (v_name,v_type,v_profile_id,v_notes,p_actor) RETURNING id INTO v_payee_id;
    v_new := true;
  ELSE
    SELECT * INTO v_payee FROM public.finance_payees WHERE id=v_payee_id FOR UPDATE;
    IF NOT FOUND OR v_payee.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Active team member not found';
    END IF;
    UPDATE public.finance_payees SET name=v_name,type=v_type,
      profile_id=v_profile_id,notes=v_notes WHERE id=v_payee_id;
  END IF;
  SELECT * INTO v_rule FROM public.finance_payout_rules
    WHERE payee_id=v_payee_id AND archived_at IS NULL
      AND starts_on <= v_month AND (ends_on IS NULL OR ends_on >= v_month)
    ORDER BY starts_on DESC LIMIT 1 FOR UPDATE;
  IF v_rule.id IS NOT NULL THEN
    SELECT coalesce(array_agg(service_id ORDER BY service_id),ARRAY[]::uuid[])
      INTO v_old_service_ids FROM public.finance_payout_rule_services
      WHERE rule_id=v_rule.id;
  ELSE
    v_old_service_ids := ARRAY[]::uuid[];
  END IF;
  v_changed := v_rule.id IS NULL OR
    (v_rule.rule_type,v_rule.amount_cents,v_rule.currency,v_rule.percentage,
     v_rule.include_brl,v_rule.include_eur,v_rule.day_of_month,v_old_service_ids)
    IS DISTINCT FROM
    (v_rule_type,v_amount,v_currency,v_percentage,
     v_include_brl,v_include_eur,v_day,v_service_ids);

  IF NOT v_changed THEN
    IF v_payee.is_active THEN
      PERFORM public.finance_sync_team_payouts(v_month,p_actor,v_payee_id,false);
    END IF;
    INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,new_data)
      VALUES (p_actor,'financeiro','finance_payee',v_payee_id,
        'finance.team_member.update_profile',p_data);
    RETURN v_payee_id;
  END IF;

  IF v_mode='current' THEN
    IF EXISTS (
      SELECT 1 FROM public.finance_payouts payout
      JOIN public.finance_transactions tx ON tx.id=payout.finance_transaction_id
      WHERE payout.payee_id=v_payee_id AND payout.period_month=v_month AND tx.status='paid'
    ) AND NOT v_reverse_paid THEN
      RAISE EXCEPTION 'Paid payout requires next-month edit or explicit reversal';
    END IF;
    IF v_reverse_paid THEN
      FOR v_tx_id IN SELECT tx.id FROM public.finance_payouts payout
        JOIN public.finance_transactions tx ON tx.id=payout.finance_transaction_id
        WHERE payout.payee_id=v_payee_id AND payout.period_month=v_month
          AND tx.status='paid' ORDER BY tx.id
      LOOP
        PERFORM public.finance_reverse_settlement(
          v_tx_id,p_actor,'Alteração da configuração de repasse');
      END LOOP;
    END IF;
    IF v_rule.id IS NOT NULL AND v_rule.starts_on < v_month THEN
      IF EXISTS (SELECT 1 FROM public.finance_payouts payout
        JOIN public.finance_transactions tx ON tx.id=payout.finance_transaction_id
        WHERE payout.rule_id=v_rule.id AND payout.period_month > v_month
          AND tx.status='paid') THEN
        RAISE EXCEPTION 'A future paid payout must be reversed before editing this period';
      END IF;
      UPDATE public.finance_payout_rules SET ends_on=(v_month-interval '1 month')::date
        WHERE id=v_rule.id;
      FOR v_payout IN SELECT * FROM public.finance_payouts
        WHERE rule_id=v_rule.id AND period_month=v_month AND voided_at IS NULL
        ORDER BY id FOR UPDATE
      LOOP
        SELECT id INTO v_tx_id FROM public.finance_transactions
          WHERE source_module='team_payout' AND source_id=v_payout.id;
        IF v_tx_id IS NOT NULL THEN
          PERFORM public.finance_delete_pending_transaction(
            v_tx_id,p_actor,'Configuração substituída neste mês');
        ELSE
          UPDATE public.finance_payouts SET voided_at=now(),voided_by=p_actor,
            void_reason='Configuração substituída neste mês' WHERE id=v_payout.id;
        END IF;
      END LOOP;
      v_rule.id := NULL;
    ELSIF v_rule.id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.finance_payouts payout
      JOIN public.finance_transactions tx ON tx.id=payout.finance_transaction_id
      WHERE payout.rule_id=v_rule.id AND payout.period_month > v_month AND tx.status='paid'
    ) THEN
      RAISE EXCEPTION 'A future paid payout must be reversed before editing this period';
    END IF;
  ELSE
    IF v_rule.id IS NOT NULL AND (v_rule.ends_on IS NULL OR v_rule.ends_on > v_month) THEN
      UPDATE public.finance_payout_rules SET ends_on=v_month WHERE id=v_rule.id;
    END IF;
    SELECT * INTO v_next_rule FROM public.finance_payout_rules
      WHERE payee_id=v_payee_id AND archived_at IS NULL AND id IS DISTINCT FROM v_rule.id
        AND starts_on <= v_next_month AND (ends_on IS NULL OR ends_on >= v_next_month)
      ORDER BY starts_on DESC LIMIT 1 FOR UPDATE;
    IF v_next_rule.id IS NOT NULL THEN
      IF v_next_rule.starts_on <> v_next_month OR EXISTS (
        SELECT 1 FROM public.finance_payouts payout
        JOIN public.finance_transactions tx ON tx.id=payout.finance_transaction_id
        WHERE payout.rule_id=v_next_rule.id AND tx.status='paid') THEN
        RAISE EXCEPTION 'Next-month configuration has paid history; reverse it before editing';
      END IF;
      v_rule := v_next_rule;
    ELSE
      v_rule.id := NULL;
    END IF;
  END IF;

  IF v_rule.id IS NULL THEN
    INSERT INTO public.finance_payout_rules (
      payee_id,rule_type,amount_cents,currency,percentage,include_brl,include_eur,
      day_of_month,starts_on,created_by
    ) VALUES (
      v_payee_id,v_rule_type,v_amount,v_currency,v_percentage,v_include_brl,v_include_eur,
      v_day,CASE WHEN v_mode='current' THEN v_month ELSE v_next_month END,p_actor
    ) RETURNING id INTO v_target_rule_id;
  ELSE
    v_target_rule_id := v_rule.id;
    UPDATE public.finance_payout_rules SET rule_type=v_rule_type,
      amount_cents=v_amount,currency=v_currency,percentage=v_percentage,
      include_brl=v_include_brl,include_eur=v_include_eur,day_of_month=v_day,
      is_active=true WHERE id=v_target_rule_id;
  END IF;
  PERFORM public.finance_set_payout_rule_services(v_target_rule_id,v_service_ids);
  IF v_mode='current' THEN
    PERFORM public.finance_sync_team_payouts(v_month,p_actor,v_payee_id,true);
  ELSE
    PERFORM public.finance_sync_team_payouts(v_next_month,p_actor,v_payee_id,false);
  END IF;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,new_data)
    VALUES (p_actor,'financeiro','finance_payee',v_payee_id,
      CASE WHEN v_new THEN 'finance.team_member.create'
        WHEN v_mode='next_month' THEN 'finance.team_member.update_next_month'
        WHEN v_reverse_paid THEN 'finance.team_member.reverse_recalculate'
        ELSE 'finance.team_member.update_current' END,
      p_data || jsonb_build_object('rule_id',v_target_rule_id));
  RETURN v_payee_id;
END $$;

CREATE FUNCTION public.finance_set_team_member_state(
  p_payee_id uuid, p_month date, p_action text,
  p_remove_pending boolean, p_actor uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_payee public.finance_payees%ROWTYPE;
  v_payout public.finance_payouts%ROWTYPE;
  v_tx_id uuid;
BEGIN
  IF p_actor IS NULL OR p_month IS NULL
    OR p_month <> date_trunc('month',p_month)::date
    OR p_action NOT IN ('pause','reactivate','remove') THEN
    RAISE EXCEPTION 'Invalid team member action';
  END IF;
  SELECT * INTO v_payee FROM public.finance_payees WHERE id=p_payee_id FOR UPDATE;
  IF NOT FOUND OR v_payee.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Active team member not found';
  END IF;
  IF p_action IN ('pause','remove') AND p_remove_pending THEN
    FOR v_payout IN SELECT * FROM public.finance_payouts
      WHERE payee_id=p_payee_id AND period_month=p_month AND voided_at IS NULL
      ORDER BY id FOR UPDATE
    LOOP
      SELECT id INTO v_tx_id FROM public.finance_transactions
        WHERE source_module='team_payout' AND source_id=v_payout.id
          AND status='pending';
      IF v_tx_id IS NOT NULL THEN
        PERFORM public.finance_delete_pending_transaction(
          v_tx_id,p_actor,'Pessoa pausada ou removida da equipe');
      ELSIF v_payout.finance_transaction_id IS NULL THEN
        UPDATE public.finance_payouts SET voided_at=now(),voided_by=p_actor,
          void_reason='Pessoa pausada ou removida da equipe' WHERE id=v_payout.id;
      END IF;
    END LOOP;
  END IF;
  IF p_action='pause' THEN
    UPDATE public.finance_payees SET is_active=false WHERE id=p_payee_id;
  ELSIF p_action='reactivate' THEN
    UPDATE public.finance_payees SET is_active=true WHERE id=p_payee_id;
    PERFORM public.finance_sync_team_payouts(p_month,p_actor,p_payee_id,false);
  ELSE
    UPDATE public.finance_payees SET is_active=false,archived_at=now(),archived_by=p_actor
      WHERE id=p_payee_id;
  END IF;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,new_data)
    VALUES (p_actor,'financeiro','finance_payee',p_payee_id,
      'finance.team_member.'||p_action,
      jsonb_build_object('month',p_month,'remove_pending',p_remove_pending));
END $$;

-- Recurrences retain their existing idempotent generation; team payouts now
-- take the same canonical synchronization path for fixed and percentage rules.
CREATE OR REPLACE FUNCTION public.finance_ensure_month(p_month date, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
      v_due,v_rule.category_id,v_rule.account_id,
      'recurring:'||to_char(p_month,'YYYY-MM'),v_rule.id,true,'Recorrência mensal',
      coalesce(p_actor,v_rule.created_by)
    ) ON CONFLICT (source_module,source_id) WHERE source_id IS NOT NULL DO NOTHING;
  END LOOP;
  PERFORM public.finance_sync_team_payouts(p_month,p_actor,NULL,false);
END $$;

REVOKE ALL ON FUNCTION public.finance_team_rule_overlap_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_sync_team_payouts(date,uuid,uuid,boolean)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_save_team_member(jsonb,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_set_team_member_state(uuid,date,text,boolean,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_ensure_month(date,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_sync_team_payouts(date,uuid,uuid,boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_save_team_member(jsonb,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_set_team_member_state(uuid,date,text,boolean,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_ensure_month(date,uuid)
  TO service_role;
