-- Column management is deliberately independent of lead stages and automations.
CREATE OR REPLACE FUNCTION public.crm_column_manage(
  p_action text,
  p_column_id uuid DEFAULT NULL,
  p_label text DEFAULT NULL,
  p_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_column public.crm_columns%ROWTYPE;
  v_id uuid;
  v_label text := btrim(coalesce(p_label, ''));
BEGIN
  IF p_action NOT IN ('create', 'rename', 'archive', 'restore', 'delete') THEN
    RAISE EXCEPTION 'Acao de coluna invalida';
  END IF;
  LOCK TABLE public.crm_columns IN SHARE ROW EXCLUSIVE MODE;

  IF p_action = 'create' THEN
    IF length(v_label) NOT BETWEEN 2 AND 60 OR p_actor IS NULL THEN
      RAISE EXCEPTION 'Nome ou ator invalido';
    END IF;
    INSERT INTO public.crm_columns (key, label, type, position, is_active, is_locked, created_by)
    VALUES (
      'custom_' || replace(gen_random_uuid()::text, '-', ''), v_label, 'custom',
      coalesce((SELECT max(position) FROM public.crm_columns WHERE is_active), 0) + 10,
      true, false, p_actor
    ) RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT * INTO v_column FROM public.crm_columns WHERE id = p_column_id FOR UPDATE;
  IF NOT FOUND OR v_column.type <> 'custom' OR v_column.is_locked THEN
    RAISE EXCEPTION 'Somente colunas personalizadas podem ser alteradas';
  END IF;
  v_id := v_column.id;

  IF p_action = 'rename' THEN
    IF length(v_label) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'Nome invalido'; END IF;
    UPDATE public.crm_columns SET label = v_label WHERE id = v_id;
  ELSIF p_action = 'archive' THEN
    IF NOT v_column.is_active THEN RAISE EXCEPTION 'Coluna ja arquivada'; END IF;
    UPDATE public.crm_columns SET is_active = false WHERE id = v_id;
  ELSIF p_action = 'restore' THEN
    IF v_column.is_active THEN RAISE EXCEPTION 'Coluna ja esta ativa'; END IF;
    UPDATE public.crm_columns
    SET is_active = true,
        position = coalesce((SELECT max(position) FROM public.crm_columns WHERE is_active), 0) + 10
    WHERE id = v_id;
  ELSIF p_action = 'delete' THEN
    -- FOR UPDATE above conflicts with the FK's KEY SHARE lock, avoiding a count/delete race.
    IF EXISTS (SELECT 1 FROM public.leads WHERE crm_column_id = v_id) THEN
      RAISE EXCEPTION 'Coluna com leads deve ser arquivada';
    END IF;
    DELETE FROM public.crm_columns WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_column_reorder(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_active_count integer;
BEGIN
  IF p_ids IS NULL OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Ordem invalida';
  END IF;
  LOCK TABLE public.crm_columns IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO v_active_count FROM public.crm_columns WHERE is_active;
  IF cardinality(p_ids) <> v_active_count
     OR (SELECT count(DISTINCT id) FROM unnest(p_ids) AS u(id)) <> v_active_count
     OR EXISTS (
       SELECT 1 FROM unnest(p_ids) AS u(id)
       LEFT JOIN public.crm_columns c ON c.id = u.id AND c.is_active
       WHERE c.id IS NULL
     ) THEN
    RAISE EXCEPTION 'A lista deve conter todas as colunas ativas uma unica vez';
  END IF;
  UPDATE public.crm_columns c
  SET position = ordered.ordinality::integer * 10
  FROM unnest(p_ids) WITH ORDINALITY AS ordered(id, ordinality)
  WHERE c.id = ordered.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_guard_active_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.crm_column_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.crm_column_id IS DISTINCT FROM OLD.crm_column_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.crm_columns
       WHERE id = NEW.crm_column_id AND is_active FOR SHARE
     ) THEN
    RAISE EXCEPTION 'Nao e permitido mover leads para coluna arquivada';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_zz_crm_guard_active_column
BEFORE INSERT OR UPDATE OF crm_column_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.crm_guard_active_column();

REVOKE ALL ON FUNCTION public.crm_column_manage(text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_column_reorder(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_guard_active_column() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_column_manage(text, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_column_reorder(uuid[]) TO service_role;
