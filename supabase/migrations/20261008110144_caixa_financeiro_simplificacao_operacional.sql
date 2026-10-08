-- Caixa simplificado: months remain editable; payouts retain immutable amounts,
-- but pending occurrences can be voided and settlements reversed at the source.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.finance_month_closures WHERE status = 'closed')
     OR EXISTS (SELECT 1 FROM public.finance_month_distributions) THEN
    RAISE EXCEPTION 'Actual closed months/distributions exist: aborting finance simplification';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_transactions
             WHERE adjustment_for_month IS NOT NULL OR source_module = 'month_adjustment') THEN
    RAISE EXCEPTION 'Month adjustments exist: inspect before removing closure workflow';
  END IF;
END $$;

DROP FUNCTION public.finance_close_month(date, uuid);
DROP FUNCTION public.finance_prepare_month(date, uuid);
DROP TABLE public.finance_month_distributions;
DROP TABLE public.finance_month_closures;
DROP FUNCTION public.finance_month_distribution_guard();
DROP FUNCTION public.finance_month_closure_guard();
ALTER TABLE public.finance_transactions DROP COLUMN adjustment_for_month;

ALTER TABLE public.finance_payees
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.finance_payout_rules
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN include_brl boolean NOT NULL DEFAULT true,
  ADD COLUMN include_eur boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT finance_payout_rules_currency_scope_check
    CHECK (rule_type = 'fixed_monthly' OR include_brl OR include_eur);
ALTER TABLE public.finance_payouts
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN void_reason text;

CREATE TABLE public.finance_payout_rule_services (
  rule_id uuid NOT NULL REFERENCES public.finance_payout_rules(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  PRIMARY KEY (rule_id, service_id)
);
CREATE INDEX finance_payout_rule_services_service_idx
  ON public.finance_payout_rule_services (service_id);
ALTER TABLE public.finance_payout_rule_services ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_payout_rule_services FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.finance_payout_rule_services TO service_role;
INSERT INTO public.finance_payout_rule_services (rule_id, service_id)
SELECT id, service_id FROM public.finance_payout_rules
WHERE rule_type = 'service_percent' AND service_id IS NOT NULL;
ALTER TABLE public.finance_payout_rules DROP CONSTRAINT finance_payout_rules_shape_check;
ALTER TABLE public.finance_payout_rules DROP COLUMN service_id;
ALTER TABLE public.finance_payout_rules ADD CONSTRAINT finance_payout_rules_shape_check CHECK (
  (rule_type = 'fixed_monthly' AND amount_cents IS NOT NULL AND currency IS NOT NULL
    AND day_of_month IS NOT NULL AND percentage IS NULL)
  OR (rule_type IN ('revenue_percent', 'service_percent') AND percentage IS NOT NULL
    AND amount_cents IS NULL AND currency IS NULL AND day_of_month IS NULL)
);

CREATE TABLE public.finance_recurring_skips (
  rule_id uuid NOT NULL REFERENCES public.finance_recurring_rules(id) ON DELETE CASCADE,
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  skipped_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, period_month)
);
ALTER TABLE public.finance_recurring_skips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_recurring_skips FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.finance_recurring_skips TO service_role;

-- Payout monetary snapshot fields remain immutable. Only a deliberate void may
-- detach the transaction, allowing its deletion while preserving payout history.
CREATE OR REPLACE FUNCTION public.finance_payout_snapshot_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF (OLD.id, OLD.payee_id, OLD.rule_id, OLD.period_month, OLD.currency,
      OLD.base_amount_cents, OLD.percentage, OLD.amount_cents, OLD.generated_at)
     IS DISTINCT FROM
     (NEW.id, NEW.payee_id, NEW.rule_id, NEW.period_month, NEW.currency,
      NEW.base_amount_cents, NEW.percentage, NEW.amount_cents, NEW.generated_at)
    OR (OLD.finance_transaction_id IS NOT NULL
        AND OLD.finance_transaction_id IS DISTINCT FROM NEW.finance_transaction_id
        AND NOT (OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL
          AND NEW.finance_transaction_id IS NULL))
    OR (OLD.voided_at IS NOT NULL AND
        (NEW.voided_at, NEW.voided_by, NEW.void_reason) IS DISTINCT FROM
        (OLD.voided_at, OLD.voided_by, OLD.void_reason)) THEN
    RAISE EXCEPTION 'Materialized payout snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.finance_payout_base(p_rule_id uuid, p_month date, p_currency text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rule public.finance_payout_rules%ROWTYPE; v_base bigint;
