-- Financeiro 2: monthly obligations and immutable team payout snapshots.
ALTER TABLE public.finance_recurring_rules
  ADD COLUMN starts_on date NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  ADD COLUMN ends_on date;
ALTER TABLE public.finance_recurring_rules
  DROP CONSTRAINT finance_recurring_rules_frequency_check;
ALTER TABLE public.finance_recurring_rules
  ADD CONSTRAINT finance_recurring_rules_frequency_check CHECK (frequency = 'monthly'),
  ADD CONSTRAINT finance_recurring_rules_period_check CHECK (
    extract(day FROM starts_on) = 1
    AND (ends_on IS NULL OR (
      extract(day FROM ends_on) = 1 AND ends_on >= starts_on
    ))
  );

CREATE TABLE public.finance_payees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) >= 2),
  type text NOT NULL CHECK (type IN ('team', 'contractor', 'partner', 'supplier', 'other')),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.finance_payout_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_id uuid NOT NULL REFERENCES public.finance_payees(id),
  rule_type text NOT NULL CHECK (rule_type IN ('fixed_monthly', 'revenue_percent', 'service_percent')),
  amount_cents integer CHECK (amount_cents >= 0),
  currency text CHECK (currency IN ('BRL', 'EUR')),
  percentage numeric(7,4) CHECK (percentage > 0 AND percentage <= 100),
  service_id uuid REFERENCES public.services(id) ON DELETE RESTRICT,
  day_of_month integer CHECK (day_of_month BETWEEN 1 AND 31),
  starts_on date NOT NULL,
  ends_on date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_payout_rules_period_check CHECK (
    extract(day FROM starts_on) = 1
    AND (ends_on IS NULL OR (extract(day FROM ends_on) = 1 AND ends_on >= starts_on))
  ),
  CONSTRAINT finance_payout_rules_shape_check CHECK (
    (rule_type = 'fixed_monthly' AND amount_cents IS NOT NULL AND currency IS NOT NULL
      AND day_of_month IS NOT NULL AND percentage IS NULL AND service_id IS NULL)
    OR (rule_type = 'revenue_percent' AND percentage IS NOT NULL AND amount_cents IS NULL
      AND currency IS NULL AND day_of_month IS NULL AND service_id IS NULL)
    OR (rule_type = 'service_percent' AND percentage IS NOT NULL AND service_id IS NOT NULL
      AND amount_cents IS NULL AND currency IS NULL AND day_of_month IS NULL)
  )
);
CREATE INDEX finance_payout_rules_payee_active_idx
  ON public.finance_payout_rules (payee_id, is_active);

CREATE TABLE public.finance_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_id uuid NOT NULL REFERENCES public.finance_payees(id),
  rule_id uuid NOT NULL REFERENCES public.finance_payout_rules(id),
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  currency text NOT NULL CHECK (currency IN ('BRL', 'EUR')),
  base_amount_cents integer NOT NULL CHECK (base_amount_cents >= 0),
  percentage numeric(7,4),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  finance_transaction_id uuid UNIQUE REFERENCES public.finance_transactions(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, period_month, currency)
);
CREATE INDEX finance_payouts_period_idx ON public.finance_payouts (period_month);
CREATE UNIQUE INDEX finance_payouts_fixed_month_unique_idx
  ON public.finance_payouts (rule_id, period_month) WHERE percentage IS NULL;

CREATE TRIGGER update_finance_payees_updated_at BEFORE UPDATE ON public.finance_payees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_finance_payout_rules_updated_at BEFORE UPDATE ON public.finance_payout_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION public.finance_payout_snapshot_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF (OLD.id, OLD.payee_id, OLD.rule_id, OLD.period_month, OLD.currency,
      OLD.base_amount_cents, OLD.percentage, OLD.amount_cents, OLD.generated_at)
     IS DISTINCT FROM
     (NEW.id, NEW.payee_id, NEW.rule_id, NEW.period_month, NEW.currency,
      NEW.base_amount_cents, NEW.percentage, NEW.amount_cents, NEW.generated_at)
    OR (OLD.finance_transaction_id IS NOT NULL
        AND OLD.finance_transaction_id IS DISTINCT FROM NEW.finance_transaction_id) THEN
    RAISE EXCEPTION 'Materialized payout snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_payout_snapshot_guard BEFORE UPDATE ON public.finance_payouts
  FOR EACH ROW EXECUTE FUNCTION public.finance_payout_snapshot_guard();

