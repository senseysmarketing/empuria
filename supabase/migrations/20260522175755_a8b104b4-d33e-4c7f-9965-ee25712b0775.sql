
-- Enums
CREATE TYPE public.product_category AS ENUM ('bebida', 'comida', 'barbearia', 'outro');
CREATE TYPE public.tab_status AS ENUM ('aberta', 'paga', 'cancelada');
CREATE TYPE public.benefit_scope AS ENUM ('produto', 'categoria');
CREATE TYPE public.benefit_kind AS ENUM ('desconto_pct', 'desconto_fixo', 'cortesia');

-- Products
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  category public.product_category NOT NULL DEFAULT 'outro',
  price_cents integer NOT NULL DEFAULT 0,
  emoji text,
  is_active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated view active products" ON public.products
  FOR SELECT TO authenticated USING (is_active = true OR public.is_staff(auth.uid()));
CREATE POLICY "Staff manage products" ON public.products
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER products_updated BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabs
CREATE TABLE public.tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  opened_by uuid,
  status public.tab_status NOT NULL DEFAULT 'aberta',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  total_cents integer NOT NULL DEFAULT 0,
  paid_cents integer NOT NULL DEFAULT 0,
  payment_method text,
  order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tabs_one_open_per_user ON public.tabs (user_id) WHERE status = 'aberta';
ALTER TABLE public.tabs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner or staff view tabs" ON public.tabs
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "Staff manage tabs" ON public.tabs
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Owner pay own tab" ON public.tabs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER tabs_updated BEFORE UPDATE ON public.tabs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tab items
CREATE TABLE public.tab_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id uuid NOT NULL REFERENCES public.tabs(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id),
  product_name_snapshot text NOT NULL,
  product_emoji text,
  qty integer NOT NULL DEFAULT 1,
  unit_price_cents integer NOT NULL DEFAULT 0,
  discount_cents integer NOT NULL DEFAULT 0,
  benefit_label text,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tab_items_tab_idx ON public.tab_items(tab_id);
ALTER TABLE public.tab_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner or staff view tab items" ON public.tab_items
  FOR SELECT TO authenticated USING (
    public.is_staff(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.tabs t WHERE t.id = tab_items.tab_id AND t.user_id = auth.uid()
    )
  );
CREATE POLICY "Staff manage tab items" ON public.tab_items
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Club benefits
CREATE TABLE public.club_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  scope public.benefit_scope NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  category public.product_category,
  kind public.benefit_kind NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  max_per_visit integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.club_benefits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated view active benefits" ON public.club_benefits
  FOR SELECT TO authenticated USING (is_active = true OR public.is_staff(auth.uid()));
CREATE POLICY "Staff manage benefits" ON public.club_benefits
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Recalculate total trigger
CREATE OR REPLACE FUNCTION public.recalculate_tab_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tab_id uuid;
  v_total integer;
BEGIN
  v_tab_id := COALESCE(NEW.tab_id, OLD.tab_id);
  SELECT COALESCE(SUM(qty * unit_price_cents - discount_cents), 0)
    INTO v_total FROM public.tab_items WHERE tab_id = v_tab_id;
  UPDATE public.tabs SET total_cents = v_total, updated_at = now() WHERE id = v_tab_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER tab_items_recalc
AFTER INSERT OR UPDATE OR DELETE ON public.tab_items
FOR EACH ROW EXECUTE FUNCTION public.recalculate_tab_total();

-- Apply club benefit on insert
CREATE OR REPLACE FUNCTION public.apply_club_benefits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_is_member boolean;
  v_cat public.product_category;
  v_benefit RECORD;
  v_already_used integer;
  v_discount integer := 0;
  v_label text := NULL;
BEGIN
  SELECT t.user_id INTO v_user FROM public.tabs t WHERE t.id = NEW.tab_id;
  SELECT COALESCE(p.is_club_member, false) INTO v_is_member FROM public.profiles p WHERE p.id = v_user;
  IF NOT v_is_member THEN RETURN NEW; END IF;
  SELECT category INTO v_cat FROM public.products WHERE id = NEW.product_id;
  SELECT * INTO v_benefit FROM public.club_benefits
    WHERE is_active = true
      AND ((scope = 'produto' AND product_id = NEW.product_id)
        OR (scope = 'categoria' AND category = v_cat))
    ORDER BY scope DESC -- produto wins over categoria
    LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_benefit.max_per_visit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_already_used FROM public.tab_items ti
      WHERE ti.tab_id = NEW.tab_id AND ti.benefit_label IS NOT NULL
        AND ti.id <> NEW.id
        AND ((v_benefit.scope = 'produto' AND ti.product_id = v_benefit.product_id)
          OR (v_benefit.scope = 'categoria' AND EXISTS (
            SELECT 1 FROM public.products p2 WHERE p2.id = ti.product_id AND p2.category = v_benefit.category
          )));
    IF v_already_used >= v_benefit.max_per_visit THEN RETURN NEW; END IF;
  END IF;

  IF v_benefit.kind = 'cortesia' THEN
    v_discount := NEW.unit_price_cents * NEW.qty;
    v_label := '🎁 ' || v_benefit.name;
  ELSIF v_benefit.kind = 'desconto_pct' THEN
    v_discount := FLOOR(NEW.unit_price_cents * NEW.qty * v_benefit.value / 100.0);
    v_label := '🎁 ' || v_benefit.name;
  ELSIF v_benefit.kind = 'desconto_fixo' THEN
    v_discount := LEAST(v_benefit.value::integer, NEW.unit_price_cents * NEW.qty);
    v_label := '🎁 ' || v_benefit.name;
  END IF;

  UPDATE public.tab_items
    SET discount_cents = v_discount, benefit_label = v_label
    WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tab_items_apply_benefit
AFTER INSERT ON public.tab_items
FOR EACH ROW EXECUTE FUNCTION public.apply_club_benefits();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tabs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tab_items;
ALTER TABLE public.tabs REPLICA IDENTITY FULL;
ALTER TABLE public.tab_items REPLICA IDENTITY FULL;

-- Seed products
INSERT INTO public.products (slug, name, category, price_cents, emoji, position) VALUES
  ('estrella', 'Estrella Galicia', 'bebida', 200, '🍺', 1),
  ('vino-tinto', 'Vino Tinto', 'bebida', 400, '🍷', 2),
  ('refrigerante', 'Refrigerante', 'bebida', 200, '🥤', 3),
  ('cafe-cortado', 'Café Cortado', 'bebida', 150, '☕', 4),
  ('croissant', 'Croissant', 'comida', 300, '🥐', 5),
  ('corte', 'Corte de Cabelo', 'barbearia', 1500, '✂️', 6),
  ('barba', 'Barba', 'barbearia', 1000, '🧔', 7),
  ('combo-corte-barba', 'Combo Corte + Barba', 'barbearia', 2200, '💈', 8),
  ('toalha-quente', 'Toalha Quente', 'outro', 0, '🚿', 9)
ON CONFLICT (slug) DO NOTHING;

-- Seed benefits
INSERT INTO public.club_benefits (name, scope, category, kind, value)
VALUES ('Clube · 20% off Barbearia', 'categoria', 'barbearia', 'desconto_pct', 20);

INSERT INTO public.club_benefits (name, scope, product_id, kind, value, max_per_visit)
SELECT '1ª Estrella Cortesia', 'produto', id, 'cortesia', 0, 1 FROM public.products WHERE slug = 'estrella';
