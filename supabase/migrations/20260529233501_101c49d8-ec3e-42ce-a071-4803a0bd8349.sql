
CREATE TABLE public.product_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  emoji text,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT ALL ON public.product_categories TO service_role;

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view active categories"
  ON public.product_categories FOR SELECT TO authenticated
  USING (is_active = true OR public.is_staff(auth.uid()));

CREATE POLICY "Staff manage categories"
  ON public.product_categories FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER update_product_categories_updated_at
  BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed from current enum values
INSERT INTO public.product_categories (slug, name, emoji, position) VALUES
  ('bebida', 'Bebida', '🍺', 0),
  ('comida', 'Comida', '🥐', 1),
  ('barbearia', 'Barbearia', '✂️', 2),
  ('outro', 'Outro', '📦', 3);

-- Add category_id to products
ALTER TABLE public.products ADD COLUMN category_id uuid REFERENCES public.product_categories(id) ON DELETE RESTRICT;

UPDATE public.products p
SET category_id = pc.id
FROM public.product_categories pc
WHERE pc.slug = p.category::text;

ALTER TABLE public.products ALTER COLUMN category_id SET NOT NULL;

CREATE INDEX idx_products_category_id ON public.products(category_id);
