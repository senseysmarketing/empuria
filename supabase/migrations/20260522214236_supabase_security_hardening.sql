-- Consolidate safe Supabase hardening after auth, passport QR and PDV review.

-- Restrict impersonation audit access to admins only.
drop policy if exists "Staff view impersonation logs" on public.impersonation_logs;
drop policy if exists "Staff insert impersonation logs" on public.impersonation_logs;
drop policy if exists "Admins view impersonation logs" on public.impersonation_logs;
drop policy if exists "Admins insert impersonation logs" on public.impersonation_logs;

create policy "Admins view impersonation logs"
  on public.impersonation_logs for select
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'));

create policy "Admins insert impersonation logs"
  on public.impersonation_logs for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin') and admin_id = (select auth.uid()));

-- Keep financial activity logs out of staff-facing feed descriptions.
do $$
begin
  if to_regclass('public.activity_feed') is not null then
    update public.activity_feed
      set description = 'Pedido atualizado'
      where type in ('order_created', 'order_paid');

    insert into public.activity_feed (type, title, description, payload)
    select
      'content_published',
      'Permissoes financeiras revisadas',
      'Staff permanece operacional, mas telas e funcoes administrativas nao retornam faturamento.',
      jsonb_build_object('scope', 'auth_roles_financial_access')
    where not exists (
      select 1
      from public.activity_feed
      where payload->>'scope' = 'auth_roles_financial_access'
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

-- Members should not be able to mutate their own financial/admin profile flags.
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, phone, country_origin) on public.profiles to authenticated;

-- Member app payments now go through a server function; remove direct row update.
drop policy if exists "Owner pay own tab" on public.tabs;

create index if not exists tabs_user_status_updated_idx
  on public.tabs (user_id, status, updated_at desc);

create index if not exists tab_items_tab_created_idx
  on public.tab_items (tab_id, created_at);

create index if not exists tab_items_product_idx on public.tab_items (product_id);

drop trigger if exists tab_items_apply_benefit on public.tab_items;

create or replace function public.apply_club_benefits()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid;
  v_is_member boolean;
  v_cat public.product_category;
  v_benefit record;
  v_already_used integer;
begin
  new.discount_cents := 0;
  new.benefit_label := null;

  select t.user_id into v_user
  from public.tabs t
  where t.id = new.tab_id and t.status = 'aberta';

  if v_user is null then
    raise exception 'Comanda fechada ou inexistente';
  end if;

  select coalesce(p.is_club_member, false)
    into v_is_member
  from public.profiles p
  where p.id = v_user;

  if not v_is_member then
    return new;
  end if;

  select category into v_cat
  from public.products
  where id = new.product_id and is_active = true;

  select * into v_benefit
  from public.club_benefits
  where is_active = true
    and (
      (scope = 'produto' and product_id = new.product_id)
      or (scope = 'categoria' and category = v_cat)
    )
  order by scope desc
  limit 1;

  if not found then
    return new;
  end if;

  if v_benefit.max_per_visit is not null then
    select count(*) into v_already_used
    from public.tab_items ti
    where ti.tab_id = new.tab_id
      and ti.benefit_label is not null
      and ti.id <> coalesce(new.id, gen_random_uuid())
      and (
        (v_benefit.scope = 'produto' and ti.product_id = v_benefit.product_id)
        or (
          v_benefit.scope = 'categoria'
          and exists (
            select 1
            from public.products p2
            where p2.id = ti.product_id and p2.category = v_benefit.category
          )
        )
      );

    if v_already_used >= v_benefit.max_per_visit then
      return new;
    end if;
  end if;

  if v_benefit.kind = 'cortesia' then
    new.discount_cents := new.unit_price_cents * new.qty;
    new.benefit_label := v_benefit.name;
  elsif v_benefit.kind = 'desconto_pct' then
    new.discount_cents := floor(new.unit_price_cents * new.qty * v_benefit.value / 100.0)::integer;
    new.benefit_label := v_benefit.name;
  elsif v_benefit.kind = 'desconto_fixo' then
    new.discount_cents := least(v_benefit.value::integer, new.unit_price_cents * new.qty);
    new.benefit_label := v_benefit.name;
  end if;

  return new;
end;
$$;

create trigger tab_items_apply_benefit
before insert or update of product_id, qty, unit_price_cents on public.tab_items
for each row execute function public.apply_club_benefits();

