
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_notes text;

CREATE TABLE IF NOT EXISTS public.impersonation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.impersonation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view impersonation logs"
  ON public.impersonation_logs FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff insert impersonation logs"
  ON public.impersonation_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) AND admin_id = auth.uid());

CREATE INDEX IF NOT EXISTS impersonation_logs_admin_idx ON public.impersonation_logs(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS impersonation_logs_target_idx ON public.impersonation_logs(target_user_id, created_at DESC);
