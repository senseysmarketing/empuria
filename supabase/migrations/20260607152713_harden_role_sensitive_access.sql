-- Harden role-sensitive Supabase access paths.
-- The application now checks staff/module/action permissions server-side before
-- calling privileged RPCs with the service role client.

-- Keep payment-link tokens out of the browser/API surface. These links are
-- resolved by trusted server functions with the service role key.
ALTER TABLE public.order_payment_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct client access to order payment links"
  ON public.order_payment_links;
CREATE POLICY "No direct client access to order payment links"
  ON public.order_payment_links
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_order_payment_links_created_by
  ON public.order_payment_links (created_by);

-- Privileged operational RPCs must not be callable through /rest/v1/rpc by
-- anonymous or signed-in users. Server functions call these with service_role.
REVOKE EXECUTE ON FUNCTION public.pdv_next_sale_code(timestamp with time zone)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pdv_close_sale(uuid, uuid, jsonb, text, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pdv_void_sale(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.finance_category_id(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finance_account_id_for_payment(text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finance_sync_pdv_sale(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finance_sync_order(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finance_sync_pdv_sale_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finance_sync_order_trigger()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pdv_next_sale_code(timestamp with time zone)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_close_sale(uuid, uuid, jsonb, text, numeric, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_void_sale(uuid, uuid, text)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.finance_category_id(text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_account_id_for_payment(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_pdv_sale(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_order(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_pdv_sale_trigger()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_sync_order_trigger()
  TO service_role;

-- Anonymous users should not be able to inspect role helpers. Authenticated
-- execution is preserved because many existing RLS policies call these helpers.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_module_access(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_action(uuid, text) FROM anon;
