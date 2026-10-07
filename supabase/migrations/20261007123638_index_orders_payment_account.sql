create index if not exists orders_payment_account_id_idx
  on public.orders (payment_account_id)
  where payment_account_id is not null;
