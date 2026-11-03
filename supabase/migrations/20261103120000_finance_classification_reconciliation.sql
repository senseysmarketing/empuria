-- Commercial classification is independent from the canonical financial source.
ALTER TABLE public.services ADD COLUMN finance_group text;
ALTER TABLE public.services ADD CONSTRAINT services_finance_group_check
  CHECK (finance_group IS NULL OR finance_group IN
    ('matricula','estudo','nomade','quarto','recepcao','mentoria'));

ALTER TABLE public.finance_transactions ADD COLUMN service_id uuid
  REFERENCES public.services(id) ON DELETE RESTRICT;
ALTER TABLE public.finance_transactions ADD CONSTRAINT finance_transactions_manual_service_check
  CHECK (service_id IS NULL OR (source_module = 'manual' AND type = 'income'));
CREATE INDEX finance_transactions_due_id_idx
  ON public.finance_transactions(due_date DESC, id DESC);
CREATE INDEX finance_transactions_manual_service_idx
  ON public.finance_transactions(service_id, paid_at)
  WHERE source_module = 'manual' AND type = 'income' AND service_id IS NOT NULL;

DO $seed$
BEGIN
  IF (SELECT count(*) FROM public.services WHERE title = 'Mentoria de Regularização') <> 1
    OR (SELECT count(*) FROM public.services WHERE title = 'Recepção no Aeroporto') <> 1 THEN
    RAISE EXCEPTION 'Existing Mentoria/Recepção services do not match the expected baseline';
  END IF;
  UPDATE public.services SET finance_group = 'mentoria'
    WHERE title = 'Mentoria de Regularização' AND finance_group IS NULL;
  UPDATE public.services SET finance_group = 'recepcao'
    WHERE title = 'Recepção no Aeroporto' AND finance_group IS NULL;
  IF EXISTS (SELECT 1 FROM public.services
    WHERE (title = 'Mentoria de Regularização' AND finance_group <> 'mentoria')
       OR (title = 'Recepção no Aeroporto' AND finance_group <> 'recepcao')) THEN
    RAISE EXCEPTION 'Existing service classification conflicts with expected group';
  END IF;
  IF EXISTS (SELECT 1 FROM public.services
    WHERE slug IN ('finance-matricula','finance-estudo','finance-nomade','finance-quarto')
      AND (finance_group IS DISTINCT FROM replace(slug,'finance-','') OR is_public)) THEN
    RAISE EXCEPTION 'Internal finance service slug already has a different meaning';
  END IF;
  INSERT INTO public.services(slug,title,category,price_cents,currency,is_active,is_public,finance_group)
  SELECT 'finance-' || v.group_key, v.title, 'esteira1', 0, 'EUR', true, false, v.group_key
  FROM (VALUES ('matricula','Matrícula'),('estudo','Estudo'),
    ('nomade','Nômade'),('quarto','Quarto')) AS v(group_key,title)
  WHERE NOT EXISTS (SELECT 1 FROM public.services s WHERE s.slug = 'finance-' || v.group_key);
END $seed$;

-- One row per financial transaction. A zero-value courtesy is represented by its
-- existing canceled mirror, with operational status/period derived from its order.
CREATE VIEW public.finance_operational_transactions WITH (security_invoker = true) AS
SELECT t.*,
  CASE WHEN courtesy.id IS NOT NULL THEN 'received'::text ELSE t.status END AS operational_status,
  (courtesy.id IS NOT NULL) AS is_courtesy,
  (courtesy.id IS NOT NULL AND courtesy.executed_at IS NULL
    AND courtesy.delivery_status <> 'concluido'
    AND courtesy.payment_provider_payment_id IS NULL) AS is_courtesy_deletable,
  CASE WHEN courtesy.id IS NOT NULL THEN date_trunc('month', courtesy.created_at)::date
    ELSE date_trunc('month', t.due_date)::date END AS period_month,
  CASE WHEN t.source_module = 'orders' THEN o.service_id ELSE t.service_id END AS commercial_service_id,
  s.title AS commercial_service_title,
  s.finance_group AS commercial_group
