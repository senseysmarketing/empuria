-- Archived columns retain their leads and cannot be a source or destination
-- for movement until restored. Ordinary updates to those leads remain allowed.
CREATE OR REPLACE FUNCTION public.crm_guard_active_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.crm_column_id IS NOT DISTINCT FROM OLD.crm_column_id THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.crm_column_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.crm_columns
       WHERE id = OLD.crm_column_id AND is_active FOR SHARE
     ) THEN
    RAISE EXCEPTION 'Restaure a coluna arquivada antes de mover seus leads';
  END IF;

  IF NEW.crm_column_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.crm_columns
       WHERE id = NEW.crm_column_id AND is_active FOR SHARE
     ) THEN
    RAISE EXCEPTION 'Nao e permitido mover leads para coluna arquivada';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_guard_active_column() FROM PUBLIC, anon, authenticated;