-- Trigger/helper functions should not be directly callable through RPC.
revoke execute on function public.apply_club_benefits() from anon, authenticated;
revoke execute on function public.recalculate_tab_total() from anon, authenticated;
revoke execute on function public.log_arrival_activity() from anon, authenticated;
revoke execute on function public.log_lead_activity() from anon, authenticated;
revoke execute on function public.log_lead_pipeline_activity() from anon, authenticated;
revoke execute on function public.log_member_activity() from anon, authenticated;
revoke execute on function public.log_order_activity() from anon, authenticated;
revoke execute on function public.on_order_approved() from anon, authenticated;
revoke execute on function public.on_order_approved_after() from anon, authenticated;
revoke execute on function public.recalc_tier_sold() from anon, authenticated;
revoke execute on function public.email_exists(text) from anon, authenticated;
grant execute on function public.email_exists(text) to service_role;

-- Add missing indexes used by relationships and RLS paths.
create index if not exists activity_feed_actor_idx on public.activity_feed (actor_id);
create index if not exists arrivals_lead_idx on public.arrivals (lead_id);
create index if not exists arrivals_registered_by_idx on public.arrivals (registered_by);
create index if not exists arrivals_user_idx on public.arrivals (user_id);
create index if not exists club_benefits_product_idx on public.club_benefits (product_id);
create index if not exists club_content_created_by_idx on public.club_content (created_by);
create index if not exists community_posts_author_idx on public.community_posts (author_id);
create index if not exists event_tickets_tier_idx on public.event_tickets (tier_id);
create index if not exists event_tickets_order_idx on public.event_tickets (order_id);
create index if not exists event_tickets_checked_in_by_idx on public.event_tickets (checked_in_by);
create index if not exists orders_assigned_staff_idx on public.orders (assigned_staff_id);
create index if not exists orders_service_idx on public.orders (service_id);
create index if not exists orders_slot_idx on public.orders (slot_id);
create index if not exists orders_host_profile_idx on public.orders (host_profile_id);
create index if not exists staff_assignments_staff_idx on public.staff_assignments (staff_id);
create index if not exists tab_items_added_by_idx on public.tab_items (added_by);
create index if not exists tabs_opened_by_idx on public.tabs (opened_by);
create index if not exists tabs_order_idx on public.tabs (order_id);

-- Add missing foreign keys where the current schema already stores UUID relationships.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tabs_user_id_fkey') then
    alter table public.tabs
      add constraint tabs_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tabs_opened_by_fkey') then
    alter table public.tabs
      add constraint tabs_opened_by_fkey foreign key (opened_by) references auth.users(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tabs_order_id_fkey') then
    alter table public.tabs
      add constraint tabs_order_id_fkey foreign key (order_id) references public.orders(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tab_items_added_by_fkey') then
    alter table public.tab_items
      add constraint tab_items_added_by_fkey foreign key (added_by) references auth.users(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'event_tickets_user_id_fkey') then
    alter table public.event_tickets
      add constraint event_tickets_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'event_tickets_order_id_fkey') then
    alter table public.event_tickets
      add constraint event_tickets_order_id_fkey foreign key (order_id) references public.orders(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'event_tickets_checked_in_by_fkey') then
    alter table public.event_tickets
      add constraint event_tickets_checked_in_by_fkey foreign key (checked_in_by) references auth.users(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_slot_id_fkey') then
    alter table public.orders
      add constraint orders_slot_id_fkey foreign key (slot_id) references public.availability_slots(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_host_profile_id_fkey') then
    alter table public.orders
      add constraint orders_host_profile_id_fkey foreign key (host_profile_id) references public.profiles(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'impersonation_logs_admin_id_fkey') then
    alter table public.impersonation_logs
      add constraint impersonation_logs_admin_id_fkey foreign key (admin_id) references auth.users(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'impersonation_logs_target_user_id_fkey') then
    alter table public.impersonation_logs
      add constraint impersonation_logs_target_user_id_fkey foreign key (target_user_id) references auth.users(id);
  end if;
end $$;

-- Public buckets do not need a broad SELECT policy for public object URLs.
drop policy if exists "Anyone view event covers" on storage.objects;

-- Keep extensions out of the exposed public schema when possible.
create schema if not exists extensions;
do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'btree_gist' and n.nspname = 'public'
  ) then
    alter extension btree_gist set schema extensions;
  end if;
end $$;
