
-- =========== club_lesson_favorites ===========
CREATE TABLE public.club_lesson_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.club_lessons(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, lesson_id)
);
GRANT SELECT, INSERT, DELETE ON public.club_lesson_favorites TO authenticated;
GRANT ALL ON public.club_lesson_favorites TO service_role;
ALTER TABLE public.club_lesson_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own favorites"
  ON public.club_lesson_favorites
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_club_favorites_user ON public.club_lesson_favorites(user_id);
CREATE INDEX idx_club_favorites_lesson ON public.club_lesson_favorites(lesson_id);

-- =========== club_lesson_comments ===========
CREATE TABLE public.club_lesson_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.club_lessons(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.club_lesson_comments(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  is_hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_lesson_comments TO authenticated;
GRANT ALL ON public.club_lesson_comments TO service_role;
ALTER TABLE public.club_lesson_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read visible comments"
  ON public.club_lesson_comments
  FOR SELECT
  TO authenticated
  USING (
    is_hidden = false
    OR auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.is_staff(auth.uid())
  );

CREATE POLICY "Members insert own comments"
  ON public.club_lesson_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authors or admins update comments"
  ON public.club_lesson_comments
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.is_staff(auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.is_staff(auth.uid())
  );

CREATE POLICY "Authors or admins delete comments"
  ON public.club_lesson_comments
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.is_staff(auth.uid())
  );

CREATE INDEX idx_club_comments_lesson ON public.club_lesson_comments(lesson_id, created_at DESC);
CREATE INDEX idx_club_comments_user ON public.club_lesson_comments(user_id);

CREATE TRIGGER trg_club_comments_updated
  BEFORE UPDATE ON public.club_lesson_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =========== club_certificates ===========
CREATE TABLE public.club_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('module', 'club')),
  module_id uuid REFERENCES public.club_modules(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'module' AND module_id IS NOT NULL) OR (scope = 'club' AND module_id IS NULL)),
  UNIQUE(user_id, scope, module_id)
);
GRANT SELECT, INSERT ON public.club_certificates TO authenticated;
GRANT SELECT ON public.club_certificates TO anon;
GRANT ALL ON public.club_certificates TO service_role;
ALTER TABLE public.club_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read certificates by code"
  ON public.club_certificates
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Users insert own certificates"
  ON public.club_certificates
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_club_certificates_user ON public.club_certificates(user_id, issued_at DESC);
CREATE INDEX idx_club_certificates_code ON public.club_certificates(code);
