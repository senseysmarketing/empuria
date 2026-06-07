-- Remove anonymous/public API execution for permission helpers while preserving
-- authenticated execution required by the existing RLS policies.

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_module_access(uuid, text)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_action(uuid, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_module_access(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_action(uuid, text)
  TO authenticated, service_role;
