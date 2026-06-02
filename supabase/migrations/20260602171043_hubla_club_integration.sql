-- Hubla integration for Clube do Imigrante subscriptions, events and access.

CREATE TABLE IF NOT EXISTS public.integration_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT false,
  checkout_url text,
  post_purchase_url text,
  webhook_secret text,
  product_id text,
  offer_id text,
  whatsapp_group_url text,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_settings_provider_check CHECK (provider IN ('hubla', 'mercadopago', 'whatsapp'))
);

CREATE TABLE IF NOT EXISTS public.integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'hubla',
  event_type text NOT NULL,
  provider_event_id text,
  buyer_email text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received',
  processed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_events_provider_check CHECK (provider IN ('hubla', 'mercadopago', 'whatsapp')),
  CONSTRAINT integration_events_status_check CHECK (status IN ('received', 'processed', 'ignored', 'duplicate', 'unmatched', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_events_provider_event_id
  ON public.integration_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_integration_events_provider_created_at
  ON public.integration_events (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_events_status
  ON public.integration_events (status);
CREATE INDEX IF NOT EXISTS idx_integration_events_buyer_email
  ON public.integration_events (lower(buyer_email));

CREATE TABLE IF NOT EXISTS public.club_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'hubla',
  provider_member_id text,
  provider_subscription_id text,
  provider_invoice_id text,
  buyer_email text,
  buyer_phone text,
  status text NOT NULL DEFAULT 'pending',
  access_status text NOT NULL DEFAULT 'pending',
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_payment_at timestamptz,
  next_billing_at timestamptz,
  canceled_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_subscriptions_provider_check CHECK (provider IN ('hubla')),
  CONSTRAINT club_subscriptions_status_check CHECK (status IN ('pending', 'active', 'incomplete', 'canceled', 'inactive', 'past_due', 'refunded')),
  CONSTRAINT club_subscriptions_access_status_check CHECK (access_status IN ('pending', 'active', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_club_subscriptions_provider_subscription
  ON public.club_subscriptions (provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_club_subscriptions_user
  ON public.club_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_club_subscriptions_buyer_email
  ON public.club_subscriptions (lower(buyer_email));
CREATE INDEX IF NOT EXISTS idx_club_subscriptions_access_status
  ON public.club_subscriptions (access_status);

GRANT SELECT, INSERT, UPDATE ON public.integration_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.integration_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.club_subscriptions TO authenticated;
GRANT ALL ON public.integration_settings TO service_role;
GRANT ALL ON public.integration_events TO service_role;
GRANT ALL ON public.club_subscriptions TO service_role;

ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage integration settings" ON public.integration_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'configuracoes'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'configuracoes'));

CREATE POLICY "Admins view integration events" ON public.integration_events
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'configuracoes'));

CREATE POLICY "Admins manage integration events" ON public.integration_events
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins view club subscriptions" ON public.club_subscriptions
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_module_access(auth.uid(), 'usuarios') OR has_module_access(auth.uid(), 'configuracoes'));

CREATE POLICY "Members view own club subscription" ON public.club_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins manage club subscriptions" ON public.club_subscriptions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS update_integration_settings_updated_at ON public.integration_settings;
CREATE TRIGGER update_integration_settings_updated_at
  BEFORE UPDATE ON public.integration_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_club_subscriptions_updated_at ON public.club_subscriptions;
CREATE TRIGGER update_club_subscriptions_updated_at
  BEFORE UPDATE ON public.club_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.integration_settings (provider, is_enabled, post_purchase_url)
VALUES ('hubla', false, '/clube/sucesso')
ON CONFLICT (provider) DO NOTHING;

INSERT INTO public.finance_categories (name, type, is_system, is_active)
VALUES ('Clube', 'income', true, true)
ON CONFLICT (name, type) DO UPDATE SET is_system = true, is_active = true;
