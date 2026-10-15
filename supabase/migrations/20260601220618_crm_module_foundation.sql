-- CRM foundation for /admin/crm.
-- Keeps the existing leads table as the source of truth and adds owner assignment,
-- configurable columns, WhatsApp-ready inbox and follow-up tracking.

DO $$ BEGIN
  CREATE TYPE public.crm_column_type AS ENUM ('system', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_distribution_mode AS ENUM ('fixed', 'round_robin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_inbox_status AS ENUM ('received', 'suggested', 'linked', 'ignored');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_message_direction AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_followup_status AS ENUM ('pending', 'done', 'skipped', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE public.lead_activity_kind ADD VALUE IF NOT EXISTS 'owner_changed';
ALTER TYPE public.lead_activity_kind ADD VALUE IF NOT EXISTS 'followup_created';
ALTER TYPE public.lead_activity_kind ADD VALUE IF NOT EXISTS 'followup_done';
ALTER TYPE public.lead_activity_kind ADD VALUE IF NOT EXISTS 'inbox_message_linked';

CREATE TABLE IF NOT EXISTS public.crm_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  type public.crm_column_type NOT NULL DEFAULT 'custom',
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_locked boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_columns_key_format CHECK (key ~ '^[a-z0-9_]+$')
);

CREATE TABLE IF NOT EXISTS public.crm_distribution_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode public.crm_distribution_mode NOT NULL DEFAULT 'fixed',
  fixed_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_assigned_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_distribution_one_active
  ON public.crm_distribution_settings (is_active)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.crm_distribution_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS public.crm_inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'uazapi',
  provider_message_id text,
  provider_chat_id text,
  from_phone text NOT NULL,
  from_name text,
  message_type text NOT NULL DEFAULT 'text',
  body text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  matched_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  status public.crm_inbox_status NOT NULL DEFAULT 'received',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_message_id)
);

CREATE TABLE IF NOT EXISTS public.crm_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'uazapi',
  provider_chat_id text,
  phone text NOT NULL,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_chat_id),
  UNIQUE (lead_id, provider, phone)
);

CREATE TABLE IF NOT EXISTS public.crm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.crm_conversations(id) ON DELETE SET NULL,
  direction public.crm_message_direction NOT NULL,
  provider text NOT NULL DEFAULT 'uazapi',
  provider_message_id text,
  body text,
  message_type text NOT NULL DEFAULT 'text',
  status text,
  sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  type text NOT NULL DEFAULT 'whatsapp',
  due_at timestamptz NOT NULL,
  status public.crm_followup_status NOT NULL DEFAULT 'pending',
  template_key text,
  message_preview text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.crm_columns (key, label, type, position, is_locked)
