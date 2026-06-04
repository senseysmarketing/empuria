ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_country_iso text;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone_country_iso text;

COMMENT ON COLUMN public.profiles.phone_country_iso IS 'ISO-3166-1 alpha-2 do país escolhido para o telefone (BR, ES, PT...). NULL = não informado.';
COMMENT ON COLUMN public.leads.phone_country_iso IS 'ISO-3166-1 alpha-2 do país escolhido para o telefone (BR, ES, PT...). NULL = não informado.';