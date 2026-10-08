-- Caixa simples: all unsettled obligations are pending, regardless of due date.
UPDATE public.finance_transactions SET status = 'pending'
WHERE status IN ('planned', 'overdue');
ALTER TABLE public.finance_transactions DROP CONSTRAINT finance_transactions_status_check;
ALTER TABLE public.finance_transactions ADD CONSTRAINT finance_transactions_status_check
  CHECK (status IN ('pending', 'received', 'paid', 'canceled'));

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
      v_rule.type, 'pending', v_rule.description, v_rule.amount_cents,
      v_rule.currency, v_due, v_rule.category_id, v_rule.account_id,
      'recurring:' || to_char(p_month, 'YYYY-MM'), v_rule.id,
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
    SELECT 'expense', 'pending', 'Repasse - ' || v_fixed.payee_name,
      payout.amount_cents, payout.currency, v_due, v_category_id,
      'team_payout', payout.id, true, coalesce(p_actor, v_fixed.created_by)
    FROM public.finance_payouts payout WHERE payout.id = v_payout_id
    ON CONFLICT (source_module, source_id) WHERE source_id IS NOT NULL DO NOTHING;
    SELECT id INTO v_transaction_id FROM public.finance_transactions
      WHERE source_module = 'team_payout' AND source_id = v_payout_id;
    UPDATE public.finance_payouts SET finance_transaction_id = v_transaction_id
      WHERE id = v_payout_id AND finance_transaction_id IS NULL;
    v_payout_id := NULL;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.finance_reverse_settlement(
  p_id uuid, p_actor uuid, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tx public.finance_transactions%ROWTYPE;
  v_order public.orders%ROWTYPE;
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
    UPDATE public.finance_transactions SET status = 'pending',
      settled_amount_cents = NULL, settled_currency = NULL, paid_at = NULL,
      account_id = NULL, fx_reference_rate = NULL, fx_rate = NULL,
      fx_source = NULL, fx_date = NULL
      WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Transaction source must be corrected at origin';
  END IF;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data)
    VALUES (p_actor,'financeiro','finance_transaction',p_id,'finance.transaction.reverse',
      to_jsonb(v_tx),jsonb_build_object('reason',p_reason,'new_status','pending'));
END $$;

CREATE OR REPLACE FUNCTION public.finance_delete_pending_transaction(
  p_id uuid, p_actor uuid, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tx public.finance_transactions%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_month date;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required'; END IF;
  SELECT * INTO v_tx FROM public.finance_transactions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_tx.status <> 'pending'
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

-- Keep the existing live snapshot contract for other consumers, but skip the
-- costly payout projection entirely when the dashboard requests a live result.
CREATE OR REPLACE FUNCTION public.finance_month_snapshot(p_month date, p_include_projection boolean DEFAULT true)
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
      WHERE type = 'expense' AND status IN ('pending','paid')
        AND source_module <> 'partner_distribution'
        AND due_date >= p_month AND due_date < p_month + interval '1 month'
        AND (CASE WHEN status = 'paid' AND settled_currency IS NOT NULL
          THEN settled_currency ELSE currency END) = v_currency
    ) expenses;

    v_projected := 0;
    IF p_include_projection THEN
      SELECT coalesce(sum(projected_amount_cents), 0)::bigint INTO v_projected
      FROM public.finance_payout_projection(p_month)
      WHERE currency = v_currency AND payout_id IS NULL;
    END IF;

    SELECT
      coalesce(sum(CASE WHEN type = 'income' THEN amount_cents ELSE 0 END), 0)::bigint,
      coalesce(sum(CASE WHEN type = 'expense' THEN amount_cents ELSE 0 END), 0)::bigint
    INTO v_receivable, v_payable
    FROM public.finance_transactions
    WHERE status = 'pending' AND currency = v_currency
      AND due_date >= p_month AND due_date < p_month + interval '1 month';

    SELECT coalesce(sum(amount_cents), 0)::bigint INTO v_overdue_previous
    FROM public.finance_transactions
    WHERE status = 'pending' AND currency = v_currency AND due_date < p_month;

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

-- One monthly dashboard payload; no account or projection fan-out.
CREATE OR REPLACE FUNCTION public.finance_dashboard_month(p_month date)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
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
      AND o.payment_status IN ('aprovado','pendente')
      AND coalesce(o.payment_currency,o.currency) IN ('BRL','EUR')
    GROUP BY o.service_id, CASE WHEN o.service_id IS NULL THEN o.service_title END
  ) s;

  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.currency, e.amount_cents DESC), '[]'::jsonb)
    INTO v_expenses FROM (
    SELECT t.category_id, coalesce(c.name, 'Sem categoria') AS category_name,
      CASE WHEN t.status = 'paid' THEN t.settled_currency ELSE t.currency END AS currency,
      sum(CASE WHEN t.status = 'paid' THEN t.settled_amount_cents
        ELSE t.amount_cents END)::bigint AS amount_cents
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
END $$;

REVOKE ALL ON FUNCTION public.finance_ensure_month(date,uuid),
  public.finance_reverse_settlement(uuid,uuid,text),
  public.finance_delete_pending_transaction(uuid,uuid,text),
  public.finance_month_snapshot(date,boolean),
  public.finance_dashboard_month(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_ensure_month(date,uuid),
  public.finance_reverse_settlement(uuid,uuid,text),
  public.finance_delete_pending_transaction(uuid,uuid,text),
  public.finance_month_snapshot(date,boolean),
  public.finance_dashboard_month(date) TO service_role;
