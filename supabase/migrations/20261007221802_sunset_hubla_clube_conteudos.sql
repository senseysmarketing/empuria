-- Block A: retire the old Hubla integration and Club product. The external
-- public content URL is not an integration and needs no database objects.
-- Keep the service_category.clube enum value as a dormant legacy value.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.services WHERE category = 'clube') THEN
    RAISE EXCEPTION 'Club services must be reviewed before sunset';
  END IF;
  IF EXISTS (SELECT 1 FROM public.club_subscriptions) OR
     EXISTS (SELECT 1 FROM public.club_content) OR
     EXISTS (SELECT 1 FROM public.club_modules) OR
     EXISTS (SELECT 1 FROM public.club_lessons) OR
     EXISTS (SELECT 1 FROM public.club_lesson_files) OR
     EXISTS (SELECT 1 FROM public.club_lesson_comments) OR
     EXISTS (SELECT 1 FROM public.club_lesson_favorites) OR
     EXISTS (SELECT 1 FROM public.club_lesson_progress) OR
     EXISTS (SELECT 1 FROM public.club_certificates) OR
     EXISTS (SELECT 1 FROM public.community_posts) THEN
    RAISE EXCEPTION 'Club content or subscriptions require manual review before sunset';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_categories c
    WHERE c.name = 'Clube' AND
      (EXISTS (SELECT 1 FROM public.finance_transactions t WHERE t.category_id = c.id) OR
       EXISTS (SELECT 1 FROM public.finance_recurring_rules r WHERE r.category_id = c.id))
  ) THEN
    RAISE EXCEPTION 'Club finance category is still referenced';
  END IF;
END $$;

-- Remove PDV/profile hooks first, while all referenced tables/columns exist.
DROP TRIGGER IF EXISTS tab_items_apply_benefit ON public.tab_items;
DROP FUNCTION IF EXISTS public.apply_club_benefits();
DROP TRIGGER IF EXISTS trg_members_activity ON public.profiles;
DROP FUNCTION IF EXISTS public.log_member_activity();

DELETE FROM public.automation_triggers WHERE key = 'club_member_welcome';
DELETE FROM public.activity_feed
  WHERE type::text = 'member_joined' AND title ILIKE '%assinou o Clube%';
DELETE FROM public.audit_logs WHERE module = 'clube';
DELETE FROM public.staff_module_permissions WHERE module_key = 'clube';
DELETE FROM public.staff_action_permissions
  WHERE action_key = 'clube' OR action_key LIKE 'clube.%';

-- These tables are shared. Remove only the obsolete provider and keep each
-- table's previously allowed non-Hubla providers unchanged.
DELETE FROM public.integration_events WHERE provider = 'hubla';
DELETE FROM public.integration_settings WHERE provider = 'hubla';
ALTER TABLE public.integration_events
  DROP CONSTRAINT integration_events_provider_check,
  ADD CONSTRAINT integration_events_provider_check
    CHECK (provider IN ('mercadopago', 'whatsapp'));
ALTER TABLE public.integration_settings
  DROP CONSTRAINT integration_settings_provider_check,
  ADD CONSTRAINT integration_settings_provider_check
    CHECK (provider IN ('mercadopago', 'whatsapp', 'uazapi', 'wise'));

DELETE FROM public.finance_categories WHERE name = 'Clube';

-- All Club content tables are empty at baseline, except two obsolete PDV
-- benefits and one settings row. The separate Club mural is also empty and
-- must go because its RLS policies depend on profiles.is_club_member.
DROP TABLE public.club_lesson_comments;
DROP TABLE public.club_lesson_favorites;
DROP TABLE public.club_lesson_progress;
DROP TABLE public.club_lesson_files;
DROP TABLE public.club_certificates;
DROP TABLE public.club_lessons;
DROP TABLE public.club_modules;
DROP TABLE public.club_content;
DROP TABLE public.club_subscriptions;
DROP TABLE public.club_benefits;
DROP TABLE public.club_settings;
DROP TABLE public.community_posts;

-- Storage objects and buckets are removed through the Storage API after this
-- migration, never by deleting rows in storage.objects.
DROP POLICY IF EXISTS "Staff upload club videos" ON storage.objects;
DROP POLICY IF EXISTS "Staff manage club videos" ON storage.objects;
DROP POLICY IF EXISTS "Members read club videos" ON storage.objects;
ALTER TABLE public.profiles DROP COLUMN is_club_member;
