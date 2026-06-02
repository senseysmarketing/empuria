-- CRM follow-ups V1: semi-automatic suggestions, audit fields and cancellation guards.

DO $$ BEGIN
  CREATE TYPE public.crm_followup_mode AS ENUM ('manual', 'suggestion', 'automatic');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE public.lead_activity_kind ADD VALUE IF NOT EXISTS 'followup_sent';
ALTER TYPE public.lead_activity_kind ADD VALUE IF NOT EXISTS 'followup_delayed';
ALTER TYPE public.lead_activity_kind ADD VALUE IF NOT EXISTS 'followup_canceled';
ALTER TYPE public.lead_activity_kind ADD VALUE IF NOT EXISTS 'message_inbound';
ALTER TYPE public.lead_activity_kind ADD VALUE IF NOT EXISTS 'message_outbound';

ALTER TABLE public.crm_followups
  ADD COLUMN IF NOT EXISTS mode public.crm_followup_mode NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS sequence_key text,
  ADD COLUMN IF NOT EXISTS step_index integer,
  ADD COLUMN IF NOT EXISTS canceled_reason text,
  ADD COLUMN IF NOT EXISTS sent_message_id uuid REFERENCES public.crm_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_crm_followups_status_mode_due
  ON public.crm_followups (status, mode, due_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_followups_pending_unique_step
  ON public.crm_followups (lead_id, type, template_key, mode)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.crm_cancel_obsolete_followups_on_inbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
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
          SELECT nf.due_at
          FROM public.crm_followups nf
          WHERE nf.lead_id = NEW.lead_id
            AND nf.status = 'pending'
          ORDER BY nf.due_at
          LIMIT 1
        )
    WHERE id = NEW.lead_id;

    INSERT INTO public.lead_activity_log (lead_id, kind, payload)
    VALUES (
      NEW.lead_id,
      'message_inbound',
      jsonb_build_object('message_id', NEW.id, 'provider', NEW.provider)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_cancel_followups_on_inbound ON public.crm_messages;
CREATE TRIGGER trg_crm_cancel_followups_on_inbound
AFTER INSERT ON public.crm_messages
FOR EACH ROW EXECUTE FUNCTION public.crm_cancel_obsolete_followups_on_inbound();

CREATE OR REPLACE FUNCTION public.crm_cancel_followups_on_closed_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.pipeline_stage::text IN ('fechado', 'descartado')
     AND OLD.pipeline_stage IS DISTINCT FROM NEW.pipeline_stage THEN
    UPDATE public.crm_followups
    SET status = 'canceled',
        canceled_reason = 'Lead movido para etapa final.',
        updated_at = now()
    WHERE lead_id = NEW.id
      AND status = 'pending';

    NEW.next_followup_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_cancel_followups_on_closed_stage ON public.leads;
CREATE TRIGGER trg_crm_cancel_followups_on_closed_stage
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.crm_cancel_followups_on_closed_stage();

REVOKE EXECUTE ON FUNCTION public.crm_cancel_obsolete_followups_on_inbound() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_cancel_followups_on_closed_stage() FROM PUBLIC, anon, authenticated;
