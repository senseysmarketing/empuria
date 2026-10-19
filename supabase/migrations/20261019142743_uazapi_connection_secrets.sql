BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.uazapi_connection_secrets (
  provider text PRIMARY KEY CHECK (provider = 'whatsapp'),
  admin_token text,
  instance_token text,
  webhook_secret text
);

ALTER TABLE public.uazapi_connection_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.uazapi_connection_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.uazapi_connection_secrets TO service_role;

INSERT INTO public.uazapi_connection_secrets (provider, admin_token, instance_token, webhook_secret)
SELECT provider, uazapi_admin_token, uazapi_instance_token, webhook_secret
FROM public.integration_settings
WHERE provider = 'whatsapp'
ON CONFLICT (provider) DO UPDATE
SET admin_token = COALESCE(public.uazapi_connection_secrets.admin_token, EXCLUDED.admin_token),
    instance_token = COALESCE(public.uazapi_connection_secrets.instance_token, EXCLUDED.instance_token),
    webhook_secret = COALESCE(public.uazapi_connection_secrets.webhook_secret, EXCLUDED.webhook_secret);

UPDATE public.integration_settings
SET uazapi_admin_token = NULL,
    uazapi_instance_token = NULL,
    webhook_secret = NULL
WHERE provider = 'whatsapp';

ALTER TABLE public.integration_settings
  DROP CONSTRAINT integration_settings_uazapi_connection_status_check;
ALTER TABLE public.integration_settings
  ADD CONSTRAINT integration_settings_uazapi_connection_status_check
  CHECK (uazapi_connection_status IN ('disconnected', 'connecting', 'connected', 'hibernated', 'error'));

COMMIT;
