BEGIN;
SET LOCAL lock_timeout = '5s';

-- Unknown WhatsApp contacts have no lead; lead-only side effects must wait for an explicit link.
CREATE OR REPLACE FUNCTION public.crm_automation_stop_on_inbound_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction::text = 'inbound' AND NEW.lead_id IS NOT NULL THEN
    PERFORM public.crm_automation_stop_for_lead(NEW.lead_id, 'lead_replied', NULL);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.crm_cancel_obsolete_followups_on_inbound()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'inbound' AND NEW.lead_id IS NOT NULL THEN
    UPDATE public.crm_followups f
    SET status = 'canceled',
        canceled_reason = 'Lead respondeu apos a criacao do follow-up.',
        updated_at = now()
    WHERE f.lead_id = NEW.lead_id
      AND f.status = 'pending'
      AND f.created_at <= NEW.created_at;

    UPDATE public.leads
    SET last_inbound_at = NEW.created_at,
        last_interaction_at = NEW.created_at,
        next_followup_at = (
          SELECT nf.due_at FROM public.crm_followups nf
          WHERE nf.lead_id = NEW.lead_id AND nf.status = 'pending'
          ORDER BY nf.due_at LIMIT 1
        )
    WHERE id = NEW.lead_id;

    INSERT INTO public.lead_activity_log (lead_id, kind, payload)
    VALUES (NEW.lead_id, 'message_inbound',
      jsonb_build_object('message_id', NEW.id, 'provider', NEW.provider));
  END IF;
  RETURN NEW;
END $$;

COMMIT;
