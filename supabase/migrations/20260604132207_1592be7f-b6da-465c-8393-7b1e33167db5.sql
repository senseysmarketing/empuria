
ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS test_public_key text,
  ADD COLUMN IF NOT EXISTS test_access_token text,
  ADD COLUMN IF NOT EXISTS test_webhook_secret text,
  ADD COLUMN IF NOT EXISTS prod_public_key text,
  ADD COLUMN IF NOT EXISTS prod_access_token text,
  ADD COLUMN IF NOT EXISTS prod_webhook_secret text;

UPDATE public.integration_settings
SET
  test_public_key = COALESCE(test_public_key, CASE WHEN environment = 'test' THEN public_key END),
  test_access_token = COALESCE(test_access_token, CASE WHEN environment = 'test' THEN access_token END),
  test_webhook_secret = COALESCE(test_webhook_secret, CASE WHEN environment = 'test' THEN webhook_secret END),
  prod_public_key = COALESCE(prod_public_key, CASE WHEN environment = 'production' THEN public_key END),
  prod_access_token = COALESCE(prod_access_token, CASE WHEN environment = 'production' THEN access_token END),
  prod_webhook_secret = COALESCE(prod_webhook_secret, CASE WHEN environment = 'production' THEN webhook_secret END)
WHERE provider = 'mercadopago';
