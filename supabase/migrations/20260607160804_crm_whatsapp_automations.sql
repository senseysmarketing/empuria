-- CRM & WhatsApp automation engine.
-- Replaces manual follow-up suggestions with auditable multi-step flows.

CREATE TABLE IF NOT EXISTS public.crm_automation_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'paused',
  trigger_type text NOT NULL DEFAULT 'lead_created',
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  stop_rules jsonb NOT NULL DEFAULT '{
    "stop_on_reply": true,
    "stop_on_final_stage": true,
    "avoid_conflicts": true,
    "max_messages_per_lead": 4,
    "min_minutes_between_messages": 15,
    "block_if_whatsapp_disconnected": true
  }'::jsonb,
  schedule_window jsonb NOT NULL DEFAULT '{
    "timezone": "Europe/Madrid",
    "weekdays": [1,2,3,4,5],
    "start": "09:00",
    "end": "18:00"
  }'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{
    "entered": 0,
    "sent": 0,
    "replies": 0,
    "stopped_by_reply": 0,
    "errors": 0
  }'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_automation_flows_status_check CHECK (status IN ('active', 'paused', 'archived')),
  CONSTRAINT crm_automation_flows_trigger_check CHECK (trigger_type IN (
    'lead_created',
    'pipeline_stage_entered',
    'inbound_message',
    'manual'
  ))
);

