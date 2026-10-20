-- Preserve explicit stop-rule choices and keep reply handling atomic with the lead move.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.crm_automation_save_flow_atomic(
  p_flow jsonb, p_steps jsonb, p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_flow public.crm_automation_flows%ROWTYPE;
  v_step jsonb;
  v_position integer := 0;
  v_trigger text := p_flow->>'trigger_type';
  v_status text;
  v_rules jsonb;
BEGIN
  IF p_flow IS NULL OR jsonb_typeof(p_flow) <> 'object'
     OR p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array'
     OR jsonb_array_length(p_steps) NOT BETWEEN 1 AND 30
     OR v_trigger NOT IN ('lead_created', 'pipeline_stage_entered', 'manual') THEN
    RAISE EXCEPTION 'Configuracao de fluxo invalida';
  END IF;
  IF length(trim(coalesce(p_flow->>'name', ''))) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'Nome de fluxo invalido';
  END IF;
  IF p_flow ? 'stop_rules' AND jsonb_typeof(p_flow->'stop_rules') <> 'object' THEN
    RAISE EXCEPTION 'Regras de parada invalidas';
  END IF;
  v_rules := '{"stop_on_reply":true,"stop_on_final_stage":true,"avoid_conflicts":true,"on_reply_move_stage_enabled":false}'::jsonb
    || coalesce(p_flow->'stop_rules', '{}'::jsonb);
  IF v_trigger = 'pipeline_stage_entered' AND NOT EXISTS (
    SELECT 1 FROM public.crm_columns
    WHERE id = nullif(p_flow#>>'{trigger_config,column_id}', '')::uuid AND is_active
  ) THEN
    RAISE EXCEPTION 'Coluna de gatilho invalida ou arquivada';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(v_rules) AS flag(key, value)
    WHERE flag.key IN ('stop_on_reply','stop_on_final_stage','avoid_conflicts','on_reply_move_stage_enabled')
      AND jsonb_typeof(flag.value) <> 'boolean'
  ) THEN
    RAISE EXCEPTION 'Regra de parada invalida';
  END IF;
  IF (v_rules->>'on_reply_move_stage_enabled')::boolean THEN
    IF NOT (v_rules->>'stop_on_reply')::boolean OR NOT EXISTS (
      SELECT 1 FROM public.crm_columns c
      WHERE c.id::text = v_rules->>'on_reply_move_stage' AND c.is_active
    ) THEN
      RAISE EXCEPTION 'Movimentacao por resposta exige parada habilitada e coluna ativa';
    END IF;
  END IF;

  IF nullif(p_flow->>'id', '') IS NOT NULL THEN
    v_id := (p_flow->>'id')::uuid;
    SELECT * INTO v_flow FROM public.crm_automation_flows WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Fluxo nao encontrado'; END IF;
    IF EXISTS (SELECT 1 FROM public.crm_automation_executions
               WHERE flow_id = v_id AND status IN ('running', 'waiting', 'paused')) THEN
      RAISE EXCEPTION 'Ha execucao em andamento. Duplique o fluxo para editar sua estrutura';
    END IF;
    v_status := v_flow.status;
    UPDATE public.crm_automation_flows SET
      name = trim(p_flow->>'name'),
      description = nullif(trim(coalesce(p_flow->>'description', '')), ''),
      trigger_type = v_trigger,
      trigger_config = coalesce(p_flow->'trigger_config', '{}'::jsonb),
      stop_rules = v_rules,
      schedule_window = coalesce(p_flow->'schedule_window', '{}'::jsonb)
    WHERE id = v_id;
    UPDATE public.crm_automation_steps SET is_deleted = true WHERE flow_id = v_id;
  ELSE
    INSERT INTO public.crm_automation_flows
      (name, description, status, trigger_type, trigger_config, stop_rules, schedule_window, created_by)
    VALUES (
      trim(p_flow->>'name'), nullif(trim(coalesce(p_flow->>'description', '')), ''),
      'paused', v_trigger, coalesce(p_flow->'trigger_config', '{}'::jsonb),
      v_rules, coalesce(p_flow->'schedule_window', '{}'::jsonb), p_actor
    ) RETURNING id INTO v_id;
    v_status := 'paused';
  END IF;

  FOR v_step IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
    v_position := v_position + 1;
    IF v_step->>'step_type' NOT IN ('send_whatsapp', 'delay', 'condition', 'action', 'end')
       OR length(trim(coalesce(v_step->>'title', ''))) NOT BETWEEN 2 AND 120 THEN
      RAISE EXCEPTION 'Bloco invalido na posicao %', v_position;
    END IF;
    INSERT INTO public.crm_automation_steps (flow_id, position, step_type, title, config)
    VALUES (v_id, v_position, v_step->>'step_type', trim(v_step->>'title'),
            coalesce(v_step->'config', '{}'::jsonb));
  END LOOP;
  INSERT INTO public.crm_automation_execution_logs (flow_id, event_type, message, metadata)
  VALUES (v_id, 'flow_saved', 'Fluxo salvo pela equipe.',
          jsonb_build_object('actor_id', p_actor, 'status', v_status));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_save_flow_atomic(jsonb,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_automation_save_flow_atomic(jsonb,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_automation_stop_for_lead(
  p_lead_id uuid, p_reason text, p_step_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_exec record;
  v_stopped uuid;
  v_lead public.leads%ROWTYPE;
  v_column public.crm_columns%ROWTYPE;
  v_moved boolean := false;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id=p_lead_id FOR UPDATE;
  FOR v_exec IN
    SELECT e.id, e.flow_id, e.lead_id, e.started_at, f.stop_rules
    FROM public.crm_automation_executions e
    JOIN public.crm_automation_flows f ON f.id = e.flow_id
    WHERE e.lead_id = p_lead_id AND e.status IN ('running', 'waiting', 'paused')
      AND (p_reason <> 'lead_replied' OR (
        coalesce((f.stop_rules->>'stop_on_reply')::boolean, true)
        AND EXISTS (SELECT 1 FROM public.crm_messages m WHERE m.lead_id=e.lead_id
          AND m.direction='inbound' AND m.created_at > e.started_at)
      ))
    ORDER BY e.started_at, e.id FOR UPDATE OF e
  LOOP
    v_stopped := NULL;
    UPDATE public.crm_automation_executions SET status='stopped', stop_reason=p_reason,
      completed_at=now(), last_activity_at=now(),
      current_step_id=coalesce(p_step_id,current_step_id)
    WHERE id=v_exec.id AND status IN ('running','waiting','paused') RETURNING id INTO v_stopped;
    IF v_stopped IS NULL THEN CONTINUE; END IF;
    UPDATE public.crm_automation_pending_actions SET status='canceled',
      last_error=p_reason, locked_at=NULL WHERE execution_id=v_exec.id
      AND status IN ('pending','locked');
    INSERT INTO public.crm_automation_execution_logs
      (execution_id,flow_id,lead_id,step_id,event_type,message,metadata)
    VALUES (v_exec.id,v_exec.flow_id,v_exec.lead_id,p_step_id,
      CASE WHEN p_reason='lead_replied' THEN 'lead_replied' ELSE 'automation_stopped' END,
      CASE WHEN p_reason='lead_replied' THEN 'Lead respondeu; automacao interrompida.' ELSE p_reason END,
      jsonb_build_object('reason',p_reason));
    IF p_reason='lead_replied' THEN
      PERFORM public.crm_automation_increment_metric(v_exec.flow_id,'stopped_by_reply',1);
      PERFORM public.crm_automation_increment_metric(v_exec.flow_id,'replies',1);
      IF NOT v_moved AND coalesce((v_exec.stop_rules->>'on_reply_move_stage_enabled')::boolean,false) THEN
        -- Lock the lead and destination, as in the canonical column move. Never overwrite a final stage.
        SELECT * INTO v_lead FROM public.leads WHERE id=p_lead_id FOR UPDATE;
        SELECT * INTO v_column FROM public.crm_columns
          WHERE id::text=v_exec.stop_rules->>'on_reply_move_stage' AND is_active FOR SHARE;
        IF v_column.id IS NULL OR v_lead.pipeline_stage::text IN ('fechado','descartado') THEN
          INSERT INTO public.crm_automation_execution_logs
            (execution_id,flow_id,lead_id,event_type,message,metadata)
          VALUES (v_exec.id,v_exec.flow_id,v_exec.lead_id,'reply_stage_move_skipped',
            'Movimentacao por resposta ignorada: destino inativo ou lead em etapa final.',
            jsonb_build_object('column_id',v_exec.stop_rules->>'on_reply_move_stage'));
        ELSE
          v_moved := true;
          IF v_lead.crm_column_id IS DISTINCT FROM v_column.id THEN
            UPDATE public.leads SET crm_column_id=v_column.id,
              pipeline_stage=CASE WHEN v_column.key IN ('novo','em_contato','reuniao','fechado','descartado')
                THEN v_column.key::public.lead_pipeline_stage ELSE pipeline_stage END,
              last_interaction_at=now()
            WHERE id=p_lead_id;
            INSERT INTO public.lead_activity_log (lead_id,kind,payload,actor_id)
            VALUES (p_lead_id,'stage_changed',
              jsonb_build_object('from',coalesce(v_lead.crm_column_id::text,v_lead.pipeline_stage::text),
                'to',v_column.key,'to_label',v_column.label,'source','crm_automation_reply',
                'execution_id',v_exec.id),NULL);
            INSERT INTO public.crm_automation_execution_logs
              (execution_id,flow_id,lead_id,event_type,message,metadata)
            VALUES (v_exec.id,v_exec.flow_id,v_exec.lead_id,'reply_stage_moved',
              'Lead movido apos resposta.',jsonb_build_object('column_id',v_column.id,'label',v_column.label));
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_stop_for_lead(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_automation_stop_for_lead(uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_automation_stop_on_inbound_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.direction::text='inbound' AND NEW.lead_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.crm_automation_executions e
       JOIN public.crm_automation_flows f ON f.id=e.flow_id
       WHERE e.lead_id=NEW.lead_id AND e.status IN ('running','waiting','paused')
         AND NEW.created_at > e.started_at
         AND coalesce((f.stop_rules->>'stop_on_reply')::boolean,true)
     ) THEN
    PERFORM public.crm_automation_stop_for_lead(NEW.lead_id,'lead_replied',NULL);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_stop_on_inbound_message() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_automation_stop_on_final_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_exec record;
BEGIN
  IF coalesce(NEW.pipeline_stage::text,'') NOT IN ('fechado','descartado')
     OR NEW.pipeline_stage IS NOT DISTINCT FROM OLD.pipeline_stage THEN RETURN NEW; END IF;
  FOR v_exec IN
    SELECT e.id,e.flow_id,e.lead_id FROM public.crm_automation_executions e
    JOIN public.crm_automation_flows f ON f.id=e.flow_id
    WHERE e.lead_id=NEW.id AND e.status IN ('running','waiting','paused')
      AND coalesce((f.stop_rules->>'stop_on_final_stage')::boolean,true)
    FOR UPDATE OF e
  LOOP
    UPDATE public.crm_automation_executions SET status='stopped',stop_reason='final_stage',
      completed_at=now(),last_activity_at=now() WHERE id=v_exec.id;
    UPDATE public.crm_automation_pending_actions SET status='canceled',locked_at=NULL,
      last_error='final_stage' WHERE execution_id=v_exec.id AND status IN ('pending','locked');
    INSERT INTO public.crm_automation_execution_logs
      (execution_id,flow_id,lead_id,event_type,message,metadata)
    VALUES (v_exec.id,v_exec.flow_id,v_exec.lead_id,'automation_stopped',
      'Lead entrou em etapa final; automacao interrompida.',
      jsonb_build_object('stage',NEW.pipeline_stage::text));
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_stop_on_final_stage() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_automation_control_execution(
  p_execution_id uuid, p_action text, p_actor uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_execution public.crm_automation_executions%ROWTYPE;
DECLARE v_flow public.crm_automation_flows%ROWTYPE;
BEGIN
  SELECT * INTO v_execution FROM public.crm_automation_executions WHERE id=p_execution_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Execucao nao encontrada'; END IF;
  SELECT * INTO v_flow FROM public.crm_automation_flows WHERE id=v_execution.flow_id;
  IF p_action='pause' THEN
    IF v_execution.status NOT IN ('running','waiting') THEN RAISE EXCEPTION 'Fluxo nao pode ser pausado'; END IF;
    UPDATE public.crm_automation_executions SET status='paused',last_activity_at=now() WHERE id=p_execution_id;
  ELSIF p_action='resume' THEN
    IF v_execution.status <> 'paused' OR v_flow.status <> 'active' THEN
      RAISE EXCEPTION 'Fluxo nao pode ser retomado'; END IF;
    IF coalesce((v_flow.stop_rules->>'stop_on_reply')::boolean,true)
       AND EXISTS (SELECT 1 FROM public.crm_messages
         WHERE lead_id=v_execution.lead_id AND direction='inbound'
           AND created_at > v_execution.started_at) THEN
      RAISE EXCEPTION 'Lead respondeu; fluxo encerrado'; END IF;
    IF coalesce((v_flow.stop_rules->>'stop_on_final_stage')::boolean,true)
       AND EXISTS (SELECT 1 FROM public.leads WHERE id=v_execution.lead_id
         AND pipeline_stage::text IN ('fechado','descartado')) THEN
      RAISE EXCEPTION 'Lead em etapa final; fluxo encerrado'; END IF;
    UPDATE public.crm_automation_executions SET status='waiting',last_activity_at=now() WHERE id=p_execution_id;
    UPDATE public.crm_automation_pending_actions SET run_at=greatest(run_at,now()),locked_at=NULL
      WHERE execution_id=p_execution_id AND status='pending';
  ELSIF p_action='cancel' THEN
    IF v_execution.status NOT IN ('running','waiting','paused') THEN RAISE EXCEPTION 'Fluxo ja encerrado'; END IF;
    UPDATE public.crm_automation_executions SET status='stopped',stop_reason='manual_cancel',
      completed_at=now(),last_activity_at=now() WHERE id=p_execution_id;
    UPDATE public.crm_automation_pending_actions SET status='canceled',locked_at=NULL,
      last_error='manual_cancel' WHERE execution_id=p_execution_id AND status IN ('pending','locked');
  ELSE RAISE EXCEPTION 'Acao invalida';
  END IF;
  INSERT INTO public.crm_automation_execution_logs
    (execution_id,flow_id,lead_id,event_type,message,metadata)
  VALUES (v_execution.id,v_execution.flow_id,v_execution.lead_id,
    'flow_'||CASE WHEN p_action='cancel' THEN 'canceled' ELSE p_action||'d' END,
    CASE p_action WHEN 'pause' THEN 'Fluxo pausado pela equipe.'
                  WHEN 'resume' THEN 'Fluxo retomado pela equipe.'
                  ELSE 'Fluxo cancelado pela equipe.' END,
    jsonb_build_object('actor_id',p_actor));
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_control_execution(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_automation_control_execution(uuid,text,uuid) TO service_role;

COMMIT;
