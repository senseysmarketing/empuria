-- Stabilize impersonation audit access and financial activity logs.

drop policy if exists "Staff view impersonation logs" on public.impersonation_logs;
drop policy if exists "Staff insert impersonation logs" on public.impersonation_logs;

create policy "Admins view impersonation logs"
  on public.impersonation_logs for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins insert impersonation logs"
  on public.impersonation_logs for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin') and admin_id = auth.uid());

do $$
begin
  if to_regclass('public.activity_feed') is not null then
    update public.activity_feed
      set description = 'Pedido atualizado'
      where type in ('order_created', 'order_paid');

    insert into public.activity_feed (type, title, description, payload)
    values (
      'content_published',
      'Permissões financeiras revisadas',
      'Staff permanece operacional, mas telas e funções administrativas não retornam faturamento.',
      jsonb_build_object('scope', 'auth_roles_financial_access')
    );
  end if;
end $$;

create or replace function public.log_order_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.activity_feed (actor_id, actor_name, type, title, description, payload)
    values (
      new.user_id,
      new.customer_name,
      'order_created',
      new.customer_name || ' comprou ' || new.service_title,
      'Pedido criado',
      jsonb_build_object('order_id', new.id, 'service', new.service_title)
    );
  elsif (tg_op = 'UPDATE' and old.payment_status <> 'aprovado' and new.payment_status = 'aprovado') then
    insert into public.activity_feed (actor_id, actor_name, type, title, description, payload)
    values (
      new.user_id,
      new.customer_name,
      'order_paid',
      'Pagamento aprovado: ' || new.service_title,
      'Pedido atualizado',
      jsonb_build_object('order_id', new.id)
    );
  end if;
  return new;
end;
$$;