CREATE TABLE IF NOT EXISTS public.crm_automation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.crm_automation_flows(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  step_type text NOT NULL,
  title text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_step_id uuid REFERENCES public.crm_automation_steps(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_automation_steps_type_check CHECK (step_type IN (
    'send_whatsapp',
    'delay',
    'condition',
    'action',
    'end'
  ))
);

CREATE TABLE IF NOT EXISTS public.crm_automation_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.crm_automation_flows(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.crm_conversations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running',
  current_step_id uuid REFERENCES public.crm_automation_steps(id) ON DELETE SET NULL,
  trigger_type text NOT NULL DEFAULT 'manual',
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  stop_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_automation_executions_status_check CHECK (status IN (
    'running',
    'waiting',
    'completed',
    'stopped',
    'failed'
  ))
);

CREATE TABLE IF NOT EXISTS public.crm_automation_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.crm_automation_executions(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.crm_automation_flows(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.crm_automation_steps(id) ON DELETE CASCADE,
  action_type text NOT NULL DEFAULT 'process_step',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_automation_pending_status_check CHECK (status IN (
    'pending',
    'locked',
    'done',
    'canceled',
    'failed'
  )),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.crm_automation_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid REFERENCES public.crm_automation_executions(id) ON DELETE CASCADE,
  flow_id uuid REFERENCES public.crm_automation_flows(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.crm_automation_steps(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_automation_flows_status
  ON public.crm_automation_flows (status, trigger_type)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_crm_automation_steps_flow_position
  ON public.crm_automation_steps (flow_id, position)
  WHERE is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS crm_automation_one_active_execution_per_flow_lead
  ON public.crm_automation_executions (flow_id, lead_id)
  WHERE status IN ('running', 'waiting');

CREATE INDEX IF NOT EXISTS idx_crm_automation_executions_lead_status
  ON public.crm_automation_executions (lead_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_automation_pending_due
  ON public.crm_automation_pending_actions (status, run_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_crm_automation_logs_flow_created
  ON public.crm_automation_execution_logs (flow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_automation_logs_lead_created
  ON public.crm_automation_execution_logs (lead_id, created_at DESC);

ALTER TABLE public.crm_automation_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_automation_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_automation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_automation_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_automation_execution_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_automation_flows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_automation_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_automation_executions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_automation_pending_actions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_automation_execution_logs TO authenticated;
GRANT ALL ON public.crm_automation_flows TO service_role;
GRANT ALL ON public.crm_automation_steps TO service_role;
GRANT ALL ON public.crm_automation_executions TO service_role;
GRANT ALL ON public.crm_automation_pending_actions TO service_role;
GRANT ALL ON public.crm_automation_execution_logs TO service_role;

DROP POLICY IF EXISTS "Staff view CRM automation flows" ON public.crm_automation_flows;
CREATE POLICY "Staff view CRM automation flows"
  ON public.crm_automation_flows FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Admins or managers edit CRM automation flows" ON public.crm_automation_flows;
CREATE POLICY "Admins or managers edit CRM automation flows"
  ON public.crm_automation_flows FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_action(auth.uid(), 'crm.automations.manage'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_action(auth.uid(), 'crm.automations.manage'));

DROP POLICY IF EXISTS "Staff view CRM automation steps" ON public.crm_automation_steps;
CREATE POLICY "Staff view CRM automation steps"
  ON public.crm_automation_steps FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Admins or managers edit CRM automation steps" ON public.crm_automation_steps;
CREATE POLICY "Admins or managers edit CRM automation steps"
  ON public.crm_automation_steps FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_action(auth.uid(), 'crm.automations.manage'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_action(auth.uid(), 'crm.automations.manage'));

DROP POLICY IF EXISTS "Staff view CRM automation executions" ON public.crm_automation_executions;
CREATE POLICY "Staff view CRM automation executions"
  ON public.crm_automation_executions FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Admins or managers edit CRM automation executions" ON public.crm_automation_executions;
CREATE POLICY "Admins or managers edit CRM automation executions"
  ON public.crm_automation_executions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_action(auth.uid(), 'crm.automations.manage'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_action(auth.uid(), 'crm.automations.manage'));

DROP POLICY IF EXISTS "Staff view CRM automation pending actions" ON public.crm_automation_pending_actions;
CREATE POLICY "Staff view CRM automation pending actions"
  ON public.crm_automation_pending_actions FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Authorized staff cancel CRM automation pending actions" ON public.crm_automation_pending_actions;
CREATE POLICY "Authorized staff cancel CRM automation pending actions"
  ON public.crm_automation_pending_actions FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_action(auth.uid(), 'crm.automations.manage')
    OR public.has_action(auth.uid(), 'crm.automations.cancel_pending_action')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_action(auth.uid(), 'crm.automations.manage')
    OR public.has_action(auth.uid(), 'crm.automations.cancel_pending_action')
  );

DROP POLICY IF EXISTS "Admins or managers insert CRM automation pending actions" ON public.crm_automation_pending_actions;
CREATE POLICY "Admins or managers insert CRM automation pending actions"
  ON public.crm_automation_pending_actions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_action(auth.uid(), 'crm.automations.manage'));

DROP POLICY IF EXISTS "Staff view CRM automation logs" ON public.crm_automation_execution_logs;
CREATE POLICY "Staff view CRM automation logs"
  ON public.crm_automation_execution_logs FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Admins or managers insert CRM automation logs" ON public.crm_automation_execution_logs;
CREATE POLICY "Admins or managers insert CRM automation logs"
  ON public.crm_automation_execution_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_action(auth.uid(), 'crm.automations.manage'));

DROP TRIGGER IF EXISTS trg_crm_automation_flows_updated ON public.crm_automation_flows;
CREATE TRIGGER trg_crm_automation_flows_updated
BEFORE UPDATE ON public.crm_automation_flows
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_crm_automation_steps_updated ON public.crm_automation_steps;
CREATE TRIGGER trg_crm_automation_steps_updated
BEFORE UPDATE ON public.crm_automation_steps
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_crm_automation_executions_updated ON public.crm_automation_executions;
CREATE TRIGGER trg_crm_automation_executions_updated
BEFORE UPDATE ON public.crm_automation_executions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_crm_automation_pending_actions_updated ON public.crm_automation_pending_actions;
CREATE TRIGGER trg_crm_automation_pending_actions_updated
BEFORE UPDATE ON public.crm_automation_pending_actions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.crm_automation_increment_metric(
  p_flow_id uuid,
  p_key text,
  p_amount integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.crm_automation_flows
  SET metrics = jsonb_set(
      COALESCE(metrics, '{}'::jsonb),
      ARRAY[p_key],
      to_jsonb(COALESCE((metrics ->> p_key)::integer, 0) + p_amount),
      true
    ),
    updated_at = now()
  WHERE id = p_flow_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_automation_stop_for_lead(
  p_lead_id uuid,
  p_reason text,
  p_step_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  exec_row record;
BEGIN
  FOR exec_row IN
    SELECT e.id, e.flow_id, e.lead_id
    FROM public.crm_automation_executions e
    JOIN public.crm_automation_flows f ON f.id = e.flow_id
    WHERE e.lead_id = p_lead_id
      AND e.status IN ('running', 'waiting')
      AND COALESCE((f.stop_rules ->> 'stop_on_reply')::boolean, true) = true
  LOOP
    UPDATE public.crm_automation_executions
    SET status = 'stopped',
        stop_reason = p_reason,
        completed_at = now(),
        last_activity_at = now(),
        current_step_id = COALESCE(p_step_id, current_step_id)
    WHERE id = exec_row.id;

    UPDATE public.crm_automation_pending_actions
    SET status = 'canceled',
        last_error = p_reason,
        updated_at = now()
    WHERE execution_id = exec_row.id
      AND status IN ('pending', 'locked');

    INSERT INTO public.crm_automation_execution_logs (
      execution_id, flow_id, lead_id, step_id, event_type, message, metadata
    )
    VALUES (
      exec_row.id,
      exec_row.flow_id,
      exec_row.lead_id,
      p_step_id,
      CASE WHEN p_reason = 'lead_replied' THEN 'lead_replied' ELSE 'automation_stopped' END,
      CASE WHEN p_reason = 'lead_replied' THEN 'Lead respondeu; automacao interrompida.' ELSE p_reason END,
      jsonb_build_object('reason', p_reason)
    );

    PERFORM public.crm_automation_increment_metric(exec_row.flow_id, 'stopped_by_reply', 1)
      WHERE p_reason = 'lead_replied';
    PERFORM public.crm_automation_increment_metric(exec_row.flow_id, 'replies', 1)
      WHERE p_reason = 'lead_replied';
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_automation_stop_on_inbound_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.direction::text = 'inbound' THEN
    PERFORM public.crm_automation_stop_for_lead(NEW.lead_id, 'lead_replied', NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_automation_stop_on_inbound_message ON public.crm_messages;
CREATE TRIGGER trg_crm_automation_stop_on_inbound_message
AFTER INSERT ON public.crm_messages
FOR EACH ROW EXECUTE FUNCTION public.crm_automation_stop_on_inbound_message();

CREATE OR REPLACE FUNCTION public.crm_automation_stop_on_final_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  exec_row record;
BEGIN
  IF COALESCE(NEW.pipeline_stage::text, '') NOT IN ('fechado', 'descartado') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(OLD.pipeline_stage::text, '') = COALESCE(NEW.pipeline_stage::text, '') THEN
    RETURN NEW;
  END IF;

  FOR exec_row IN
    SELECT e.id, e.flow_id, e.lead_id
    FROM public.crm_automation_executions e
    JOIN public.crm_automation_flows f ON f.id = e.flow_id
    WHERE e.lead_id = NEW.id
      AND e.status IN ('running', 'waiting')
      AND COALESCE((f.stop_rules ->> 'stop_on_final_stage')::boolean, true) = true
  LOOP
    UPDATE public.crm_automation_executions
    SET status = 'stopped',
        stop_reason = 'final_stage',
        completed_at = now(),
        last_activity_at = now()
    WHERE id = exec_row.id;

    UPDATE public.crm_automation_pending_actions
    SET status = 'canceled',
        last_error = 'final_stage',
        updated_at = now()
    WHERE execution_id = exec_row.id
      AND status IN ('pending', 'locked');

    INSERT INTO public.crm_automation_execution_logs (
      execution_id, flow_id, lead_id, event_type, message, metadata
    )
    VALUES (
      exec_row.id,
      exec_row.flow_id,
      exec_row.lead_id,
      'automation_stopped',
      'Lead entrou em etapa final; automacao interrompida.',
      jsonb_build_object('stage', NEW.pipeline_stage::text)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_automation_stop_on_final_stage ON public.leads;
CREATE TRIGGER trg_crm_automation_stop_on_final_stage
AFTER UPDATE OF pipeline_stage ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.crm_automation_stop_on_final_stage();

REVOKE EXECUTE ON FUNCTION public.crm_automation_increment_metric(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_automation_stop_for_lead(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_automation_stop_on_inbound_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_automation_stop_on_final_stage() FROM PUBLIC, anon, authenticated;

INSERT INTO public.staff_module_permissions (user_id, module_key, is_allowed)
SELECT ur.user_id, 'automacoes', true
FROM public.user_roles ur
WHERE ur.role IN ('admin', 'staff')
ON CONFLICT (user_id, module_key) DO NOTHING;
