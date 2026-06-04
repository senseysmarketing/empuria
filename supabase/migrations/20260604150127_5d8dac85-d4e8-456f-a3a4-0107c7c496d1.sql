CREATE TABLE public.club_lesson_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.club_lessons(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_lesson_progress TO authenticated;
GRANT ALL ON public.club_lesson_progress TO service_role;

ALTER TABLE public.club_lesson_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own progress read"   ON public.club_lesson_progress FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own progress insert" ON public.club_lesson_progress FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own progress update" ON public.club_lesson_progress FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX club_lesson_progress_user_opened_idx
  ON public.club_lesson_progress (user_id, opened_at DESC);

CREATE TRIGGER club_lesson_progress_updated_at
  BEFORE UPDATE ON public.club_lesson_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.club_lessons
  ADD COLUMN IF NOT EXISTS is_coming_soon boolean NOT NULL DEFAULT false;