-- Existing storefront services stay public; every future service defaults to internal.
ALTER TABLE public.services
  ADD COLUMN is_public boolean NOT NULL DEFAULT false;

DO $$
DECLARE v_expected integer;
BEGIN
  -- A fresh Preview may not contain production rows. A populated database must
  -- contain the four exact services confirmed before this migration.
  IF EXISTS (SELECT 1 FROM public.services) THEN
    SELECT count(*) INTO v_expected
    FROM public.services s
    JOIN (VALUES
      ('c4bd3798-894a-401e-b7bf-561736af18e3'::uuid, 'recepcao-aeroporto', 20000),
      ('edc9a940-1022-4ccd-8bee-cb220bae016e'::uuid, 'vale-transporte', 10000),
      ('2a2195c5-dab4-4523-a541-18b603396627'::uuid, 'conta-bancaria', 0),
      ('e078b5e1-dbcc-4d97-aa8f-03f3600417ee'::uuid, 'tour-economico', 20000)
    ) AS expected(id, slug, online_price_cents)
      ON s.id = expected.id AND s.slug = expected.slug
      AND s.online_price_cents = expected.online_price_cents
      AND s.currency = 'EUR' AND s.online_currency = 'EUR'
      AND s.is_active AND s.archived_at IS NULL;
    IF v_expected <> 4 THEN
      RAISE EXCEPTION 'Public services baseline differs; refusing automatic publication';
    END IF;
    UPDATE public.services SET is_public = true
    WHERE id IN (
      'c4bd3798-894a-401e-b7bf-561736af18e3',
      'edc9a940-1022-4ccd-8bee-cb220bae016e',
      '2a2195c5-dab4-4523-a541-18b603396627',
      'e078b5e1-dbcc-4d97-aa8f-03f3600417ee'
    );
    IF (SELECT count(*) FROM public.services WHERE is_public) <> 4 THEN
      RAISE EXCEPTION 'Public services backfill count differs';
    END IF;
  END IF;
END $$;

DROP POLICY IF EXISTS "Anyone can view active services" ON public.services;
CREATE POLICY "Anyone can view public active services"
  ON public.services FOR SELECT TO anon, authenticated
  USING (
    (is_active AND is_public AND archived_at IS NULL)
    OR public.is_staff((SELECT auth.uid()))
  );
