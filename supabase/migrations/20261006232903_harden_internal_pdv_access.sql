-- Block 3: keep PDV mutations behind the server-side service role.
-- Application staff/admin authorization remains in the TanStack server functions.

REVOKE EXECUTE ON FUNCTION public.pdv_open_tab(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pdv_add_tab_item(uuid, uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pdv_update_tab_item_qty(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pdv_cancel_tab_item(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pdv_close_tab(uuid, uuid, text, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pdv_request_wise_payment(uuid, uuid, text, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pdv_cancel_wise_attempt(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pdv_confirm_wise_payment(text, integer, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pdv_next_tab_code(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wise_next_reference()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pdv_activity_log_trigger()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pdv_open_tab(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_add_tab_item(uuid, uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_update_tab_item_qty(uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_cancel_tab_item(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_close_tab(uuid, uuid, text, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_request_wise_payment(uuid, uuid, text, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_cancel_wise_attempt(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_confirm_wise_payment(text, integer, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_next_tab_code(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.wise_next_reference() TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_activity_log_trigger() TO service_role;

-- This counter is an internal implementation detail of pdv_next_tab_code().
ALTER TABLE public.pdv_tab_code_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.pdv_tab_code_counters
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pdv_tab_code_counters
  TO service_role;
