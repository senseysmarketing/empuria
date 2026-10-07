-- Financeiro 3: versioned monthly closing. All monetary amounts are cents in
-- their own currency; no BRL/EUR compensation or implicit FX conversion.
CREATE TABLE public.finance_month_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month date NOT NULL UNIQUE CHECK (extract(day FROM period_month) = 1),
  status text NOT NULL CHECK (status IN ('ready', 'closed')),
  preview_snapshot jsonb,
  final_snapshot jsonb,
  prepared_at timestamptz,
  prepared_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at timestamptz,
  closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_month_closures_closed_check CHECK (
    status <> 'closed' OR
    (final_snapshot IS NOT NULL AND closed_at IS NOT NULL AND closed_by IS NOT NULL)
  )
);

CREATE TABLE public.finance_month_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_id uuid NOT NULL REFERENCES public.finance_month_closures(id),
  partner_code text NOT NULL CHECK (partner_code IN ('rossini', 'luana')),
  partner_name text NOT NULL,
  percentage numeric(5,2) NOT NULL,
  currency text NOT NULL CHECK (currency IN ('BRL', 'EUR')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  finance_transaction_id uuid UNIQUE REFERENCES public.finance_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (closure_id, partner_code, currency),
  CONSTRAINT finance_month_distributions_share_check CHECK (
    (partner_code = 'rossini' AND percentage = 70) OR
    (partner_code = 'luana' AND percentage = 30)
  )
);

ALTER TABLE public.finance_transactions
  ADD COLUMN adjustment_for_month date,
  ADD CONSTRAINT finance_transactions_adjustment_month_check CHECK (
    adjustment_for_month IS NULL OR extract(day FROM adjustment_for_month) = 1
  );
CREATE INDEX finance_transactions_adjustment_month_idx
  ON public.finance_transactions (adjustment_for_month)
  WHERE adjustment_for_month IS NOT NULL;

INSERT INTO public.finance_categories (name, type, is_system, is_active)
VALUES ('Distribuição de lucros', 'expense', true, true)
ON CONFLICT (name, type) DO UPDATE SET is_system = true, is_active = true;

-- No rows matched at migration authoring time, but keep the targeted backfill.
-- Temporarily disable the immutable-snapshot trigger only for the legacy fix.
ALTER TABLE public.finance_payouts DISABLE TRIGGER finance_payout_snapshot_guard;
UPDATE public.finance_payouts SET base_amount_cents = amount_cents
  WHERE percentage IS NULL AND base_amount_cents = 0 AND amount_cents > 0;
ALTER TABLE public.finance_payouts ENABLE TRIGGER finance_payout_snapshot_guard;

CREATE TRIGGER update_finance_month_closures_updated_at
  BEFORE UPDATE ON public.finance_month_closures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION public.finance_month_closure_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Closed month snapshot is immutable';
  END IF;
  IF NEW.status = 'closed' AND OLD.status <> 'ready' THEN
    RAISE EXCEPTION 'Month must be ready before closing';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.finance_month_is_closed(p_month date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.finance_month_closures
    WHERE period_month = date_trunc('month', p_month)::date AND status = 'closed'
  )
$$;

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
  IF public.finance_month_is_closed(p_month) THEN RETURN; END IF;
  IF p_month <> date_trunc('month', p_month)::date THEN
    RAISE EXCEPTION 'Month must be its first day';
  END IF;
  v_last_day := extract(day FROM (p_month + interval '1 month - 1 day'))::integer;
  FOR v_rule IN SELECT * FROM public.finance_recurring_rules
    WHERE is_active AND frequency = 'monthly' AND starts_on <= p_month
      AND (ends_on IS NULL OR ends_on >= p_month)
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
CREATE TRIGGER finance_month_closure_guard BEFORE UPDATE OR DELETE
  ON public.finance_month_closures FOR EACH ROW
  EXECUTE FUNCTION public.finance_month_closure_guard();

