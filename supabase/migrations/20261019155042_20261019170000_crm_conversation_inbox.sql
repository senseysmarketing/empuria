BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.crm_conversations ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE public.crm_messages ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE public.crm_conversations
  ADD COLUMN contact_name text,
  ADD COLUMN last_preview text,
  ADD COLUMN unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  ADD COLUMN last_read_at timestamptz;
ALTER TABLE public.crm_messages ADD COLUMN client_request_id uuid;

CREATE UNIQUE INDEX crm_messages_client_request_unique
  ON public.crm_messages (client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX crm_conversations_activity_page
  ON public.crm_conversations (last_message_at DESC NULLS LAST, id DESC);
CREATE INDEX crm_messages_conversation_page
  ON public.crm_messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX leads_phone_digits_lookup
  ON public.leads ((regexp_replace(phone, '[^0-9]', '', 'g')));

CREATE OR REPLACE FUNCTION public.crm_inbox_message_projection()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.conversation_id IS NOT NULL THEN
    UPDATE public.crm_conversations c SET
      last_message_at = greatest(coalesce(c.last_message_at, NEW.created_at), NEW.created_at),
      last_inbound_at = CASE WHEN NEW.direction = 'inbound' THEN greatest(coalesce(c.last_inbound_at, NEW.created_at), NEW.created_at) ELSE c.last_inbound_at END,
      last_outbound_at = CASE WHEN NEW.direction = 'outbound' THEN greatest(coalesce(c.last_outbound_at, NEW.created_at), NEW.created_at) ELSE c.last_outbound_at END,
      last_preview = CASE WHEN c.last_message_at IS NULL OR NEW.created_at >= c.last_message_at THEN left(coalesce(nullif(NEW.body, ''), '[' || NEW.message_type || ']'), 300) ELSE c.last_preview END,
      unread_count = c.unread_count + CASE WHEN NEW.direction = 'inbound' AND NEW.created_at > coalesce(c.last_read_at, '-infinity'::timestamptz) THEN 1 ELSE 0 END
    WHERE c.id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_inbox_message_projection_after_insert
  AFTER INSERT ON public.crm_messages FOR EACH ROW
  EXECUTE FUNCTION public.crm_inbox_message_projection();

UPDATE public.crm_conversations c SET last_preview = (
  SELECT left(coalesce(nullif(m.body, ''), '[' || m.message_type || ']'), 300)
  FROM public.crm_messages m WHERE m.conversation_id = c.id
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1
);
UPDATE public.crm_conversations c SET contact_name = l.full_name
FROM public.leads l WHERE c.lead_id = l.id AND c.contact_name IS NULL;

-- Service-only atomic ingest: stable phone chat, unambiguous lead match, and provider-ID dedupe.
CREATE FUNCTION public.crm_inbox_ingest(
  p_chat_id text, p_phone text, p_name text, p_provider_message_id text,
  p_direction public.crm_message_direction, p_type text, p_body text,
  p_sent_at timestamptz, p_status text DEFAULT NULL, p_client_request_id uuid DEFAULT NULL
) RETURNS TABLE(conversation_id uuid, message_id uuid, inserted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_chat text;
  v_digits text;
  v_lead uuid;
  v_matches integer;
  v_conversation uuid;
  v_message uuid;
BEGIN
  IF p_chat_id IS NULL OR p_chat_id !~ '^wa:[0-9]{8,20}$' OR p_phone IS NULL OR p_direction IS NULL THEN
    RAISE EXCEPTION 'Invalid individual chat';
  END IF;
  v_chat := p_chat_id;
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  IF length(v_digits) < 8 THEN RAISE EXCEPTION 'Invalid phone'; END IF;
  SELECT (array_agg(id))[1], count(*) INTO v_lead, v_matches FROM public.leads
    WHERE regexp_replace(phone, '[^0-9]', '', 'g') = v_digits;
  IF v_matches <> 1 THEN v_lead := NULL; END IF;
  INSERT INTO public.crm_conversations (lead_id, provider, provider_chat_id, phone, contact_name)
  VALUES (v_lead, 'whatsapp', v_chat, p_phone, nullif(p_name, ''))
  ON CONFLICT (provider, provider_chat_id) DO UPDATE SET
    contact_name = coalesce(nullif(EXCLUDED.contact_name, ''), public.crm_conversations.contact_name)
  RETURNING id INTO v_conversation;
  IF p_provider_message_id IS NOT NULL THEN
    SELECT id INTO v_message FROM public.crm_messages
      WHERE provider = 'whatsapp' AND provider_message_id = p_provider_message_id;
  END IF;
  IF v_message IS NULL AND p_client_request_id IS NOT NULL THEN
    SELECT id INTO v_message FROM public.crm_messages WHERE client_request_id = p_client_request_id;
  END IF;
  IF v_message IS NOT NULL THEN
    IF p_provider_message_id IS NOT NULL THEN
      UPDATE public.crm_messages SET
        provider_message_id = coalesce(provider_message_id, p_provider_message_id),
        status = CASE WHEN status IN ('sending', 'uncertain') THEN coalesce(p_status, 'sent') ELSE status END
      WHERE id = v_message;
    END IF;
    RETURN QUERY SELECT v_conversation, v_message, false;
    RETURN;
  END IF;
  INSERT INTO public.crm_messages
    (lead_id, conversation_id, direction, provider, provider_message_id, body, message_type, status, created_at, client_request_id)
  SELECT c.lead_id, c.id, p_direction, 'whatsapp', p_provider_message_id, p_body,
    coalesce(nullif(p_type, ''), 'text'), p_status, coalesce(p_sent_at, now()), p_client_request_id
  FROM public.crm_conversations c WHERE c.id = v_conversation
  ON CONFLICT DO NOTHING RETURNING id INTO v_message;
  RETURN QUERY SELECT v_conversation, coalesce(v_message,
    (SELECT id FROM public.crm_messages WHERE provider = 'whatsapp' AND provider_message_id = p_provider_message_id)), v_message IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.crm_inbox_ingest(text,text,text,text,public.crm_message_direction,text,text,timestamptz,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_inbox_ingest(text,text,text,text,public.crm_message_direction,text,text,timestamptz,text,uuid) TO service_role;

CREATE FUNCTION public.crm_inbox_bind_lead(p_conversation_id uuid, p_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_name text;
BEGIN
  SELECT full_name INTO STRICT v_name FROM public.leads WHERE id = p_lead_id;
  UPDATE public.crm_conversations SET lead_id = p_lead_id, contact_name = v_name
    WHERE id = p_conversation_id AND provider = 'whatsapp';
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  UPDATE public.crm_messages SET lead_id = p_lead_id WHERE conversation_id = p_conversation_id;
END $$;
REVOKE ALL ON FUNCTION public.crm_inbox_bind_lead(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_inbox_bind_lead(uuid,uuid) TO service_role;

CREATE FUNCTION public.crm_inbox_unread_total() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(unread_count), 0)::bigint FROM public.crm_conversations WHERE provider = 'whatsapp'
$$;
REVOKE ALL ON FUNCTION public.crm_inbox_unread_total() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_inbox_unread_total() TO service_role;

-- No old rows are deleted: legacy queue remains available to the published UI until deploy.
COMMIT;
