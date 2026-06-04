CREATE TABLE public.order_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid','expired','revoked')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  access_count integer NOT NULL DEFAULT 0
);

CREATE INDEX order_payment_links_order_id_idx ON public.order_payment_links(order_id);
CREATE INDEX order_payment_links_status_idx ON public.order_payment_links(status);

GRANT ALL ON public.order_payment_links TO service_role;

ALTER TABLE public.order_payment_links ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy para anon/authenticated: acesso é apenas via server functions com supabaseAdmin.
-- Service role bypassa RLS por padrão.

CREATE TRIGGER set_order_payment_links_updated_at
  BEFORE UPDATE ON public.order_payment_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();