CREATE FUNCTION public.finance_month_distribution_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Distribution snapshot is immutable'; END IF;
  IF (OLD.id, OLD.closure_id, OLD.partner_code, OLD.partner_name, OLD.percentage,
      OLD.currency, OLD.amount_cents, OLD.created_at) IS DISTINCT FROM
     (NEW.id, NEW.closure_id, NEW.partner_code, NEW.partner_name, NEW.percentage,
      NEW.currency, NEW.amount_cents, NEW.created_at)
     OR (OLD.finance_transaction_id IS NOT NULL AND
         OLD.finance_transaction_id IS DISTINCT FROM NEW.finance_transaction_id) THEN
    RAISE EXCEPTION 'Distribution snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_month_distribution_guard BEFORE UPDATE OR DELETE
  ON public.finance_month_distributions FOR EACH ROW
  EXECUTE FUNCTION public.finance_month_distribution_guard();

ALTER TABLE public.finance_month_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_month_distributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_month_closures, public.finance_month_distributions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.finance_month_closures,
  public.finance_month_distributions TO service_role;

-- Live preview only. A closed month is always rendered from final_snapshot.
CREATE FUNCTION public.finance_month_snapshot(p_month date, p_include_projection boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_currency text;
  v_revenue bigint;
  v_operational bigint;
  v_team bigint;
  v_recurring bigint;
  v_projected bigint;
  v_receivable bigint;
  v_payable bigint;
  v_overdue_previous bigint;
  v_result bigint;
  v_profit bigint;
  v_rossini bigint;
  v_snapshot jsonb := jsonb_build_object('version', 1, 'period_month', p_month);
BEGIN
  IF p_month IS NULL OR extract(day FROM p_month) <> 1 THEN
    RAISE EXCEPTION 'Month must be its first day';
  END IF;
  FOREACH v_currency IN ARRAY ARRAY['BRL'::text, 'EUR'::text] LOOP
    SELECT coalesce(sum(settled_amount_cents), 0)::bigint INTO v_revenue
    FROM public.finance_transactions
    WHERE type = 'income' AND status = 'received'
      AND paid_at >= p_month AND paid_at < p_month + interval '1 month'
      AND settled_currency = v_currency AND settled_amount_cents IS NOT NULL;

    SELECT
      coalesce(sum(CASE WHEN source_module = 'team_payout' THEN recognized_cents ELSE 0 END), 0)::bigint,
      coalesce(sum(CASE WHEN source_module LIKE 'recurring:%' THEN recognized_cents ELSE 0 END), 0)::bigint,
      coalesce(sum(CASE WHEN source_module <> 'team_payout' AND source_module NOT LIKE 'recurring:%'
        THEN recognized_cents ELSE 0 END), 0)::bigint
    INTO v_team, v_recurring, v_operational
    FROM (
      SELECT source_module,
        CASE WHEN status = 'paid' AND settled_amount_cents IS NOT NULL
          THEN settled_amount_cents ELSE amount_cents END AS recognized_cents
      FROM public.finance_transactions
      WHERE type = 'expense' AND status <> 'canceled'
        AND source_module <> 'partner_distribution'
        AND due_date >= p_month AND due_date < p_month + interval '1 month'
        AND (CASE WHEN status = 'paid' AND settled_currency IS NOT NULL
          THEN settled_currency ELSE currency END) = v_currency
    ) expenses;

    SELECT coalesce(sum(projected_amount_cents), 0)::bigint INTO v_projected
    FROM public.finance_payout_projection(p_month)
    WHERE currency = v_currency AND payout_id IS NULL;
    IF NOT p_include_projection THEN v_projected := 0; END IF;

    SELECT
      coalesce(sum(CASE WHEN type = 'income' THEN amount_cents ELSE 0 END), 0)::bigint,
      coalesce(sum(CASE WHEN type = 'expense' THEN amount_cents ELSE 0 END), 0)::bigint
    INTO v_receivable, v_payable
    FROM public.finance_transactions
    WHERE status IN ('planned', 'pending', 'overdue')
      AND currency = v_currency
      AND due_date >= p_month AND due_date < p_month + interval '1 month';

    SELECT coalesce(sum(amount_cents), 0)::bigint INTO v_overdue_previous
    FROM public.finance_transactions
    WHERE status IN ('planned', 'pending', 'overdue')
      AND currency = v_currency AND due_date < p_month;

    v_result := v_revenue - v_operational - v_team - v_recurring - v_projected;
    v_profit := greatest(v_result, 0);
    v_rossini := round(v_profit * 0.70)::bigint;
    v_snapshot := v_snapshot || jsonb_build_object(v_currency, jsonb_build_object(
      'revenue_realized_cents', v_revenue,
      'operational_expenses_cents', v_operational,
      'team_payouts_cents', v_team,
      'recurring_expenses_cents', v_recurring,
      'projected_payouts_cents', v_projected,
      'recognized_expenses_cents', v_operational + v_team + v_recurring + v_projected,
      'result_cents', v_result,
      'distributable_profit_cents', v_profit,
      'receivable_cents', v_receivable,
      'payable_cents', v_payable,
      'overdue_previous_cents', v_overdue_previous,
      'rossini_cents', v_rossini,
      'luana_cents', v_profit - v_rossini
    ));
  END LOOP;
  RETURN v_snapshot;
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
  v_transaction_id uuid;
  v_category_id uuid;
BEGIN
  IF public.finance_month_is_closed(p_month) THEN
    RAISE EXCEPTION 'Closed month cannot materialize payouts';
  END IF;
  IF extract(day FROM p_month) <> 1 OR p_currency NOT IN ('BRL', 'EUR') THEN
    RAISE EXCEPTION 'Invalid period or currency';
  END IF;
  SELECT r.* INTO v_rule FROM public.finance_payout_rules r
    JOIN public.finance_payees p ON p.id = r.payee_id
    WHERE r.id = p_rule_id AND r.is_active AND p.is_active
      AND r.starts_on <= p_month AND (r.ends_on IS NULL OR r.ends_on >= p_month);
  IF NOT FOUND OR v_rule.rule_type NOT IN ('revenue_percent', 'service_percent') THEN
    RAISE EXCEPTION 'Active percentage rule not found';
  END IF;
  SELECT name INTO v_payee_name FROM public.finance_payees WHERE id = v_rule.payee_id;
  SELECT id INTO v_payout_id FROM public.finance_payouts
    WHERE rule_id = p_rule_id AND period_month = p_month AND currency = p_currency;
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
    SELECT id INTO v_payout_id FROM public.finance_payouts
      WHERE rule_id = p_rule_id AND period_month = p_month AND currency = p_currency;
  END IF;
  INSERT INTO public.finance_transactions (
    type, status, description, amount_cents, currency, due_date, category_id,
    source_module, source_id, is_automatic, created_by
  )
  SELECT 'expense', 'pending', 'Repasse - ' || v_payee_name,
    p.amount_cents, p.currency, (p_month + interval '1 month - 1 day')::date,
    v_category_id, 'team_payout', p.id, true, coalesce(p_actor, v_rule.created_by)
  FROM public.finance_payouts p WHERE p.id = v_payout_id
  ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO NOTHING;
  SELECT id INTO v_transaction_id FROM public.finance_transactions
    WHERE source_module = 'team_payout' AND source_id = v_payout_id;
  UPDATE public.finance_payouts SET finance_transaction_id = v_transaction_id
    WHERE id = v_payout_id AND finance_transaction_id IS NULL;
  RETURN v_payout_id;
END $$;

CREATE FUNCTION public.finance_prepare_month(p_month date, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_closure public.finance_month_closures%ROWTYPE; v_preview jsonb;
BEGIN
  IF p_actor IS NULL OR p_month IS NULL OR extract(day FROM p_month) <> 1 THEN
    RAISE EXCEPTION 'Actor and month are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('finance-month-close'),
    (extract(year FROM p_month)::integer * 12 + extract(month FROM p_month)::integer));
  SELECT * INTO v_closure FROM public.finance_month_closures
    WHERE period_month = p_month FOR UPDATE;
  IF FOUND AND v_closure.status = 'closed' THEN RETURN to_jsonb(v_closure); END IF;
  PERFORM public.finance_ensure_month(p_month, p_actor);
  v_preview := public.finance_month_snapshot(p_month, true);
  INSERT INTO public.finance_month_closures
    (period_month, status, preview_snapshot, prepared_at, prepared_by)
  VALUES (p_month, 'ready', v_preview, now(), p_actor)
  ON CONFLICT (period_month) DO UPDATE SET
    preview_snapshot = excluded.preview_snapshot,
    prepared_at = excluded.prepared_at,
    prepared_by = excluded.prepared_by
  RETURNING * INTO v_closure;
  INSERT INTO public.audit_logs
    (actor_id, module, entity_type, entity_id, action, new_data)
  VALUES (p_actor, 'financeiro', 'finance_month_closure', v_closure.id,
    'finance.month.prepare', jsonb_build_object('period_month', p_month));
  RETURN to_jsonb(v_closure);
END $$;

CREATE FUNCTION public.finance_close_month(p_month date, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_closure public.finance_month_closures%ROWTYPE;
  v_projection record;
  v_snapshot jsonb;
  v_currency text;
  v_partner text;
  v_partner_name text;
  v_amount bigint;
  v_profit bigint;
  v_distribution_id uuid;
  v_transaction_id uuid;
  v_category_id uuid;
  v_due date;
BEGIN
  IF p_actor IS NULL OR p_month IS NULL OR extract(day FROM p_month) <> 1 THEN
    RAISE EXCEPTION 'Actor and month are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('finance-month-close'),
    (extract(year FROM p_month)::integer * 12 + extract(month FROM p_month)::integer));
  SELECT * INTO v_closure FROM public.finance_month_closures
    WHERE period_month = p_month FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prepare the month before closing'; END IF;
  IF v_closure.status = 'closed' THEN RETURN to_jsonb(v_closure); END IF;
  PERFORM public.finance_ensure_month(p_month, p_actor);
  FOR v_projection IN SELECT * FROM public.finance_payout_projection(p_month)
    WHERE payout_id IS NULL AND projected_amount_cents > 0
  LOOP
    PERFORM public.finance_materialize_payout(
      v_projection.rule_id, p_month, v_projection.currency, p_actor);
  END LOOP;
  v_snapshot := public.finance_month_snapshot(p_month, false);
  SELECT id INTO v_category_id FROM public.finance_categories
    WHERE name = 'Distribuição de lucros' AND type = 'expense' AND is_active LIMIT 1;
  IF v_category_id IS NULL THEN RAISE EXCEPTION 'Distribution category unavailable'; END IF;
  v_due := (p_month + interval '1 month - 1 day')::date;
  FOREACH v_currency IN ARRAY ARRAY['BRL'::text, 'EUR'::text] LOOP
    v_profit := (v_snapshot -> v_currency ->> 'distributable_profit_cents')::bigint;
    IF v_profit > 2147483647 THEN RAISE EXCEPTION 'Distribution exceeds integer cents'; END IF;
    FOREACH v_partner IN ARRAY ARRAY['rossini'::text, 'luana'::text] LOOP
      v_partner_name := CASE WHEN v_partner = 'rossini' THEN 'Rossini' ELSE 'Luana' END;
      v_amount := (v_snapshot -> v_currency ->>
        CASE WHEN v_partner = 'rossini' THEN 'rossini_cents' ELSE 'luana_cents' END)::bigint;
      IF v_amount > 0 THEN
        INSERT INTO public.finance_month_distributions
          (closure_id, partner_code, partner_name, percentage, currency, amount_cents)
        VALUES (v_closure.id, v_partner, v_partner_name,
          CASE WHEN v_partner = 'rossini' THEN 70 ELSE 30 END,
          v_currency, v_amount)
        ON CONFLICT (closure_id, partner_code, currency) DO NOTHING
        RETURNING id INTO v_distribution_id;
        IF v_distribution_id IS NULL THEN
          SELECT id INTO v_distribution_id FROM public.finance_month_distributions
          WHERE closure_id = v_closure.id AND partner_code = v_partner
            AND currency = v_currency;
        END IF;
        INSERT INTO public.finance_transactions
          (type, status, description, amount_cents, currency, due_date,
           category_id, source_module, source_id, is_automatic, created_by)
        VALUES ('expense', 'pending', 'Distribuição de lucros - ' || v_partner_name,
          v_amount, v_currency, v_due, v_category_id,
          'partner_distribution', v_distribution_id, true, p_actor)
        ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO NOTHING;
        SELECT id INTO v_transaction_id FROM public.finance_transactions
          WHERE source_module = 'partner_distribution' AND source_id = v_distribution_id;
        UPDATE public.finance_month_distributions
          SET finance_transaction_id = v_transaction_id
          WHERE id = v_distribution_id AND finance_transaction_id IS NULL;
        v_distribution_id := NULL;
      END IF;
    END LOOP;
  END LOOP;
  UPDATE public.finance_month_closures SET status = 'closed',
    final_snapshot = v_snapshot, closed_at = now(), closed_by = p_actor
    WHERE id = v_closure.id RETURNING * INTO v_closure;
  INSERT INTO public.audit_logs
    (actor_id, module, entity_type, entity_id, action, new_data)
  VALUES (p_actor, 'financeiro', 'finance_month_closure', v_closure.id,
    'finance.month.close', jsonb_build_object('period_month', p_month,
      'final_snapshot', v_snapshot));
  RETURN to_jsonb(v_closure);
END $$;

-- Small server-side aggregates for the final dashboard. No cross-currency sums.
CREATE FUNCTION public.finance_dashboard_month(p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_daily jsonb; v_accounts jsonb; v_services jsonb; v_expenses jsonb;
  v_recurring jsonb; v_team jsonb;
BEGIN
  IF p_month IS NULL OR extract(day FROM p_month) <> 1 THEN
    RAISE EXCEPTION 'Month must be its first day';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.day, d.currency), '[]'::jsonb)
  INTO v_daily FROM (
    SELECT paid_at::date AS day, settled_currency AS currency,
      sum(CASE WHEN type = 'income' THEN settled_amount_cents ELSE 0 END)::bigint AS income_cents,
      sum(CASE WHEN type = 'expense' THEN settled_amount_cents ELSE 0 END)::bigint AS expense_cents
    FROM public.finance_transactions
    WHERE paid_at >= p_month AND paid_at < p_month + interval '1 month'
      AND settled_currency IN ('BRL', 'EUR') AND settled_amount_cents IS NOT NULL
      AND status IN ('received', 'paid')
    GROUP BY paid_at::date, settled_currency
  ) d;

  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.currency, a.account_name), '[]'::jsonb)
  INTO v_accounts FROM (
    SELECT t.account_id, a.name AS account_name, t.settled_currency AS currency,
      sum(CASE WHEN t.type = 'income' THEN t.settled_amount_cents ELSE 0 END)::bigint AS income_cents,
      sum(CASE WHEN t.type = 'expense' THEN t.settled_amount_cents ELSE 0 END)::bigint AS expense_cents,
      sum(CASE WHEN t.type = 'income' THEN t.settled_amount_cents
        ELSE -t.settled_amount_cents END)::bigint AS net_cents
    FROM public.finance_transactions t JOIN public.finance_accounts a ON a.id = t.account_id
    WHERE t.paid_at >= p_month AND t.paid_at < p_month + interval '1 month'
      AND t.settled_currency IN ('BRL', 'EUR') AND t.settled_amount_cents IS NOT NULL
      AND t.status IN ('received', 'paid')
    GROUP BY t.account_id, a.name, t.settled_currency
  ) a;

  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.currency, s.revenue_cents DESC), '[]'::jsonb)
  INTO v_services FROM (
    SELECT o.service_id, max(o.service_title) AS service_title,
      o.settled_currency AS currency, count(*)::integer AS quantity,
      sum(o.settled_amount_cents)::bigint AS revenue_cents
    FROM public.orders o
    WHERE o.payment_status = 'aprovado' AND o.paid_at >= p_month
      AND o.paid_at < p_month + interval '1 month'
      AND o.settled_currency IN ('BRL', 'EUR') AND o.settled_amount_cents IS NOT NULL
    GROUP BY o.service_id, o.settled_currency
  ) s;

  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.currency, e.amount_cents DESC), '[]'::jsonb)
  INTO v_expenses FROM (
    SELECT t.category_id, coalesce(c.name, 'Sem categoria') AS category_name,
      t.settled_currency AS currency, sum(t.settled_amount_cents)::bigint AS amount_cents
    FROM public.finance_transactions t
    LEFT JOIN public.finance_categories c ON c.id = t.category_id
    WHERE t.type = 'expense' AND t.status = 'paid'
      AND t.source_module <> 'partner_distribution'
      AND t.paid_at >= p_month AND t.paid_at < p_month + interval '1 month'
      AND t.settled_currency IN ('BRL', 'EUR') AND t.settled_amount_cents IS NOT NULL
    GROUP BY t.category_id, c.name, t.settled_currency
  ) e;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.currency), '[]'::jsonb)
  INTO v_recurring FROM (
    SELECT c.currency,
      coalesce((SELECT sum(t.amount_cents) FROM public.finance_transactions t
        WHERE t.source_module LIKE 'recurring:%' AND t.status <> 'canceled'
          AND t.currency = c.currency AND t.due_date >= p_month
          AND t.due_date < p_month + interval '1 month'), 0)::bigint AS planned_cents,
      coalesce((SELECT sum(t.settled_amount_cents) FROM public.finance_transactions t
        WHERE t.source_module LIKE 'recurring:%' AND t.status IN ('received','paid')
          AND t.settled_currency = c.currency AND t.paid_at >= p_month
          AND t.paid_at < p_month + interval '1 month'), 0)::bigint AS paid_cents,
      coalesce((SELECT sum(t.amount_cents) FROM public.finance_transactions t
        WHERE t.source_module LIKE 'recurring:%' AND t.status IN ('planned','pending','overdue')
          AND t.currency = c.currency AND t.due_date >= p_month
          AND t.due_date < p_month + interval '1 month'), 0)::bigint AS pending_cents
    FROM (VALUES ('BRL'::text), ('EUR'::text)) c(currency)
  ) r;

  SELECT coalesce(jsonb_agg(to_jsonb(team) ORDER BY team.currency), '[]'::jsonb)
  INTO v_team FROM (
    SELECT c.currency,
      coalesce((SELECT sum(p.projected_amount_cents) FROM public.finance_payout_projection(p_month) p
        WHERE p.currency = c.currency AND p.payout_id IS NULL), 0)::bigint AS projected_cents,
      coalesce((SELECT sum(t.amount_cents) FROM public.finance_transactions t
        WHERE t.source_module = 'team_payout' AND t.status IN ('planned','pending','overdue')
          AND t.currency = c.currency AND t.due_date >= p_month
          AND t.due_date < p_month + interval '1 month'), 0)::bigint AS payable_cents,
      coalesce((SELECT sum(t.settled_amount_cents) FROM public.finance_transactions t
        WHERE t.source_module = 'team_payout' AND t.status = 'paid'
          AND t.settled_currency = c.currency AND t.paid_at >= p_month
          AND t.paid_at < p_month + interval '1 month'), 0)::bigint AS paid_cents
    FROM (VALUES ('BRL'::text), ('EUR'::text)) c(currency)
  ) team;
  RETURN jsonb_build_object('daily', v_daily, 'accounts', v_accounts,
    'services', v_services, 'expenses', v_expenses,
    'recurring', v_recurring, 'team', v_team);
END $$;

REVOKE ALL ON FUNCTION public.finance_month_closure_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_month_distribution_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_month_is_closed(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_month_snapshot(date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_prepare_month(date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_close_month(date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_dashboard_month(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_month_is_closed(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_month_snapshot(date, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_prepare_month(date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_close_month(date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_dashboard_month(date) TO service_role;
