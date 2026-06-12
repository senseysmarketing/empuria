
ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS wise_profile_name text,
  ADD COLUMN IF NOT EXISTS wise_profile_type text,
  ADD COLUMN IF NOT EXISTS wise_balance_currency text DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS wise_bank_address text,
  ADD COLUMN IF NOT EXISTS wise_beneficiary_address text,
  ADD COLUMN IF NOT EXISTS wise_webhook_subscriptions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.integration_settings
  ALTER COLUMN wise_environment SET DEFAULT 'live';

UPDATE public.integration_settings
  SET wise_environment = 'live'
  WHERE provider = 'wise' AND (wise_environment IS NULL OR wise_environment = 'sandbox');