VALUES
  ('novo', 'Novos leads', 'system', 10, true),
  ('em_contato', 'Em contato', 'system', 20, true),
  ('reuniao', 'Reuniao agendada', 'system', 30, true),
  ('fechado', 'Fechado', 'system', 900, true),
  ('descartado', 'Desqualificado', 'system', 910, true)
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    type = EXCLUDED.type,
    position = EXCLUDED.position,
    is_locked = EXCLUDED.is_locked,
    is_active = true,
    updated_at = now();

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS crm_column_id uuid REFERENCES public.crm_columns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'site',
  ADD COLUMN IF NOT EXISTS source_detail text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS first_message text,
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_followup_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads (assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_crm_column_id ON public.leads (crm_column_id);
CREATE INDEX IF NOT EXISTS idx_leads_next_followup_at ON public.leads (next_followup_at);
CREATE INDEX IF NOT EXISTS idx_leads_last_interaction_at ON public.leads (last_interaction_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_columns_position ON public.crm_columns (position) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_crm_distribution_members_position ON public.crm_distribution_members (position) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_crm_inbox_messages_status_created ON public.crm_inbox_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_followups_assignee_status_due ON public.crm_followups (assigned_to, status, due_at);
CREATE INDEX IF NOT EXISTS idx_crm_followups_lead ON public.crm_followups (lead_id, due_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_lead_created ON public.crm_messages (lead_id, created_at DESC);

UPDATE public.leads l
SET crm_column_id = c.id
FROM public.crm_columns c
WHERE l.crm_column_id IS NULL
  AND c.key = CASE l.pipeline_stage::text
    WHEN 'analise' THEN 'em_contato'
    WHEN 'qualificado' THEN 'fechado'
    ELSE l.pipeline_stage::text
  END;

UPDATE public.leads
SET first_message = COALESCE(first_message, message),
    last_interaction_at = COALESCE(last_interaction_at, updated_at, created_at)
WHERE first_message IS NULL
   OR last_interaction_at IS NULL;

DO $$
DECLARE
  fallback_user uuid;
BEGIN
  SELECT ur.user_id
  INTO fallback_user
  FROM public.user_roles ur
  WHERE ur.role IN ('admin', 'staff')
  ORDER BY CASE WHEN ur.role = 'admin' THEN 0 ELSE 1 END, ur.created_at
  LIMIT 1;

  IF fallback_user IS NOT NULL THEN
    INSERT INTO public.crm_distribution_settings (mode, fixed_user_id, is_active)
    VALUES ('fixed', fallback_user, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.crm_distribution_members (user_id, position, is_active)
    VALUES (fallback_user, 0, true)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.leads
    SET assigned_to = fallback_user
    WHERE assigned_to IS NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.crm_apply_lead_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  active_rule public.crm_distribution_settings%ROWTYPE;
  next_user uuid;
  last_position integer;
BEGIN
  IF NEW.crm_column_id IS NULL THEN
    SELECT c.id
    INTO NEW.crm_column_id
    FROM public.crm_columns c
    WHERE c.is_active = true
      AND c.key = CASE COALESCE(NEW.pipeline_stage::text, 'novo')
        WHEN 'analise' THEN 'em_contato'
        WHEN 'qualificado' THEN 'fechado'
        ELSE COALESCE(NEW.pipeline_stage::text, 'novo')
      END
    LIMIT 1;
  END IF;

  NEW.first_message = COALESCE(NEW.first_message, NEW.message);
  NEW.last_interaction_at = COALESCE(NEW.last_interaction_at, NEW.updated_at, NEW.created_at, now());

  IF NEW.assigned_to IS NULL THEN
    SELECT *
    INTO active_rule
    FROM public.crm_distribution_settings
    WHERE is_active = true
    ORDER BY created_at DESC
    LIMIT 1;

    IF active_rule.id IS NULL THEN
      RAISE EXCEPTION 'Nao foi possivel criar o lead porque nao ha uma regra de distribuicao ativa. Configure um responsavel padrao ou um rodizio de usuarios no CRM.';
    END IF;

    IF active_rule.mode = 'fixed' THEN
      next_user := active_rule.fixed_user_id;
    ELSE
      SELECT m.position
      INTO last_position
      FROM public.crm_distribution_members m
      WHERE m.user_id = active_rule.last_assigned_user_id
        AND m.is_active = true;

      SELECT m.user_id
      INTO next_user
      FROM public.crm_distribution_members m
      WHERE m.is_active = true
        AND (last_position IS NULL OR m.position > last_position)
      ORDER BY m.position, m.created_at
      LIMIT 1;

      IF next_user IS NULL THEN
        SELECT m.user_id
        INTO next_user
        FROM public.crm_distribution_members m
        WHERE m.is_active = true
        ORDER BY m.position, m.created_at
        LIMIT 1;
      END IF;
    END IF;

    IF next_user IS NULL THEN
      RAISE EXCEPTION 'Nao foi possivel criar o lead porque nao ha uma regra de distribuicao ativa. Configure um responsavel padrao ou um rodizio de usuarios no CRM.';
    END IF;

    IF NOT public.is_staff(next_user) THEN
      RAISE EXCEPTION 'O responsavel configurado para distribuicao de leads nao possui permissao de equipe.';
    END IF;

    NEW.assigned_to := next_user;

    UPDATE public.crm_distribution_settings
    SET last_assigned_user_id = next_user,
        updated_at = now()
    WHERE id = active_rule.id;
  ELSIF NOT public.is_staff(NEW.assigned_to) THEN
    RAISE EXCEPTION 'O lead precisa ter um responsavel admin ou staff.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_apply_lead_defaults ON public.leads;
CREATE TRIGGER trg_crm_apply_lead_defaults
BEFORE INSERT OR UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.crm_apply_lead_defaults();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.leads WHERE assigned_to IS NULL) THEN
    RAISE NOTICE 'Nao foi possivel aplicar NOT NULL em leads.assigned_to porque existem leads sem responsavel e sem fallback staff/admin.';
  ELSE
    ALTER TABLE public.leads ALTER COLUMN assigned_to SET NOT NULL;
  END IF;
END $$;

ALTER TABLE public.crm_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_distribution_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_distribution_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_inbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_followups ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_columns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_distribution_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_distribution_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_inbox_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_followups TO authenticated;
GRANT ALL ON public.crm_columns TO service_role;
GRANT ALL ON public.crm_distribution_settings TO service_role;
GRANT ALL ON public.crm_distribution_members TO service_role;
GRANT ALL ON public.crm_inbox_messages TO service_role;
GRANT ALL ON public.crm_conversations TO service_role;
GRANT ALL ON public.crm_messages TO service_role;
GRANT ALL ON public.crm_followups TO service_role;

DROP POLICY IF EXISTS "Staff view CRM columns" ON public.crm_columns;
CREATE POLICY "Staff view CRM columns"
  ON public.crm_columns FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Admins manage CRM columns" ON public.crm_columns;
CREATE POLICY "Admins manage CRM columns"
  ON public.crm_columns FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Staff view CRM distribution settings" ON public.crm_distribution_settings;
CREATE POLICY "Staff view CRM distribution settings"
  ON public.crm_distribution_settings FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Admins manage CRM distribution settings" ON public.crm_distribution_settings;
CREATE POLICY "Admins manage CRM distribution settings"
  ON public.crm_distribution_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Staff view CRM distribution members" ON public.crm_distribution_members;
CREATE POLICY "Staff view CRM distribution members"
  ON public.crm_distribution_members FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Admins manage CRM distribution members" ON public.crm_distribution_members;
CREATE POLICY "Admins manage CRM distribution members"
  ON public.crm_distribution_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Staff manage CRM inbox" ON public.crm_inbox_messages;
CREATE POLICY "Staff manage CRM inbox"
  ON public.crm_inbox_messages FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage CRM conversations" ON public.crm_conversations;
CREATE POLICY "Staff manage CRM conversations"
  ON public.crm_conversations FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage CRM messages" ON public.crm_messages;
CREATE POLICY "Staff manage CRM messages"
  ON public.crm_messages FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage CRM followups" ON public.crm_followups;
CREATE POLICY "Staff manage CRM followups"
  ON public.crm_followups FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP TRIGGER IF EXISTS trg_crm_columns_updated ON public.crm_columns;
CREATE TRIGGER trg_crm_columns_updated
BEFORE UPDATE ON public.crm_columns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_crm_distribution_settings_updated ON public.crm_distribution_settings;
CREATE TRIGGER trg_crm_distribution_settings_updated
BEFORE UPDATE ON public.crm_distribution_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_crm_distribution_members_updated ON public.crm_distribution_members;
CREATE TRIGGER trg_crm_distribution_members_updated
BEFORE UPDATE ON public.crm_distribution_members
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_crm_conversations_updated ON public.crm_conversations;
CREATE TRIGGER trg_crm_conversations_updated
BEFORE UPDATE ON public.crm_conversations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_crm_followups_updated ON public.crm_followups;
CREATE TRIGGER trg_crm_followups_updated
BEFORE UPDATE ON public.crm_followups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE EXECUTE ON FUNCTION public.crm_apply_lead_defaults() FROM PUBLIC, anon, authenticated;

INSERT INTO public.staff_module_permissions (user_id, module_key, is_allowed)
SELECT ur.user_id, 'crm', true
FROM public.user_roles ur
WHERE ur.role IN ('admin', 'staff')
ON CONFLICT (user_id, module_key) DO NOTHING;
