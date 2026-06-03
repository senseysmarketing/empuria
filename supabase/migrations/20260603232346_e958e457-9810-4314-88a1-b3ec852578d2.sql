
-- ========== TABLES ==========

CREATE TABLE public.club_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  cover_url text,
  position integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_modules TO authenticated;
GRANT ALL ON public.club_modules TO service_role;
ALTER TABLE public.club_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read published modules" ON public.club_modules
  FOR SELECT TO authenticated
  USING (is_published OR public.has_module_access(auth.uid(), 'clube'));

CREATE POLICY "Clube staff manage modules" ON public.club_modules
  FOR ALL TO authenticated
  USING (public.has_module_access(auth.uid(), 'clube'))
  WITH CHECK (public.has_module_access(auth.uid(), 'clube'));

CREATE TRIGGER update_club_modules_updated_at
  BEFORE UPDATE ON public.club_modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.club_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES public.club_modules(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text,
  description text,
  video_url text,
  video_provider text,
  thumbnail_url text,
  duration_minutes integer,
  position integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  is_featured boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  legacy_content_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX club_lessons_module_idx ON public.club_lessons (module_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_lessons TO authenticated;
GRANT ALL ON public.club_lessons TO service_role;
ALTER TABLE public.club_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read published lessons" ON public.club_lessons
  FOR SELECT TO authenticated
  USING (is_published OR public.has_module_access(auth.uid(), 'clube'));

CREATE POLICY "Clube staff manage lessons" ON public.club_lessons
  FOR ALL TO authenticated
  USING (public.has_module_access(auth.uid(), 'clube'))
  WITH CHECK (public.has_module_access(auth.uid(), 'clube'));

CREATE TRIGGER update_club_lessons_updated_at
  BEFORE UPDATE ON public.club_lessons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.club_lesson_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.club_lessons(id) ON DELETE CASCADE,
  label text NOT NULL,
  file_url text NOT NULL,
  file_type text NOT NULL DEFAULT 'other',
  size_bytes bigint,
  position integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX club_lesson_files_lesson_idx ON public.club_lesson_files (lesson_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_lesson_files TO authenticated;
GRANT ALL ON public.club_lesson_files TO service_role;
ALTER TABLE public.club_lesson_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read lesson files" ON public.club_lesson_files
  FOR SELECT TO authenticated
  USING (
    public.has_module_access(auth.uid(), 'clube')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_club_member = true
    )
  );

CREATE POLICY "Clube staff manage lesson files" ON public.club_lesson_files
  FOR ALL TO authenticated
  USING (public.has_module_access(auth.uid(), 'clube'))
  WITH CHECK (public.has_module_access(auth.uid(), 'clube'));

CREATE TRIGGER update_club_lesson_files_updated_at
  BEFORE UPDATE ON public.club_lesson_files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.club_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_title text NOT NULL DEFAULT 'Clube do Imigrante',
  public_description text NOT NULL DEFAULT 'Conteúdo exclusivo: mentalidade, passos iniciais e cultura espanhola.',
  cover_url text,
  locked_screen_text text NOT NULL DEFAULT 'Assine o Clube pela Hubla usando o mesmo e-mail cadastrado no Instituto Empuria.',
  cta_text text NOT NULL DEFAULT 'Assinar Clube',
  benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.club_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.club_settings TO authenticated;
GRANT ALL ON public.club_settings TO service_role;
ALTER TABLE public.club_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read settings" ON public.club_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Clube staff manage settings" ON public.club_settings
  FOR ALL TO authenticated
  USING (public.has_module_access(auth.uid(), 'clube'))
  WITH CHECK (public.has_module_access(auth.uid(), 'clube'));

CREATE TRIGGER update_club_settings_updated_at
  BEFORE UPDATE ON public.club_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.club_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;


-- ========== DATA MIGRATION from club_content ==========

-- Create modules from distinct club_content.module values
INSERT INTO public.club_modules (title, slug, position, is_published)
SELECT DISTINCT
  module AS title,
  regexp_replace(lower(module), '[^a-z0-9]+', '-', 'g') AS slug,
  0,
  true
FROM public.club_content
WHERE module IS NOT NULL AND module <> ''
ON CONFLICT (slug) DO NOTHING;

-- Create lessons from club_content rows
INSERT INTO public.club_lessons (
  module_id, title, description, video_url, thumbnail_url,
  position, is_published, legacy_content_id, created_by, created_at
)
SELECT
  m.id,
  c.title,
  c.description,
  c.video_url,
  c.thumbnail_url,
  COALESCE(c.position, 0),
  COALESCE(c.is_published, false),
  c.id,
  c.created_by,
  c.created_at
FROM public.club_content c
JOIN public.club_modules m
  ON m.slug = regexp_replace(lower(c.module), '[^a-z0-9]+', '-', 'g')
WHERE NOT EXISTS (
  SELECT 1 FROM public.club_lessons l WHERE l.legacy_content_id = c.id
);