ALTER TABLE public.finance_payees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_payout_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_payees, public.finance_payout_rules, public.finance_payouts
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.finance_payees, public.finance_payout_rules,
  public.finance_payouts TO service_role;

-- This function is internal to admin-only server functions. The unique source
-- index and payout constraint make concurrent month loads idempotent.
CREATE FUNCTION public.finance_ensure_month(p_month date, p_actor uuid DEFAULT NULL)
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
        v_fixed.payee_id, v_fixed.id, p_month, v_fixed.currency, 0,
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

CREATE FUNCTION public.finance_payout_base(p_rule_id uuid, p_month date, p_currency text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rule public.finance_payout_rules%ROWTYPE; v_base bigint;
BEGIN
  SELECT * INTO v_rule FROM public.finance_payout_rules WHERE id = p_rule_id;
  IF NOT FOUND OR v_rule.rule_type NOT IN ('revenue_percent', 'service_percent')
    OR p_currency NOT IN ('BRL', 'EUR') THEN RETURN 0; END IF;
  IF v_rule.rule_type = 'revenue_percent' THEN
    SELECT coalesce(sum(settled_amount_cents), 0) INTO v_base
    FROM public.finance_transactions
    WHERE type = 'income' AND status = 'received'
      AND settled_currency = p_currency AND settled_amount_cents IS NOT NULL
      AND paid_at >= p_month AND paid_at < p_month + interval '1 month';
  ELSE
    SELECT coalesce(sum(settled_amount_cents), 0) INTO v_base FROM public.orders
    WHERE service_id = v_rule.service_id AND payment_status = 'aprovado'
      AND settled_currency = p_currency AND settled_amount_cents IS NOT NULL
      AND paid_at >= p_month AND paid_at < p_month + interval '1 month';
  END IF;
  RETURN v_base;
END $$;

CREATE FUNCTION public.finance_payout_projection(p_month date)
RETURNS TABLE (rule_id uuid, payee_id uuid, currency text, base_amount_cents bigint,
  percentage numeric, projected_amount_cents bigint, payout_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT r.id, r.payee_id, c.currency, b.base_amount_cents, r.percentage,
    round(b.base_amount_cents * r.percentage / 100)::bigint,
    p.id
  FROM public.finance_payout_rules r
  JOIN public.finance_payees payee ON payee.id = r.payee_id
  CROSS JOIN (VALUES ('BRL'::text), ('EUR'::text)) c(currency)
  CROSS JOIN LATERAL (SELECT public.finance_payout_base(r.id, p_month, c.currency)
    AS base_amount_cents) b
  LEFT JOIN public.finance_payouts p ON p.rule_id = r.id
    AND p.period_month = p_month AND p.currency = c.currency
  WHERE r.rule_type IN ('revenue_percent', 'service_percent')
    AND r.is_active AND payee.is_active AND r.starts_on <= p_month
    AND (r.ends_on IS NULL OR r.ends_on >= p_month)
    AND (b.base_amount_cents > 0 OR p.id IS NOT NULL)
$$;

CREATE FUNCTION public.finance_materialize_payout(
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

REVOKE ALL ON FUNCTION public.finance_payout_snapshot_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_ensure_month(date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_payout_base(uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_payout_projection(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_materialize_payout(uuid, date, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_ensure_month(date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_payout_base(uuid, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_payout_projection(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_materialize_payout(uuid, date, text, uuid) TO service_role;
