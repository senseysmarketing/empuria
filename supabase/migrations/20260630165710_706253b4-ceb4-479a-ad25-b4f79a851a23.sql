
CREATE TABLE public.pdv_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name text,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'success',
  source text NOT NULL DEFAULT 'server_fn',
  tab_id uuid,
  tab_code text,
  sale_id uuid,
  sale_code text,
  customer_id uuid,
  customer_name text,
  product_id uuid,
  product_name text,
  amount_eur_cents integer,
  payment_method text,
  reference text,
  request_ip text,
  user_agent text,
  route text,
  params jsonb,
  result jsonb,
  error_message text,
  error_code text
);

GRANT SELECT ON public.pdv_activity_logs TO authenticated;
GRANT ALL ON public.pdv_activity_logs TO service_role;

ALTER TABLE public.pdv_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read pdv activity logs"
  ON public.pdv_activity_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX pdv_activity_logs_actor_time_idx
  ON public.pdv_activity_logs (actor_id, occurred_at DESC);
CREATE INDEX pdv_activity_logs_action_time_idx
  ON public.pdv_activity_logs (action, occurred_at DESC);
CREATE INDEX pdv_activity_logs_tab_idx
  ON public.pdv_activity_logs (tab_id) WHERE tab_id IS NOT NULL;
CREATE INDEX pdv_activity_logs_sale_idx
  ON public.pdv_activity_logs (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX pdv_activity_logs_time_idx
  ON public.pdv_activity_logs (occurred_at DESC);

-- Trigger function: capture DB-level changes as a safety net
CREATE OR REPLACE FUNCTION public.pdv_activity_log_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_tab_id uuid;
  v_tab_code text;
  v_sale_id uuid;
  v_sale_code text;
  v_customer_id uuid;
  v_customer_name text;
  v_product_id uuid;
  v_product_name text;
  v_amount integer;
  v_payment text;
  v_actor uuid;
  v_actor_name text;
BEGIN
  v_actor := auth.uid();

  IF TG_TABLE_NAME = 'pdv_tabs' THEN
    IF TG_OP = 'INSERT' THEN
      v_action := 'db.tab.insert';
      v_tab_id := NEW.id; v_tab_code := NEW.tab_code;
      v_customer_id := NEW.customer_id; v_payment := NEW.payment_method;
      v_amount := NEW.total_eur_cents;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        v_action := 'db.tab.status.' || NEW.status;
      ELSE
        RETURN NULL; -- only track status transitions to avoid noise
      END IF;
      v_tab_id := NEW.id; v_tab_code := NEW.tab_code;
      v_customer_id := NEW.customer_id; v_payment := NEW.payment_method;
      v_sale_id := NEW.sale_id; v_amount := NEW.total_eur_cents;
    ELSIF TG_OP = 'DELETE' THEN
      v_action := 'db.tab.delete';
      v_tab_id := OLD.id; v_tab_code := OLD.tab_code;
      v_customer_id := OLD.customer_id;
    END IF;

  ELSIF TG_TABLE_NAME = 'pdv_tab_items' THEN
    IF TG_OP = 'INSERT' THEN
      v_action := 'db.tab_item.insert';
      v_tab_id := NEW.tab_id; v_product_id := NEW.product_id;
      v_product_name := NEW.product_name_snapshot;
      v_amount := NEW.total_eur_cents;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
        v_action := 'db.tab_item.cancel';
      ELSIF NEW.qty IS DISTINCT FROM OLD.qty THEN
        v_action := 'db.tab_item.qty';
      ELSE
        RETURN NULL;
      END IF;
      v_tab_id := NEW.tab_id; v_product_id := NEW.product_id;
      v_product_name := NEW.product_name_snapshot;
      v_amount := NEW.total_eur_cents;
    ELSIF TG_OP = 'DELETE' THEN
      v_action := 'db.tab_item.delete';
      v_tab_id := OLD.tab_id; v_product_id := OLD.product_id;
      v_product_name := OLD.product_name_snapshot;
    END IF;
    IF v_tab_id IS NOT NULL THEN
      SELECT tab_code INTO v_tab_code FROM public.pdv_tabs WHERE id = v_tab_id;
    END IF;

  ELSIF TG_TABLE_NAME = 'pdv_sales' THEN
    IF TG_OP = 'INSERT' THEN
      v_action := 'db.sale.insert';
      v_sale_id := NEW.id; v_sale_code := NEW.sale_code;
      v_customer_id := NEW.customer_id; v_payment := NEW.payment_method;
      v_amount := NEW.total_eur_cents;
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'db.sale.status.' || NEW.status;
      v_sale_id := NEW.id; v_sale_code := NEW.sale_code;
      v_customer_id := NEW.customer_id; v_payment := NEW.payment_method;
      v_amount := NEW.total_eur_cents;
    ELSE
      RETURN NULL;
    END IF;

  ELSIF TG_TABLE_NAME = 'pdv_payment_attempts' THEN
    IF TG_OP = 'INSERT' THEN
      v_action := 'db.payment_attempt.insert';
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'db.payment_attempt.' || NEW.status;
    ELSE
      RETURN NULL;
    END IF;
    v_tab_id := COALESCE(NEW.tab_id, OLD.tab_id);
    v_sale_id := COALESCE(NEW.sale_id, OLD.sale_id);
    v_amount := COALESCE(NEW.amount_eur_cents, OLD.amount_eur_cents);
    v_payment := COALESCE(NEW.provider, OLD.provider);
  END IF;

  IF v_action IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_customer_id IS NOT NULL THEN
    SELECT full_name INTO v_customer_name FROM public.profiles WHERE id = v_customer_id;
  END IF;
  IF v_actor IS NOT NULL THEN
    SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor;
  END IF;

  INSERT INTO public.pdv_activity_logs (
    actor_id, actor_name, action, status, source,
    tab_id, tab_code, sale_id, sale_code,
    customer_id, customer_name, product_id, product_name,
    amount_eur_cents, payment_method,
    params
  ) VALUES (
    v_actor, v_actor_name, v_action, 'success', 'db_trigger',
    v_tab_id, v_tab_code, v_sale_id, v_sale_code,
    v_customer_id, v_customer_name, v_product_id, v_product_name,
    v_amount, v_payment,
    jsonb_build_object('op', TG_OP, 'table', TG_TABLE_NAME)
  );

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_pdv_tabs_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.pdv_tabs
FOR EACH ROW EXECUTE FUNCTION public.pdv_activity_log_trigger();

CREATE TRIGGER trg_pdv_tab_items_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.pdv_tab_items
FOR EACH ROW EXECUTE FUNCTION public.pdv_activity_log_trigger();

CREATE TRIGGER trg_pdv_sales_activity_log
AFTER INSERT OR UPDATE ON public.pdv_sales
FOR EACH ROW EXECUTE FUNCTION public.pdv_activity_log_trigger();

CREATE TRIGGER trg_pdv_payment_attempts_activity_log
AFTER INSERT OR UPDATE ON public.pdv_payment_attempts
FOR EACH ROW EXECUTE FUNCTION public.pdv_activity_log_trigger();

-- Backfill last 90 days from audit_logs
INSERT INTO public.pdv_activity_logs (
  occurred_at, actor_id, action, status, source, params
)
SELECT
  created_at,
  actor_id,
  action,
  'success',
  'backfill_audit_logs',
  COALESCE(new_data, old_data)
FROM public.audit_logs
WHERE module = 'pdv'
  AND created_at >= now() - interval '90 days';