BEGIN
  SELECT * INTO v_rule FROM public.finance_payout_rules WHERE id = p_rule_id;
  IF NOT FOUND OR v_rule.rule_type NOT IN ('revenue_percent', 'service_percent')
    OR p_currency NOT IN ('BRL', 'EUR')
    OR (p_currency = 'BRL' AND NOT v_rule.include_brl)
    OR (p_currency = 'EUR' AND NOT v_rule.include_eur) THEN RETURN 0; END IF;
  IF v_rule.rule_type = 'revenue_percent' THEN
    SELECT coalesce(sum(settled_amount_cents), 0) INTO v_base
    FROM public.finance_transactions
    WHERE type = 'income' AND status = 'received'
      AND settled_currency = p_currency AND settled_amount_cents IS NOT NULL
      AND paid_at >= p_month AND paid_at < p_month + interval '1 month';
  ELSE
    SELECT coalesce(sum(o.settled_amount_cents), 0) INTO v_base
    FROM public.orders o
    WHERE o.payment_status = 'aprovado'
      AND o.settled_currency = p_currency AND o.settled_amount_cents IS NOT NULL
      AND o.paid_at >= p_month AND o.paid_at < p_month + interval '1 month'
      AND EXISTS (SELECT 1 FROM public.finance_payout_rule_services rs
                  WHERE rs.rule_id = p_rule_id AND rs.service_id = o.service_id);
  END IF;
  RETURN v_base;
END $$;

CREATE OR REPLACE FUNCTION public.finance_payout_projection(p_month date)
RETURNS TABLE (rule_id uuid, payee_id uuid, currency text, base_amount_cents bigint,
  percentage numeric, projected_amount_cents bigint, payout_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT r.id, r.payee_id, c.currency, b.base_amount_cents, r.percentage,
    round(b.base_amount_cents * r.percentage / 100)::bigint, p.id
  FROM public.finance_payout_rules r
  JOIN public.finance_payees payee ON payee.id = r.payee_id
  CROSS JOIN (VALUES ('BRL'::text), ('EUR'::text)) c(currency)
  CROSS JOIN LATERAL (SELECT public.finance_payout_base(r.id, p_month, c.currency)
    AS base_amount_cents) b
  LEFT JOIN public.finance_payouts p ON p.rule_id = r.id
    AND p.period_month = p_month AND p.currency = c.currency
  WHERE r.rule_type IN ('revenue_percent', 'service_percent')
    AND r.is_active AND payee.is_active
    AND r.archived_at IS NULL AND payee.archived_at IS NULL
    AND r.starts_on <= p_month AND (r.ends_on IS NULL OR r.ends_on >= p_month)
    AND (b.base_amount_cents > 0 OR p.id IS NOT NULL)
    AND (p.id IS NULL OR p.voided_at IS NULL)
$$;

CREATE FUNCTION public.finance_set_payout_rule_services(p_rule_id uuid, p_service_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_type text; v_ids uuid[];
BEGIN
  SELECT rule_type INTO v_type FROM public.finance_payout_rules WHERE id = p_rule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout rule not found'; END IF;
  SELECT coalesce(array_agg(DISTINCT item), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(coalesce(p_service_ids, ARRAY[]::uuid[])) item;
  IF v_type = 'service_percent' AND cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'At least one service is required';
  END IF;
  IF v_type <> 'service_percent' AND cardinality(v_ids) > 0 THEN
    RAISE EXCEPTION 'Services are only valid for service percentage rules';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) item
             WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE id = item)) THEN
    RAISE EXCEPTION 'Unknown service';
  END IF;
  DELETE FROM public.finance_payout_rule_services WHERE rule_id = p_rule_id;
  INSERT INTO public.finance_payout_rule_services(rule_id, service_id)
    SELECT p_rule_id, unnest(v_ids);
END $$;

