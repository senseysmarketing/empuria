ALTER TABLE public.club_content
  ADD COLUMN IF NOT EXISTS video_provider text,
  ADD COLUMN IF NOT EXISTS video_file_id text,
  ADD COLUMN IF NOT EXISTS video_embed_url text,
  ADD COLUMN IF NOT EXISTS video_source_url text;

ALTER TABLE public.club_lessons
  ADD COLUMN IF NOT EXISTS video_provider text,
  ADD COLUMN IF NOT EXISTS video_file_id text,
  ADD COLUMN IF NOT EXISTS video_embed_url text,
  ADD COLUMN IF NOT EXISTS video_source_url text;