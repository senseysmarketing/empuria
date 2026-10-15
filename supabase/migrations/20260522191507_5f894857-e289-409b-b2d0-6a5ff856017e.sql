
-- Extend pipeline stage enum
ALTER TYPE public.lead_pipeline_stage ADD VALUE IF NOT EXISTS 'em_contato';
ALTER TYPE public.lead_pipeline_stage ADD VALUE IF NOT EXISTS 'reuniao';
ALTER TYPE public.lead_pipeline_stage ADD VALUE IF NOT EXISTS 'fechado';

-- Activity kind enum
DO $$ BEGIN
  CREATE TYPE public.lead_activity_kind AS ENUM (
    'created', 'stage_changed', 'note_added', 'meeting_scheduled', 'whatsapp_opened'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Activity log table
CREATE TABLE IF NOT EXISTS public.lead_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  kind public.lead_activity_kind NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  actor_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_activity_log_lead
  ON public.lead_activity_log (lead_id, created_at DESC);

ALTER TABLE public.lead_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff view lead activity" ON public.lead_activity_log;
CREATE POLICY "Staff view lead activity"
  ON public.lead_activity_log FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff insert lead activity" ON public.lead_activity_log;
CREATE POLICY "Staff insert lead activity"
  ON public.lead_activity_log FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

-- Trigger function: log creation + stage changes
CREATE OR REPLACE FUNCTION public.log_lead_pipeline_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.lead_activity_log (lead_id, kind, payload, actor_label)
    VALUES (NEW.id, 'created',
            jsonb_build_object('stage', NEW.pipeline_stage, 'target_visa', NEW.target_visa),
            'Formulário do site');
  ELSIF (TG_OP = 'UPDATE' AND OLD.pipeline_stage IS DISTINCT FROM NEW.pipeline_stage) THEN
    INSERT INTO public.lead_activity_log (lead_id, kind, payload, actor_id)
    VALUES (NEW.id, 'stage_changed',
            jsonb_build_object('from', OLD.pipeline_stage, 'to', NEW.pipeline_stage),
            auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_activity_insert ON public.leads;
CREATE TRIGGER trg_lead_activity_insert
AFTER INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.log_lead_pipeline_activity();

DROP TRIGGER IF EXISTS trg_lead_activity_update ON public.leads;
CREATE TRIGGER trg_lead_activity_update
AFTER UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.log_lead_pipeline_activity();
