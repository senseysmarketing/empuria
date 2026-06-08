
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS cover_url_vertical text,
  ADD COLUMN IF NOT EXISTS is_home_featured boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.events_enforce_single_featured()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_home_featured = true THEN
    UPDATE public.events
       SET is_home_featured = false, updated_at = now()
     WHERE is_home_featured = true
       AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_single_featured ON public.events;
CREATE TRIGGER trg_events_single_featured
  BEFORE INSERT OR UPDATE OF is_home_featured ON public.events
  FOR EACH ROW
  WHEN (NEW.is_home_featured = true)
  EXECUTE FUNCTION public.events_enforce_single_featured();

CREATE INDEX IF NOT EXISTS idx_events_home_featured
  ON public.events (is_home_featured)
  WHERE is_home_featured = true;