FROM public.finance_transactions t
LEFT JOIN public.orders o ON t.source_module = 'orders' AND t.source_id = o.id
LEFT JOIN public.orders courtesy ON courtesy.id = o.id
  AND t.type = 'income' AND t.status = 'canceled' AND t.amount_cents = 0
  AND courtesy.payment_status = 'aprovado' AND courtesy.payment_method = 'gratuito'
  AND courtesy.amount_cents = 0 AND courtesy.deleted_at IS NULL
LEFT JOIN public.services s ON s.id = CASE
  WHEN t.source_module = 'orders' THEN o.service_id ELSE t.service_id END;
REVOKE ALL ON public.finance_operational_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_operational_transactions TO service_role;

CREATE FUNCTION public.finance_set_manual_service(p_id uuid, p_service_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE v_tx public.finance_transactions%ROWTYPE;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required'; END IF;
  SELECT * INTO v_tx FROM public.finance_transactions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_tx.source_module <> 'manual' OR v_tx.type <> 'income' THEN
    RAISE EXCEPTION 'Only manual income can be classified';
  END IF;
  IF p_service_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.services WHERE id = p_service_id AND is_active
      AND archived_at IS NULL AND finance_group IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid active finance service';
  END IF;
  IF v_tx.service_id IS NOT DISTINCT FROM p_service_id THEN RETURN; END IF;
  UPDATE public.finance_transactions SET service_id = p_service_id WHERE id = p_id;
  INSERT INTO public.audit_logs(actor_id,module,entity_type,entity_id,action,old_data,new_data)
    VALUES (p_actor,'financeiro','finance_transaction',p_id,'finance.transaction.classify',
      jsonb_build_object('service_id',v_tx.service_id),
      jsonb_build_object('service_id',p_service_id));
END $$;
REVOKE ALL ON FUNCTION public.finance_set_manual_service(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_set_manual_service(uuid,uuid,uuid) TO service_role;

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
    SELECT coalesce(sum(t.settled_amount_cents), 0) INTO v_base
    FROM public.finance_transactions t
    LEFT JOIN public.orders o ON t.source_module = 'orders' AND t.source_id = o.id
    WHERE t.type = 'income' AND t.status = 'received'
      AND t.source_module IN ('manual','orders')
      AND t.settled_currency = p_currency AND t.settled_amount_cents IS NOT NULL
      AND t.paid_at >= p_month AND t.paid_at < p_month + interval '1 month'
      AND (t.source_module = 'manual' OR (o.id IS NOT NULL
        AND o.deleted_at IS NULL AND o.payment_status = 'aprovado'))
      AND EXISTS (SELECT 1 FROM public.finance_payout_rule_services rs
        WHERE rs.rule_id = p_rule_id AND rs.service_id = CASE
          WHEN t.source_module = 'orders' THEN o.service_id ELSE t.service_id END);
  END IF;
  RETURN v_base;
END $$;
REVOKE ALL ON FUNCTION public.finance_payout_base(uuid,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_payout_base(uuid,date,text) TO service_role;

-- Orders use their original sale date; manual entries use their due date.
-- Receipts use paid_at in both cases, so cash movements can land in another month.
CREATE FUNCTION public.finance_service_sales_month(p_month date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH sales AS (
    SELECT CASE WHEN t.source_module = 'orders' THEN o.service_id ELSE t.service_id END AS service_id,
      coalesce(s.title, o.service_title, 'Serviço sem nome') AS service_title,
      s.finance_group AS commercial_group,
      CASE WHEN t.source_module = 'orders' THEN o.created_at::date ELSE t.due_date END AS sale_date,
      t.status, t.currency, t.amount_cents, t.settled_currency,
      t.settled_amount_cents, t.paid_at
    FROM public.finance_transactions t
    LEFT JOIN public.orders o ON t.source_module = 'orders' AND t.source_id = o.id
    LEFT JOIN public.services s ON s.id = CASE
      WHEN t.source_module = 'orders' THEN o.service_id ELSE t.service_id END
    WHERE t.type = 'income' AND t.source_module IN ('manual','orders')
      AND t.status IN ('pending','received') AND t.amount_cents > 0
      AND (t.source_module = 'manual' AND t.service_id IS NOT NULL
        OR t.source_module = 'orders' AND o.id IS NOT NULL AND o.deleted_at IS NULL
          AND o.payment_status IN ('pendente','aprovado'))
  ), grouped AS (
    SELECT service_id, service_title, commercial_group,
      count(*) FILTER (WHERE sale_date >= p_month
        AND sale_date < p_month + interval '1 month')::integer AS sales_count,
      count(*) FILTER (WHERE status = 'received' AND paid_at >= p_month
        AND paid_at < p_month + interval '1 month')::integer AS paid_count,
      count(*) FILTER (WHERE status = 'pending' AND sale_date >= p_month
        AND sale_date < p_month + interval '1 month')::integer AS pending_count,
      coalesce(sum(amount_cents) FILTER (WHERE currency = 'BRL' AND sale_date >= p_month
        AND sale_date < p_month + interval '1 month'),0)::bigint AS sold_brl,
      coalesce(sum(amount_cents) FILTER (WHERE currency = 'EUR' AND sale_date >= p_month
        AND sale_date < p_month + interval '1 month'),0)::bigint AS sold_eur,
      coalesce(sum(settled_amount_cents) FILTER (WHERE status = 'received'
        AND settled_currency = 'BRL' AND paid_at >= p_month
        AND paid_at < p_month + interval '1 month'),0)::bigint AS received_brl,
      coalesce(sum(settled_amount_cents) FILTER (WHERE status = 'received'
        AND settled_currency = 'EUR' AND paid_at >= p_month
        AND paid_at < p_month + interval '1 month'),0)::bigint AS received_eur,
      coalesce(sum(amount_cents) FILTER (WHERE status = 'pending' AND currency = 'BRL'
        AND sale_date >= p_month AND sale_date < p_month + interval '1 month'),0)::bigint AS pending_brl,
      coalesce(sum(amount_cents) FILTER (WHERE status = 'pending' AND currency = 'EUR'
        AND sale_date >= p_month AND sale_date < p_month + interval '1 month'),0)::bigint AS pending_eur
    FROM sales
    WHERE (sale_date >= p_month AND sale_date < p_month + interval '1 month')
       OR (status = 'received' AND paid_at >= p_month AND paid_at < p_month + interval '1 month')
    GROUP BY service_id, service_title, commercial_group
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'service_id',service_id,'service_title',service_title,'commercial_group',commercial_group,
    'sales_count',sales_count,'paid_count',paid_count,'pending_count',pending_count,
    'currencies',jsonb_build_object(
      'BRL',jsonb_build_object('sold_cents',sold_brl,'received_cents',received_brl,'receivable_cents',pending_brl),
      'EUR',jsonb_build_object('sold_cents',sold_eur,'received_cents',received_eur,'receivable_cents',pending_eur)))
    ORDER BY sales_count DESC, service_title), '[]'::jsonb)
  FROM grouped;
$$;
REVOKE ALL ON FUNCTION public.finance_service_sales_month(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_service_sales_month(date) TO service_role;

CREATE OR REPLACE FUNCTION public.finance_dashboard_month(p_month date)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_daily jsonb; v_services jsonb; v_expenses jsonb;
  v_recurring jsonb; v_team jsonb; v_totals jsonb;
BEGIN
  IF p_month IS NULL OR extract(day FROM p_month) <> 1 THEN
    RAISE EXCEPTION 'Month must be its first day';
  END IF;
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

  v_services := public.finance_service_sales_month(p_month);

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
