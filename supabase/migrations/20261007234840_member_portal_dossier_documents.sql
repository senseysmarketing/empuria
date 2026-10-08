-- Bloco B: acompanhamento do membro e documentos pessoais privados.
ALTER TABLE public.profiles
  ADD COLUMN member_status text NOT NULL DEFAULT 'novo',
  ADD COLUMN member_next_step text,
  ADD COLUMN member_status_updated_at timestamptz,
  ADD COLUMN member_status_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT profiles_member_status_check CHECK (member_status IN (
    'novo', 'em_atendimento', 'aguardando_documentos', 'em_andamento',
    'aguardando_cliente', 'concluido', 'inativo'
  ));

CREATE INDEX profiles_member_status_idx ON public.profiles (member_status);

CREATE TABLE public.member_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  category text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'received', 'approved', 'needs_replacement'
  )),
  visible_to_member boolean NOT NULL DEFAULT true,
  storage_path text UNIQUE,
  file_name text,
  mime_type text,
  file_size_bytes bigint CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  member_message text,
  admin_notes text,
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_documents_received_file_check CHECK (
    status NOT IN ('received', 'approved') OR storage_path IS NOT NULL
  )
);

CREATE INDEX member_documents_user_updated_idx
  ON public.member_documents (user_id, updated_at DESC);
CREATE INDEX member_documents_user_status_idx
  ON public.member_documents (user_id, status);
CREATE INDEX member_documents_order_idx
  ON public.member_documents (order_id) WHERE order_id IS NOT NULL;

CREATE TRIGGER member_documents_updated
  BEFORE UPDATE ON public.member_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.member_documents ENABLE ROW LEVEL SECURITY;
-- Service role is the only write/read API used by the canonical server functions.
-- This policy is defense in depth if a deliberate direct SELECT grant is added later.
CREATE POLICY member_documents_owner_visible_select ON public.member_documents
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND visible_to_member);
REVOKE ALL ON public.member_documents FROM PUBLIC, anon, authenticated;

-- Keep existing profile ownership policies, but do not allow a member to read
-- internal notes or mutate operational/security fields through the Data API.
REVOKE SELECT, UPDATE ON public.profiles FROM authenticated;
GRANT SELECT (
  id, full_name, avatar_url, phone, country_origin, created_at, updated_at,
  is_blocked, created_by_admin, password_setup_required,
  first_access_completed_at, created_by_staff_id, profile_origin,
  phone_country_iso, member_status, member_next_step, member_status_updated_at
) ON public.profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url, phone, country_origin, phone_country_iso)
  ON public.profiles TO authenticated;

-- Storage itself enforces the same MIME/size limits even if the client lies.
-- There are intentionally no browser storage.objects policies for this bucket:
-- the server validates ownership then issues signed upload/download tokens.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'member-documents', 'member-documents', false, 20971520,
  ARRAY[
    'application/pdf', 'image/jpeg', 'image/png', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
);
