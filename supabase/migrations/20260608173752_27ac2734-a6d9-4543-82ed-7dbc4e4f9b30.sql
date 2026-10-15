
ALTER TABLE public.integration_settings DROP CONSTRAINT IF EXISTS integration_settings_provider_check;
ALTER TABLE public.integration_settings
  ADD CONSTRAINT integration_settings_provider_check
  CHECK (provider IN ('hubla','mercadopago','whatsapp','uazapi','wise'));

ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS wise_environment text DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS wise_api_token text,
  ADD COLUMN IF NOT EXISTS wise_profile_id text,
  ADD COLUMN IF NOT EXISTS wise_balance_id_eur text,
  ADD COLUMN IF NOT EXISTS wise_beneficiary_name text,
  ADD COLUMN IF NOT EXISTS wise_iban text,
  ADD COLUMN IF NOT EXISTS wise_bic text,
  ADD COLUMN IF NOT EXISTS wise_default_payment_url text,
  ADD COLUMN IF NOT EXISTS wise_webhook_public_key text,
  ADD COLUMN IF NOT EXISTS wise_last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS wise_confirmation_mode text DEFAULT 'webhook_and_manual';

CREATE SEQUENCE IF NOT EXISTS public.wise_reference_seq START 1001;

CREATE OR REPLACE FUNCTION public.wise_next_reference()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_next bigint;
BEGIN
  v_next := nextval('public.wise_reference_seq');
  RETURN 'EMP-' || lpad(v_next::text, 4, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.wise_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  external_reference text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','waiting_payment','pending_conciliation','paid','underpaid','overpaid','expired','cancelled','failed')),
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  description text,
  wise_payment_link_id text,
  wise_payment_link_url text,
  wise_transfer_id text,
  wise_balance_credit_id text,
  raw_request jsonb DEFAULT '{}'::jsonb,
  raw_response jsonb DEFAULT '{}'::jsonb,
  raw_webhook jsonb DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.wise_payments TO authenticated;
GRANT ALL ON public.wise_payments TO service_role;

CREATE INDEX IF NOT EXISTS wise_payments_order_id_idx ON public.wise_payments(order_id);
CREATE INDEX IF NOT EXISTS wise_payments_status_idx ON public.wise_payments(status);

ALTER TABLE public.wise_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage wise_payments" ON public.wise_payments;
CREATE POLICY "Staff manage wise_payments" ON public.wise_payments
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Order owner reads wise_payments" ON public.wise_payments;
CREATE POLICY "Order owner reads wise_payments" ON public.wise_payments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = wise_payments.order_id AND o.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.wise_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  matched_payment_id uuid REFERENCES public.wise_payments(id) ON DELETE SET NULL,
  matched_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('auto_matched','pending','manual_matched','ignored','underpaid','overpaid')),
  processed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.wise_events TO authenticated;
GRANT ALL ON public.wise_events TO service_role;

CREATE INDEX IF NOT EXISTS wise_events_match_status_idx ON public.wise_events(match_status);
CREATE INDEX IF NOT EXISTS wise_events_created_at_idx ON public.wise_events(created_at DESC);

ALTER TABLE public.wise_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage wise_events" ON public.wise_events;
CREATE POLICY "Staff manage wise_events" ON public.wise_events
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP TRIGGER IF EXISTS wise_payments_set_updated_at ON public.wise_payments;
CREATE TRIGGER wise_payments_set_updated_at
  BEFORE UPDATE ON public.wise_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS wise_events_set_updated_at ON public.wise_events;
CREATE TRIGGER wise_events_set_updated_at
  BEFORE UPDATE ON public.wise_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.integration_settings (provider, is_enabled, environment, default_currency, wise_environment, wise_confirmation_mode)
VALUES ('wise', false, 'test', 'EUR', 'sandbox', 'webhook_and_manual')
ON CONFLICT (provider) DO NOTHING;

INSERT INTO public.finance_accounts (name, type, currency, is_active)
SELECT 'Wise EUR', 'bank', 'EUR', true
WHERE NOT EXISTS (SELECT 1 FROM public.finance_accounts WHERE name = 'Wise EUR');

CREATE OR REPLACE FUNCTION public.finance_account_id_for_payment(p_payment_method text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id FROM public.finance_accounts
  WHERE name = CASE
    WHEN p_payment_method = 'dinheiro' THEN 'Dinheiro EUR'
    WHEN p_payment_method = 'cartao' THEN 'Cartao'
    WHEN p_payment_method = 'pix' THEN 'Pix'
    WHEN p_payment_method = 'wise' THEN 'Wise EUR'
    WHEN p_payment_method IN ('mercadopago','boleto','credit_card') THEN 'Mercado Pago'
    ELSE 'Caixa fisico'
  END
  LIMIT 1
$$;
