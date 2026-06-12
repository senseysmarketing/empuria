CREATE TABLE public.client_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_label text,
  scope text NOT NULL,
  message text NOT NULL,
  stack text,
  url text,
  user_agent text,
  app_version text,
  extra jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.client_error_logs TO service_role;

ALTER TABLE public.client_error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read client error logs"
  ON public.client_error_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX client_error_logs_created_at_idx ON public.client_error_logs (created_at DESC);
CREATE INDEX client_error_logs_user_id_idx ON public.client_error_logs (user_id);
CREATE INDEX client_error_logs_scope_idx ON public.client_error_logs (scope);