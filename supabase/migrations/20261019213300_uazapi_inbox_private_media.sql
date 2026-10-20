BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.crm_messages
  ADD COLUMN IF NOT EXISTS media_kind text,
  ADD COLUMN IF NOT EXISTS media_mime text,
  ADD COLUMN IF NOT EXISTS media_name text,
  ADD COLUMN IF NOT EXISTS media_size bigint,
  ADD COLUMN IF NOT EXISTS media_path text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_messages_media_kind_check') THEN
    ALTER TABLE public.crm_messages ADD CONSTRAINT crm_messages_media_kind_check
      CHECK (media_kind IS NULL OR media_kind IN ('image', 'video', 'audio', 'document'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_messages_media_size_check') THEN
    ALTER TABLE public.crm_messages ADD CONSTRAINT crm_messages_media_size_check
      CHECK (media_size IS NULL OR media_size BETWEEN 0 AND 16777216);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_media_path_unique
  ON public.crm_messages (media_path) WHERE media_path IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_message_receipt_no_regression()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE old_rank int; new_rank int;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  old_rank := CASE lower(coalesce(OLD.status,''))
    WHEN 'read' THEN 4 WHEN 'played' THEN 4 WHEN 'delivered' THEN 3
    WHEN 'sent' THEN 2 WHEN 'manual_sent' THEN 2 ELSE 0 END;
  new_rank := CASE lower(coalesce(NEW.status,''))
    WHEN 'read' THEN 4 WHEN 'played' THEN 4 WHEN 'delivered' THEN 3
    WHEN 'sent' THEN 2 WHEN 'manual_sent' THEN 2 ELSE 0 END;
  IF old_rank >= 3 AND new_rank < old_rank THEN NEW.status := OLD.status; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_message_receipt_no_regression ON public.crm_messages;
CREATE TRIGGER crm_message_receipt_no_regression
  BEFORE UPDATE OF status ON public.crm_messages FOR EACH ROW
  EXECUTE FUNCTION public.crm_message_receipt_no_regression();
REVOKE ALL ON FUNCTION public.crm_message_receipt_no_regression() FROM PUBLIC, anon, authenticated;

UPDATE public.crm_messages SET media_kind = CASE
  WHEN lower(message_type) LIKE '%image%' OR lower(message_type) LIKE '%sticker%' THEN 'image'
  WHEN lower(message_type) LIKE '%video%' THEN 'video'
  WHEN lower(message_type) LIKE '%audio%' OR lower(message_type) IN ('ptt', 'myaudio') THEN 'audio'
  WHEN lower(message_type) LIKE '%document%' THEN 'document'
  ELSE NULL END
WHERE media_kind IS NULL AND message_type IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('crm-inbox-media', 'crm-inbox-media', false, 16777216,
  ARRAY['image/jpeg','image/png','image/webp','video/mp4','audio/ogg','audio/mpeg','audio/mp4',
        'application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'])
ON CONFLICT (id) DO NOTHING;

-- Production connection events contain the confirmed PN in owner. Do not infer from a LID
-- or trim a persisted phone by length; only reconcile from this observed identity.
WITH latest AS (
  SELECT payload->>'owner' AS phone
  FROM public.integration_events
  WHERE provider = 'whatsapp' AND event_type = 'connection'
    AND payload #>> '{instance,status}' = 'connected'
    AND payload #>> '{instance,name}' = 'instituto-empuria'
  ORDER BY created_at DESC LIMIT 1
)
UPDATE public.integration_settings s SET uazapi_phone = latest.phone
FROM latest
WHERE s.provider = 'whatsapp' AND s.uazapi_connection_status = 'connected'
  AND latest.phone ~ '^[1-9][0-9]{7,14}$'
  AND s.uazapi_phone IS DISTINCT FROM latest.phone;

COMMIT;
