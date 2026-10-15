
-- Enums
CREATE TYPE public.event_sales_mode AS ENUM ('simples', 'categorias');
CREATE TYPE public.event_ticket_status AS ENUM ('valido', 'usado', 'cancelado');

-- Events
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location_address text,
  location_lat double precision,
  location_lng double precision,
  cover_url text,
  cover_kind text NOT NULL DEFAULT 'image', -- 'image' | 'video'
  sales_mode public.event_sales_mode NOT NULL DEFAULT 'simples',
  is_published boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone view published events" ON public.events
  FOR SELECT TO anon, authenticated USING (is_published = true OR public.is_staff(auth.uid()));
CREATE POLICY "Staff manage events" ON public.events
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER events_updated BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tiers
CREATE TABLE public.event_ticket_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  capacity integer, -- nullable = unlimited
  sold integer NOT NULL DEFAULT 0,
  benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_tiers_event_idx ON public.event_ticket_tiers(event_id);
ALTER TABLE public.event_ticket_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone view tiers of published events" ON public.event_ticket_tiers
  FOR SELECT TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND (e.is_published = true OR public.is_staff(auth.uid())))
  );
CREATE POLICY "Staff manage tiers" ON public.event_ticket_tiers
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER event_tiers_updated BEFORE UPDATE ON public.event_ticket_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tickets
CREATE TABLE public.event_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tier_id uuid NOT NULL REFERENCES public.event_ticket_tiers(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  order_id uuid,
  code text NOT NULL UNIQUE,
  status public.event_ticket_status NOT NULL DEFAULT 'valido',
  checked_in_at timestamptz,
  checked_in_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_tickets_user_event_idx ON public.event_tickets(user_id, event_id);
CREATE INDEX event_tickets_event_idx ON public.event_tickets(event_id);
ALTER TABLE public.event_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner or staff view tickets" ON public.event_tickets
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "Staff manage tickets" ON public.event_tickets
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER event_tickets_updated BEFORE UPDATE ON public.event_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Inventory trigger
CREATE OR REPLACE FUNCTION public.recalc_tier_sold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier_id uuid;
  v_cap integer;
  v_sold integer;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    v_tier_id := NEW.tier_id;
  ELSIF (TG_OP = 'DELETE') THEN
    v_tier_id := OLD.tier_id;
  ELSE
    v_tier_id := NEW.tier_id;
  END IF;

  SELECT COUNT(*) INTO v_sold FROM public.event_tickets
    WHERE tier_id = v_tier_id AND status <> 'cancelado';

  UPDATE public.event_ticket_tiers SET sold = v_sold, updated_at = now() WHERE id = v_tier_id;

  -- enforce capacity on insert
  IF (TG_OP = 'INSERT') THEN
    SELECT capacity INTO v_cap FROM public.event_ticket_tiers WHERE id = v_tier_id;
    IF v_cap IS NOT NULL AND v_sold > v_cap THEN
      RAISE EXCEPTION 'Categoria esgotada';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER event_tickets_recalc
AFTER INSERT OR UPDATE OF status OR DELETE ON public.event_tickets
FOR EACH ROW EXECUTE FUNCTION public.recalc_tier_sold();

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('event-covers', 'event-covers', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone view event covers" ON storage.objects FOR SELECT
  USING (bucket_id = 'event-covers');
CREATE POLICY "Staff upload event covers" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'event-covers' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff update event covers" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'event-covers' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff delete event covers" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'event-covers' AND public.is_staff(auth.uid()));

-- Seed demo event
DO $$
DECLARE v_event_id uuid;
BEGIN
  INSERT INTO public.events (slug, title, description, starts_at, ends_at, location_address, sales_mode, is_published, cover_url)
  VALUES (
    'sunset-gran-via',
    'Sunset de Imigração na Gran Vía',
    E'Uma noite premium para quem está construindo nova vida em Madrid. Drinks de boas-vindas, networking com membros do Clube Empuria, e DJ set ao pôr do sol no rooftop da Gran Vía.\n\nCronograma:\n• 19h — Welcome drink\n• 20h — Painel "Caminhos legais para Espanha"\n• 21h — DJ set + open bar Premium/VIP',
    (now() + interval '7 days')::timestamptz,
    (now() + interval '7 days' + interval '5 hours')::timestamptz,
    'Gran Vía 32, 28013 Madrid, Espanha',
    'categorias',
    true,
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1600&q=80'
  ) RETURNING id INTO v_event_id;

  INSERT INTO public.event_ticket_tiers (event_id, name, price_cents, capacity, benefits, position) VALUES
    (v_event_id, 'Standard', 1500, 80, '["Entrada","Welcome drink"]'::jsonb, 0),
    (v_event_id, 'Premium', 3000, 40, '["Entrada","Welcome drink","Open bar de cerveja e vinho","Acesso ao painel"]'::jsonb, 1),
    (v_event_id, 'VIP', 4500, 20, '["Entrada","Open bar Premium","Mesa reservada","Kit Empuria","Acesso à área VIP"]'::jsonb, 2);
END $$;
