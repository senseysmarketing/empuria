-- Harden passport-driven PDV flow and prevent direct client-side tab mutation.

drop policy if exists "Owner pay own tab" on public.tabs;

create index if not exists tabs_user_status_updated_idx
  on public.tabs (user_id, status, updated_at desc);

create index if not exists tab_items_tab_created_idx
  on public.tab_items (tab_id, created_at);

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
