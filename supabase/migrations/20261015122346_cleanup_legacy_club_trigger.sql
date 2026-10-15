-- Remove the obsolete Club benefit hook without touching current PDV behavior.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.tab_items'::regclass
      AND trigger.tgname = 'tab_items_apply_benefit'
      AND trigger.tgfoid IS DISTINCT FROM to_regprocedure('public.apply_club_benefits()')
  ) THEN
    RAISE EXCEPTION 'tab_items_apply_benefit no longer calls public.apply_club_benefits(); aborting cleanup';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS tab_items_apply_benefit ON public.tab_items;
DROP FUNCTION IF EXISTS public.apply_club_benefits() RESTRICT;

COMMIT;