CREATE OR REPLACE FUNCTION public.finance_ensure_month(p_month date, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_rule public.finance_recurring_rules%ROWTYPE;
  v_fixed record;
  v_payout_id uuid;
  v_transaction_id uuid;
  v_due date;
  v_last_day integer;
  v_category_id uuid;
BEGIN
  IF p_month <> date_trunc('month', p_month)::date THEN
    RAISE EXCEPTION 'Month must be its first day';
  END IF;
  v_last_day := extract(day FROM (p_month + interval '1 month - 1 day'))::integer;
  FOR v_rule IN SELECT * FROM public.finance_recurring_rules
    WHERE is_active AND frequency = 'monthly' AND starts_on <= p_month
      AND (ends_on IS NULL OR ends_on >= p_month)
      AND NOT EXISTS (SELECT 1 FROM public.finance_recurring_skips s
                      WHERE s.rule_id = finance_recurring_rules.id AND s.period_month = p_month)
  LOOP
    v_due := p_month + (least(v_rule.day_of_month, v_last_day) - 1);
    INSERT INTO public.finance_transactions (
      type, status, description, amount_cents, currency, due_date, category_id,
      account_id, source_module, source_id, is_automatic, notes, created_by
    ) VALUES (
      v_rule.type, CASE WHEN v_due > CURRENT_DATE THEN 'planned' ELSE 'pending' END,
      v_rule.description, v_rule.amount_cents, v_rule.currency, v_due, v_rule.category_id,
      v_rule.account_id, 'recurring:' || to_char(p_month, 'YYYY-MM'), v_rule.id,
      true, 'Recorrência mensal', coalesce(p_actor, v_rule.created_by)
    ) ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO NOTHING;
  END LOOP;

  SELECT id INTO v_category_id FROM public.finance_categories
    WHERE name = 'Equipe' AND type = 'expense' AND is_active LIMIT 1;
  IF v_category_id IS NULL THEN RAISE EXCEPTION 'Finance category Equipe unavailable'; END IF;
  FOR v_fixed IN
    SELECT r.*, p.name AS payee_name FROM public.finance_payout_rules r
    JOIN public.finance_payees p ON p.id = r.payee_id
    WHERE r.rule_type = 'fixed_monthly' AND r.is_active AND p.is_active
      AND r.archived_at IS NULL AND p.archived_at IS NULL
      AND r.starts_on <= p_month AND (r.ends_on IS NULL OR r.ends_on >= p_month)
  LOOP
    v_due := p_month + (least(v_fixed.day_of_month, v_last_day) - 1);
    SELECT id INTO v_payout_id FROM public.finance_payouts
      WHERE rule_id = v_fixed.id AND period_month = p_month AND percentage IS NULL;
    IF v_payout_id IS NULL THEN
      INSERT INTO public.finance_payouts (
        payee_id, rule_id, period_month, currency, base_amount_cents,
        percentage, amount_cents, created_by
      ) VALUES (
        v_fixed.payee_id, v_fixed.id, p_month, v_fixed.currency, v_fixed.amount_cents,
        NULL, v_fixed.amount_cents, coalesce(p_actor, v_fixed.created_by)
      ) ON CONFLICT DO NOTHING RETURNING id INTO v_payout_id;
      IF v_payout_id IS NULL THEN
        SELECT id INTO v_payout_id FROM public.finance_payouts
          WHERE rule_id = v_fixed.id AND period_month = p_month AND percentage IS NULL;
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.finance_payouts
               WHERE id = v_payout_id AND voided_at IS NOT NULL) THEN
      v_payout_id := NULL;
      CONTINUE;
    END IF;
    INSERT INTO public.finance_transactions (
      type, status, description, amount_cents, currency, due_date, category_id,
      source_module, source_id, is_automatic, created_by
    )
    SELECT 'expense', CASE WHEN v_due > CURRENT_DATE THEN 'planned' ELSE 'pending' END,
      'Repasse - ' || v_fixed.payee_name, payout.amount_cents, payout.currency,
      v_due, v_category_id, 'team_payout', payout.id, true,
      coalesce(p_actor, v_fixed.created_by)
    FROM public.finance_payouts payout WHERE payout.id = v_payout_id
    ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO NOTHING;
    SELECT id INTO v_transaction_id FROM public.finance_transactions
      WHERE source_module = 'team_payout' AND source_id = v_payout_id;
    UPDATE public.finance_payouts SET finance_transaction_id = v_transaction_id
      WHERE id = v_payout_id AND finance_transaction_id IS NULL;
    v_payout_id := NULL;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.finance_materialize_payout(
  p_rule_id uuid, p_month date, p_currency text, p_actor uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_rule public.finance_payout_rules%ROWTYPE;
  v_payee_name text;
  v_base bigint;
  v_amount bigint;
  v_payout_id uuid;
  v_voided_at timestamptz;
  v_transaction_id uuid;
  v_category_id uuid;
BEGIN
  IF extract(day FROM p_month) <> 1 OR p_currency NOT IN ('BRL', 'EUR') THEN
    RAISE EXCEPTION 'Invalid period or currency';
  END IF;
  SELECT r.* INTO v_rule FROM public.finance_payout_rules r
    JOIN public.finance_payees p ON p.id = r.payee_id
    WHERE r.id = p_rule_id AND r.is_active AND p.is_active
      AND r.archived_at IS NULL AND p.archived_at IS NULL
      AND r.starts_on <= p_month AND (r.ends_on IS NULL OR r.ends_on >= p_month);
  IF NOT FOUND OR v_rule.rule_type NOT IN ('revenue_percent', 'service_percent')
    OR (p_currency = 'BRL' AND NOT v_rule.include_brl)
    OR (p_currency = 'EUR' AND NOT v_rule.include_eur) THEN
    RAISE EXCEPTION 'Active percentage rule/currency not found';
  END IF;
  SELECT name INTO v_payee_name FROM public.finance_payees WHERE id = v_rule.payee_id;
  SELECT id, voided_at INTO v_payout_id, v_voided_at FROM public.finance_payouts
    WHERE rule_id = p_rule_id AND period_month = p_month AND currency = p_currency;
  IF v_voided_at IS NOT NULL THEN RAISE EXCEPTION 'Payout was voided for this month/currency'; END IF;
  IF v_payout_id IS NOT NULL THEN RETURN v_payout_id; END IF;
  v_base := public.finance_payout_base(p_rule_id, p_month, p_currency);
  v_amount := round(v_base * v_rule.percentage / 100)::bigint;
  IF v_base <= 0 OR v_amount <= 0 OR v_amount > 2147483647 THEN
    RAISE EXCEPTION 'Payout base or amount invalid';
  END IF;
  SELECT id INTO v_category_id FROM public.finance_categories
    WHERE name = 'Equipe' AND type = 'expense' AND is_active LIMIT 1;
  IF v_category_id IS NULL THEN RAISE EXCEPTION 'Finance category Equipe unavailable'; END IF;
  INSERT INTO public.finance_payouts (
    payee_id, rule_id, period_month, currency, base_amount_cents, percentage,
    amount_cents, created_by
  ) VALUES (
    v_rule.payee_id, v_rule.id, p_month, p_currency, v_base, v_rule.percentage,
    v_amount, coalesce(p_actor, v_rule.created_by)
  ) ON CONFLICT (rule_id, period_month, currency) DO NOTHING RETURNING id INTO v_payout_id;
  IF v_payout_id IS NULL THEN
    SELECT id, voided_at INTO v_payout_id, v_voided_at FROM public.finance_payouts
      WHERE rule_id = p_rule_id AND period_month = p_month AND currency = p_currency;
    IF v_voided_at IS NOT NULL THEN RAISE EXCEPTION 'Payout was voided for this month/currency'; END IF;
  END IF;
  INSERT INTO public.finance_transactions (
    type, status, description, amount_cents, currency, due_date, category_id,
    source_module, source_id, is_automatic, created_by
  )
  SELECT 'expense', 'pending', 'Repasse - ' || v_payee_name,
    p.amount_cents, p.currency, (p_month + interval '1 month - 1 day')::date,
    v_category_id, 'team_payout', p.id, true, coalesce(p_actor, v_rule.created_by)
  FROM public.finance_payouts p WHERE p.id = v_payout_id AND p.voided_at IS NULL
  ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO NOTHING;
  SELECT id INTO v_transaction_id FROM public.finance_transactions
    WHERE source_module = 'team_payout' AND source_id = v_payout_id;
  UPDATE public.finance_payouts SET finance_transaction_id = v_transaction_id
    WHERE id = v_payout_id AND finance_transaction_id IS NULL;
  RETURN v_payout_id;
END $$;

-- The two operations below are the sole Caixa mutation path for historical
-- pending/realized transactions. They keep Orders as the canonical source.
CREATE FUNCTION public.finance_delete_pending_transaction(
  p_id uuid, p_actor uuid, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tx public.finance_transactions%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_month date;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required'; END IF;
  SELECT * INTO v_tx FROM public.finance_transactions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_tx.status NOT IN ('planned','pending','overdue')
    OR v_tx.settled_amount_cents IS NOT NULL OR v_tx.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only unsettled pending transactions can be excluded';
  END IF;
  IF v_tx.source_module = 'pdv' THEN RAISE EXCEPTION 'PDV must be changed at its source'; END IF;
  IF v_tx.source_module = 'orders' THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_tx.source_id FOR UPDATE;
    IF NOT FOUND OR v_order.payment_status <> 'pendente' THEN
      RAISE EXCEPTION 'Order is not pending';
    END IF;
    UPDATE public.orders SET payment_status = 'recusado' WHERE id = v_order.id;
  ELSIF v_tx.source_module = 'manual' THEN
    DELETE FROM public.finance_transactions WHERE id = p_id;
  ELSIF v_tx.source_module LIKE 'recurring:%' THEN
    v_month := date_trunc('month', v_tx.due_date)::date;
    INSERT INTO public.finance_recurring_skips(rule_id, period_month, skipped_by, reason)
      VALUES (v_tx.source_id, v_month, p_actor, p_reason)
      ON CONFLICT (rule_id, period_month) DO NOTHING;
    DELETE FROM public.finance_transactions WHERE id = p_id;
  ELSIF v_tx.source_module = 'team_payout' THEN
    UPDATE public.finance_payouts
      SET voided_at = now(), voided_by = p_actor, void_reason = p_reason,
        finance_transaction_id = NULL
      WHERE id = v_tx.source_id AND voided_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active payout not found'; END IF;
    DELETE FROM public.finance_transactions WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Transaction source must be corrected at origin';
  END IF;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data)
    VALUES (p_actor,'financeiro','finance_transaction',p_id,'finance.transaction.delete',
      to_jsonb(v_tx),jsonb_build_object('reason',p_reason,'source',v_tx.source_module));
END $$;

CREATE FUNCTION public.finance_reverse_settlement(
  p_id uuid, p_actor uuid, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tx public.finance_transactions%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_status text;
BEGIN
  IF p_actor IS NULL OR length(btrim(coalesce(p_reason,''))) < 3 THEN
    RAISE EXCEPTION 'Actor and reason are required';
  END IF;
  SELECT * INTO v_tx FROM public.finance_transactions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_tx.status NOT IN ('received','paid') THEN
    RAISE EXCEPTION 'Only realized transactions can be reversed';
  END IF;
  IF v_tx.source_module = 'pdv' THEN RAISE EXCEPTION 'PDV must be changed at its source'; END IF;
  IF v_tx.source_module = 'orders' THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_tx.source_id FOR UPDATE;
    IF NOT FOUND OR v_order.payment_status <> 'aprovado' THEN
      RAISE EXCEPTION 'Approved order not found';
    END IF;
    IF v_order.payment_provider_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Provider-confirmed payment requires its commercial refund flow';
    END IF;
    UPDATE public.orders SET payment_status = 'pendente', paid_at = NULL,
      settled_amount_cents = NULL, settled_currency = NULL, payment_account_id = NULL,
      fx_reference_rate = NULL, fx_reference_date = NULL, fx_rate = NULL,
      fx_source = NULL, fx_locked_at = NULL
      WHERE id = v_order.id;
  ELSIF v_tx.source_module = 'manual' OR v_tx.source_module = 'team_payout'
     OR v_tx.source_module LIKE 'recurring:%' THEN
    v_status := CASE WHEN v_tx.due_date <= CURRENT_DATE THEN 'pending' ELSE 'planned' END;
    UPDATE public.finance_transactions SET status = v_status,
      settled_amount_cents = NULL, settled_currency = NULL, paid_at = NULL,
      account_id = NULL, fx_reference_rate = NULL, fx_rate = NULL,
      fx_source = NULL, fx_date = NULL
      WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Transaction source must be corrected at origin';
  END IF;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data)
    VALUES (p_actor,'financeiro','finance_transaction',p_id,'finance.transaction.reverse',
      to_jsonb(v_tx),jsonb_build_object('reason',p_reason,'new_status',
        CASE WHEN v_tx.source_module = 'orders' THEN 'pending' ELSE v_status END));
END $$;

CREATE FUNCTION public.finance_account_currency_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency AND (
    EXISTS (SELECT 1 FROM public.finance_transactions WHERE account_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.orders WHERE payment_account_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.finance_recurring_rules WHERE account_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'Currency of an account with history cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_account_currency_guard BEFORE UPDATE OF currency
  ON public.finance_accounts FOR EACH ROW
  EXECUTE FUNCTION public.finance_account_currency_guard();

CREATE FUNCTION public.finance_system_category_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF OLD.is_system THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'System category cannot be deleted'; END IF;
    IF (NEW.name, NEW.type, NEW.is_system, NEW.is_active) IS DISTINCT FROM
       (OLD.name, OLD.type, OLD.is_system, OLD.is_active) THEN
      RAISE EXCEPTION 'System category cannot be changed';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- Remove only the unused system category associated with former distributions.
DELETE FROM public.finance_categories c
WHERE c.name = 'Distribuição de lucros' AND c.type = 'expense'
  AND NOT EXISTS (SELECT 1 FROM public.finance_transactions t WHERE t.category_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.finance_recurring_rules r WHERE r.category_id = c.id);
CREATE TRIGGER finance_system_category_guard BEFORE UPDATE OR DELETE
  ON public.finance_categories FOR EACH ROW
  EXECUTE FUNCTION public.finance_system_category_guard();

-- The production project has 15 historical Wise EUR orders that were paid.
-- Preview branches created without data have no orders; skip the backfill there.
-- Any nonempty dataset must still match the verified production cohort exactly.
DO $$
DECLARE v_orders integer; v_count integer; v_total bigint; v_bad integer;
BEGIN
  SELECT count(*) INTO v_orders FROM public.orders;
  SELECT count(*),coalesce(sum(coalesce(payment_amount_cents,amount_cents)),0),
    count(*) FILTER (WHERE coalesce(payment_currency,currency) <> 'EUR'
      OR lower(coalesce(payment_method,'')) <> 'wise'
      OR public.finance_account_id_for_payment(payment_method,'EUR') IS NULL)
    INTO v_count,v_total,v_bad
  FROM public.orders
  WHERE payment_status = 'pendente' AND created_at < '2026-10-01'::timestamptz;
  IF v_orders > 0 THEN
    IF v_count <> 15 OR v_total <> 152500 OR v_bad <> 0 THEN
      RAISE EXCEPTION 'Historical pending order cohort changed: count %, cents %, incompatible %',
        v_count,v_total,v_bad;
    END IF;
  END IF;
END $$;
UPDATE public.orders o SET
  payment_status = 'aprovado',
  settled_amount_cents = coalesce(o.payment_amount_cents,o.amount_cents),
  settled_currency = coalesce(o.payment_currency,o.currency),
  paid_at = o.created_at,
  payment_account_id = public.finance_account_id_for_payment(
    o.payment_method,coalesce(o.payment_currency,o.currency))
WHERE o.payment_status = 'pendente' AND o.created_at < '2026-10-01'::timestamptz;

DROP FUNCTION public.finance_month_is_closed(date);

REVOKE ALL ON FUNCTION public.finance_account_currency_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_system_category_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_payout_snapshot_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_payout_base(uuid,date,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_payout_projection(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_ensure_month(date,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_materialize_payout(uuid,date,text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_set_payout_rule_services(uuid,uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_delete_pending_transaction(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_reverse_settlement(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_payout_base(uuid,date,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_payout_projection(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_ensure_month(date,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_materialize_payout(uuid,date,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_set_payout_rule_services(uuid,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_delete_pending_transaction(uuid,uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_reverse_settlement(uuid,uuid,text)
  TO service_role;
