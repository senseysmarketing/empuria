-- Refresh PostgREST schema cache after creating Financeiro & Caixa tables.
NOTIFY pgrst, 'reload schema';
