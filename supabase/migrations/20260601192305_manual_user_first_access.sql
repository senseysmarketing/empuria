-- Manual user creation and first access flags.
-- Admin/staff can create customers without setting a password; the customer
-- completes password setup from /login using the first-access flow.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS created_by_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_setup_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_access_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by_staff_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS profile_origin text NOT NULL DEFAULT 'public_signup';

CREATE INDEX IF NOT EXISTS idx_profiles_first_access_pending
  ON public.profiles (password_setup_required, first_access_completed_at)
  WHERE password_setup_required = true;

CREATE INDEX IF NOT EXISTS idx_profiles_profile_origin
  ON public.profiles (profile_origin);

CREATE INDEX IF NOT EXISTS idx_profiles_created_by_staff_id
  ON public.profiles (created_by_staff_id);

UPDATE public.profiles
SET profile_origin = 'public_signup'
WHERE profile_origin IS NULL OR btrim(profile_origin) = '';

-- Keep public self-signup marked as a normal account. Manual admin-created
-- accounts are flagged explicitly by trusted server functions after Auth user
-- creation, so this trigger must stay conservative.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (
    id,
    full_name,
    avatar_url,
    created_by_admin,
    password_setup_required,
    profile_origin
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url',
    false,
    false,
    'public_signup'
  )
  on conflict (id) do update set
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    profile_origin = coalesce(public.profiles.profile_origin, 'public_signup');

  insert into public.user_roles (user_id, role)
  values (new.id, 'member'::public.app_role)
  on conflict do nothing;

  return new;
end;
$function$;
