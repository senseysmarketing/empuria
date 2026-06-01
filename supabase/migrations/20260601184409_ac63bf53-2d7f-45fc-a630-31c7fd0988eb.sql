-- Enums
DO $$ BEGIN
  CREATE TYPE public.calendar_task_status AS ENUM ('pendente','em_andamento','concluida','cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.calendar_task_priority AS ENUM ('baixa','media','alta','urgente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table
CREATE TABLE IF NOT EXISTS public.calendar_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status public.calendar_task_status NOT NULL DEFAULT 'pendente',
  priority public.calendar_task_priority NOT NULL DEFAULT 'media',
  due_at timestamptz,
  completed_at timestamptz,
  assignee_id uuid,
  created_by uuid,
  lead_id uuid,
  appointment_id uuid,
  event_id uuid,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_tasks TO authenticated;
GRANT ALL ON public.calendar_tasks TO service_role;

-- RLS
ALTER TABLE public.calendar_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage calendar tasks"
  ON public.calendar_tasks
  FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- Trigger updated_at
CREATE TRIGGER update_calendar_tasks_updated_at
  BEFORE UPDATE ON public.calendar_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calendar_tasks_due_at ON public.calendar_tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_calendar_tasks_status ON public.calendar_tasks(status);
CREATE INDEX IF NOT EXISTS idx_calendar_tasks_assignee ON public.calendar_tasks(assignee_id);