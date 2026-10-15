
-- Service kind enum
DO $$ BEGIN
  CREATE TYPE service_kind AS ENUM ('airport','tour','consulting','banking','meeting');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Order delivery status enum
DO $$ BEGIN
  CREATE TYPE order_delivery_status AS ENUM ('aguardando_pagamento','aguardando_documentos','processando','agendado','concluido');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Services additions
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS kind service_kind,
  ADD COLUMN IF NOT EXISTS requires_slot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_documents boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS document_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS meeting_address text;

-- Orders additions
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS slot_id uuid,
  ADD COLUMN IF NOT EXISTS service_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_status order_delivery_status NOT NULL DEFAULT 'aguardando_pagamento',
  ADD COLUMN IF NOT EXISTS host_profile_id uuid;

-- availability_slots
CREATE TABLE IF NOT EXISTS public.availability_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity int NOT NULL DEFAULT 1,
  booked int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (booked >= 0 AND booked <= capacity)
);
CREATE INDEX IF NOT EXISTS idx_slots_service_time ON public.availability_slots(service_id, starts_at);

ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone view active slots" ON public.availability_slots;
CREATE POLICY "Anyone view active slots" ON public.availability_slots
  FOR SELECT TO anon, authenticated
  USING (is_active = true OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage slots" ON public.availability_slots;
CREATE POLICY "Staff manage slots" ON public.availability_slots
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER update_slots_updated_at BEFORE UPDATE ON public.availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- order_documents
CREATE TABLE IF NOT EXISTS public.order_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  label text NOT NULL,
  checked boolean NOT NULL DEFAULT false,
  position int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_docs_order ON public.order_documents(order_id);

ALTER TABLE public.order_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner or staff view docs" ON public.order_documents;
CREATE POLICY "Owner or staff view docs" ON public.order_documents
  FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owner or staff update docs" ON public.order_documents;
CREATE POLICY "Owner or staff update docs" ON public.order_documents
  FOR UPDATE TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Staff insert/delete docs" ON public.order_documents;
CREATE POLICY "Staff insert docs" ON public.order_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Staff delete docs" ON public.order_documents
  FOR DELETE TO authenticated
  USING (public.is_staff(auth.uid()));

-- Seed services
INSERT INTO public.services (slug, title, short_description, description, category, kind, price_cents, requires_booking, requires_slot, requires_documents, document_checklist, meeting_address, is_active)
VALUES
  ('recepcao-aeroporto','Recepção no Aeroporto','Anfitrião dedicado para receber você no aeroporto de Madrid.','Um anfitrião do Instituto Empuria espera por você no desembarque, ajuda com a bagagem e te leva até sua acomodação ou ao Instituto.','esteira1','airport',12000,false,false,false,'[]'::jsonb,NULL,true),
  ('tour-economico','Tour Turístico Econômico','Tour guiado pelos pontos essenciais de Madrid.','Roteiro de meio período cobrindo Gran Vía, Sol e Plaza Mayor com guia bilíngue.','esteira1','tour',4500,true,true,false,'[]'::jsonb,'Gran Vía, 32 — Madrid',true),
  ('tour-raiz','Tour Turístico Raiz','Experiência completa pela alma de Madrid com guia anfitrião.','Tour estendido de dia inteiro incluindo bairros históricos, gastronomia local e cultura espanhola.','esteira1','tour',9800,true,true,false,'[]'::jsonb,'Gran Vía, 32 — Madrid',true),
  ('vale-transporte','Consultoria de Vale Transporte (Abono)','Acompanhamento completo para emissão do seu Abono Transportes.','Nosso time te orienta na documentação e te acompanha até a emissão do cartão Abono Transportes de Madrid.','esteira1','consulting',6500,false,false,true,
    '["Passaporte original","1 foto carnet recente","Comprovante de endereço em Madrid","Formulário preenchido (enviado por nós)"]'::jsonb,
    NULL,true),
  ('conta-bancaria','Consultoria de Abertura de Conta Bancária','Suporte completo na abertura da sua conta bancária física em Madrid.','Tratativa direta com agência parceira em Madrid, preparação de documentação e acompanhamento até a abertura.','esteira1','banking',14500,false,false,true,
    '["Passaporte","NIE (se já tiver)","Comprovante de endereço brasileiro","Comprovante de endereço em Madrid","Comprovante de renda ou matrícula"]'::jsonb,
    'Definido na confirmação',true),
  ('reuniao-presencial','Reunião Presencial Estratégica','Bate-papo estratégico de 60 minutos no Instituto Empuria.','Sessão presencial com um consultor sênior na sede do Instituto, na Gran Vía, para alinhar seu plano de imigração.','esteira1','meeting',18000,true,true,false,'[]'::jsonb,'Gran Vía, 32 — Madrid',true)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  short_description = EXCLUDED.short_description,
  description = EXCLUDED.description,
  kind = EXCLUDED.kind,
  price_cents = EXCLUDED.price_cents,
  requires_slot = EXCLUDED.requires_slot,
  requires_documents = EXCLUDED.requires_documents,
  document_checklist = EXCLUDED.document_checklist,
  meeting_address = EXCLUDED.meeting_address,
  updated_at = now();

-- Trigger: on order approval, auto-create document checklist + voucher + delivery_status
CREATE OR REPLACE FUNCTION public.on_order_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  svc public.services%ROWTYPE;
  item text;
  i int := 0;
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.payment_status <> 'aprovado' AND NEW.payment_status = 'aprovado') THEN
    IF NEW.voucher_code IS NULL THEN
      NEW.voucher_code := 'EMP-' || upper(substr(replace(NEW.id::text,'-',''),1,8));
    END IF;
    SELECT * INTO svc FROM public.services WHERE id = NEW.service_id;
    IF FOUND THEN
      IF svc.kind = 'consulting' OR svc.kind = 'banking' THEN
        NEW.delivery_status := 'aguardando_documentos';
      ELSIF svc.kind = 'tour' OR svc.kind = 'meeting' OR svc.kind = 'airport' THEN
        NEW.delivery_status := 'agendado';
      ELSE
        NEW.delivery_status := 'processando';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_order_approved ON public.orders;
CREATE TRIGGER trg_on_order_approved
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.on_order_approved();

-- After approval: insert default document checklist rows
CREATE OR REPLACE FUNCTION public.on_order_approved_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  svc public.services%ROWTYPE;
  item text;
  i int := 0;
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.payment_status <> 'aprovado' AND NEW.payment_status = 'aprovado') THEN
    SELECT * INTO svc FROM public.services WHERE id = NEW.service_id;
    IF FOUND AND svc.requires_documents THEN
      FOR item IN SELECT jsonb_array_elements_text(svc.document_checklist)
      LOOP
        INSERT INTO public.order_documents (order_id, label, position) VALUES (NEW.id, item, i);
        i := i + 1;
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_order_approved_after ON public.orders;
CREATE TRIGGER trg_on_order_approved_after
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.on_order_approved_after();
