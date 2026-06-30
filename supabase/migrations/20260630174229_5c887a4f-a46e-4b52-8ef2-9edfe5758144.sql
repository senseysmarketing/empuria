
ALTER TABLE public.pdv_sales ADD COLUMN IF NOT EXISTS customer_snapshot_source text;
ALTER TABLE public.pdv_tabs  ADD COLUMN IF NOT EXISTS customer_snapshot_source text;

-- 1) Backfill a partir do pdv_activity_logs (fonte mais confiavel)
UPDATE public.pdv_sales s
SET customer_name_snapshot   = COALESCE(NULLIF(pal.customer_name, ''), s.customer_name_snapshot),
    customer_snapshot_source = 'activity_log'
FROM public.pdv_activity_logs pal
WHERE pal.sale_id = s.id
  AND pal.action = 'db.sale.insert'
  AND pal.customer_name IS NOT NULL
  AND pal.customer_name <> '';

UPDATE public.pdv_tabs t
SET customer_name_snapshot   = COALESCE(NULLIF(pal.customer_name, ''), t.customer_name_snapshot),
    customer_snapshot_source = 'activity_log'
FROM public.pdv_activity_logs pal
WHERE pal.tab_id = t.id
  AND pal.action = 'db.tab.insert'
  AND pal.customer_name IS NOT NULL
  AND pal.customer_name <> '';

-- 2) Backfill via audit_logs (manual_user.created / reused) para vendas anteriores ao logging
WITH ranked AS (
  SELECT DISTINCT ON (s.id)
    s.id AS sale_id,
    al.new_data->>'full_name' AS name,
    al.new_data->>'phone'     AS phone
  FROM public.pdv_sales s
  JOIN public.audit_logs al
    ON al.entity_id = s.customer_id
   AND al.entity_type = 'profile'
   AND al.action IN ('manual_user.created','manual_user.reused')
   AND al.created_at <= s.closed_at
  WHERE s.customer_snapshot_source IS NULL
  ORDER BY s.id, al.created_at DESC
)
UPDATE public.pdv_sales s
SET customer_name_snapshot   = COALESCE(NULLIF(r.name,  ''), s.customer_name_snapshot),
    customer_phone_snapshot  = COALESCE(NULLIF(r.phone, ''), s.customer_phone_snapshot),
    customer_snapshot_source = 'audit_log'
FROM ranked r
WHERE s.id = r.sale_id;

WITH ranked AS (
  SELECT DISTINCT ON (t.id)
    t.id AS tab_id,
    al.new_data->>'full_name' AS name,
    al.new_data->>'phone'     AS phone
  FROM public.pdv_tabs t
  JOIN public.audit_logs al
    ON al.entity_id = t.customer_id
   AND al.entity_type = 'profile'
   AND al.action IN ('manual_user.created','manual_user.reused')
   AND al.created_at <= COALESCE(t.opened_at, t.created_at)
  WHERE t.customer_snapshot_source IS NULL
  ORDER BY t.id, al.created_at DESC
)
UPDATE public.pdv_tabs t
SET customer_name_snapshot   = COALESCE(NULLIF(r.name,  ''), t.customer_name_snapshot),
    customer_phone_snapshot  = COALESCE(NULLIF(r.phone, ''), t.customer_phone_snapshot),
    customer_snapshot_source = 'audit_log'
FROM ranked r
WHERE t.id = r.tab_id;

-- 3) Marca o restante (sem fonte historica) como fallback do perfil atual
UPDATE public.pdv_sales SET customer_snapshot_source = 'profile_fallback' WHERE customer_snapshot_source IS NULL;
UPDATE public.pdv_tabs  SET customer_snapshot_source = 'profile_fallback' WHERE customer_snapshot_source IS NULL;
