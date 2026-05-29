
-- Module permissions table
CREATE TABLE public.staff_module_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  is_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, module_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_module_permissions TO authenticated;
GRANT ALL ON public.staff_module_permissions TO service_role;

ALTER TABLE public.staff_module_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own module permissions"
  ON public.staff_module_permissions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage module permissions"
  ON public.staff_module_permissions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_staff_module_permissions_updated
  BEFORE UPDATE ON public.staff_module_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit logs table
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  module text NOT NULL,
  entity_type text,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_module ON public.audit_logs (module);

-- Module access helper
CREATE OR REPLACE FUNCTION public.has_module_access(_user_id uuid, _module text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.staff_module_permissions
      WHERE user_id = _user_id AND module_key = _module AND is_allowed = true
    )
$$;

-- Seed: grant existing staff full access to all current modules to preserve behavior
INSERT INTO public.staff_module_permissions (user_id, module_key, is_allowed)
SELECT ur.user_id, m.module_key, true
FROM public.user_roles ur
CROSS JOIN (VALUES
  ('cockpit'), ('pdv'), ('eventos'), ('esteira'), ('triagem'),
  ('agenda'), ('usuarios'), ('clube'), ('slots'),
  ('configuracoes'), ('pdv_itens'), ('automacoes'), ('logs')
) AS m(module_key)
WHERE ur.role = 'staff'
ON CONFLICT (user_id, module_key) DO NOTHING;
