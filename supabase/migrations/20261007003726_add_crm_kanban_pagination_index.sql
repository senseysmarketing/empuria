CREATE INDEX IF NOT EXISTS idx_leads_crm_column_created_id
ON public.leads (crm_column_id, created_at DESC, id DESC);
