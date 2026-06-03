-- Uazapi / WhatsApp integration for CRM, follow-ups and operational inbox.

ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS uazapi_base_url text NOT NULL DEFAULT 'https://api.uazapi.com',
  ADD COLUMN IF NOT EXISTS uazapi_admin_token text,
  ADD COLUMN IF NOT EXISTS uazapi_instance_id text,
  ADD COLUMN IF NOT EXISTS uazapi_instance_token text,
  ADD COLUMN IF NOT EXISTS uazapi_instance_name text NOT NULL DEFAULT 'instituto-empuria',
  ADD COLUMN IF NOT EXISTS uazapi_connection_status text NOT NULL DEFAULT 'disconnected'
    CHECK (uazapi_connection_status IN ('disconnected', 'connecting', 'connected', 'error')),
  ADD COLUMN IF NOT EXISTS uazapi_profile_name text,
  ADD COLUMN IF NOT EXISTS uazapi_profile_pic_url text,
  ADD COLUMN IF NOT EXISTS uazapi_phone text,
  ADD COLUMN IF NOT EXISTS uazapi_webhook_id text,
  ADD COLUMN IF NOT EXISTS uazapi_webhook_configured_at timestamptz,
  ADD COLUMN IF NOT EXISTS uazapi_last_connection_at timestamptz,
  ADD COLUMN IF NOT EXISTS uazapi_last_qr_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_mode text NOT NULL DEFAULT 'suggestion'
    CHECK (whatsapp_mode IN ('disabled', 'suggestion', 'automatic'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_messages_provider_message_id
  ON public.crm_messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_conversations_provider_phone
  ON public.crm_conversations (provider, phone);

INSERT INTO public.integration_settings (
  provider,
  is_enabled,
  uazapi_base_url,
  uazapi_instance_name,
  uazapi_connection_status,
  whatsapp_mode
)
VALUES (
  'whatsapp',
  false,
  'https://api.uazapi.com',
  'instituto-empuria',
  'disconnected',
  'suggestion'
)
ON CONFLICT (provider) DO NOTHING;
