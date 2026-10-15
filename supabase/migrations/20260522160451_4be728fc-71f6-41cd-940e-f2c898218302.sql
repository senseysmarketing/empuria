
-- ============== ENUMS ==============
create type public.order_payment_status as enum ('pendente', 'aprovado', 'recusado', 'estornado');
create type public.lead_pipeline_stage as enum ('novo', 'analise', 'qualificado', 'descartado');
create type public.activity_type as enum (
  'order_created', 'order_paid', 'lead_created', 'lead_qualified', 'lead_dismissed',
  'member_joined', 'appointment_created', 'arrival_registered', 'content_published', 'post_created'
);
create type public.automation_channel as enum ('whatsapp', 'email', 'painel');

-- ============== LEADS extra columns ==============
alter table public.leads
  add column if not exists pipeline_stage public.lead_pipeline_stage not null default 'novo',
  add column if not exists qualification_score integer,
  add column if not exists qualification_answers jsonb not null default '{}'::jsonb;

create index if not exists idx_leads_pipeline_stage on public.leads(pipeline_stage);

-- ============== ORDERS ==============
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  customer_email text,
  service_id uuid references public.services(id) on delete set null,
  service_title text not null,
  amount_cents integer not null default 0,
  currency text not null default 'EUR',
  payment_status public.order_payment_status not null default 'pendente',
  voucher_code text unique,
  assigned_staff_id uuid references auth.users(id) on delete set null,
  executed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_orders_created_at on public.orders(created_at desc);
create index idx_orders_payment_status on public.orders(payment_status);
create index idx_orders_user_id on public.orders(user_id);

alter table public.orders enable row level security;

create policy "Orders viewable by owner or staff" on public.orders
  for select to authenticated using (auth.uid() = user_id or public.is_staff(auth.uid()));
create policy "Staff manage orders" on public.orders
  for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "Users create own orders" on public.orders
  for insert to authenticated with check (auth.uid() = user_id or user_id is null);

create trigger trg_orders_updated before update on public.orders
  for each row execute function public.update_updated_at_column();

-- ============== ACTIVITY FEED ==============
create table public.activity_feed (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  type public.activity_type not null,
  title text not null,
  description text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_activity_feed_created_at on public.activity_feed(created_at desc);
create index idx_activity_feed_type on public.activity_feed(type);

alter table public.activity_feed enable row level security;

create policy "Staff view activity feed" on public.activity_feed
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "Staff insert activity feed" on public.activity_feed
  for insert to authenticated with check (public.is_staff(auth.uid()));

alter publication supabase_realtime add table public.activity_feed;
alter table public.activity_feed replica identity full;

-- ============== ARRIVALS ==============
create table public.arrivals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  visitor_name text not null,
  purpose text,
  arrived_at timestamptz not null default now(),
  registered_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_arrivals_arrived_at on public.arrivals(arrived_at desc);
alter table public.arrivals enable row level security;

create policy "Staff manage arrivals" on public.arrivals
  for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- ============== STAFF ASSIGNMENTS ==============
create table public.staff_assignments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  staff_id uuid not null references auth.users(id) on delete cascade,
  role text,
  created_at timestamptz not null default now(),
  unique (appointment_id, staff_id)
);

alter table public.staff_assignments enable row level security;
create policy "Staff manage assignments" on public.staff_assignments
  for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- ============== CLUB CONTENT ==============
create table public.club_content (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  module text not null default 'Geral',
  video_url text,
  thumbnail_url text,
  position integer not null default 0,
  is_published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_club_content_module on public.club_content(module, position);
alter table public.club_content enable row level security;

create policy "Members view published content" on public.club_content
  for select to authenticated using (
    is_published = true
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_club_member = true)
    or public.is_staff(auth.uid())
  );
create policy "Staff manage club content" on public.club_content
  for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create trigger trg_club_content_updated before update on public.club_content
  for each row execute function public.update_updated_at_column();

-- ============== COMMUNITY POSTS ==============
create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  body text not null,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_community_posts_pinned on public.community_posts(is_pinned desc, created_at desc);
alter table public.community_posts enable row level security;

create policy "Members view community posts" on public.community_posts
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_club_member = true)
    or public.is_staff(auth.uid())
  );
create policy "Members create posts" on public.community_posts
  for insert to authenticated with check (
    auth.uid() = author_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_club_member = true)
  );
create policy "Author or staff update posts" on public.community_posts
  for update to authenticated using (auth.uid() = author_id or public.is_staff(auth.uid()));
create policy "Author or staff delete posts" on public.community_posts
  for delete to authenticated using (auth.uid() = author_id or public.is_staff(auth.uid()));

-- ============== AUTOMATION TRIGGERS ==============
create table public.automation_triggers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  channel public.automation_channel not null default 'whatsapp',
  is_enabled boolean not null default false,
  template text not null default '',
  variables jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.automation_triggers enable row level security;
create policy "Staff manage automations" on public.automation_triggers
  for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create trigger trg_automation_triggers_updated before update on public.automation_triggers
  for each row execute function public.update_updated_at_column();

-- Seed default triggers
insert into public.automation_triggers (key, name, description, channel, template, variables) values
  ('vale_transporte_purchased', 'Vale Transporte comprado', 'Envia endereço do instituto + documentos necessários após compra do serviço.', 'whatsapp',
    'Olá {{nome}}! Recebemos sua compra do Vale Transporte. Compareça em Gran Vía 1, com {{documentos}}. Te esperamos!',
    '["nome","documentos"]'::jsonb),
  ('high_ticket_lead_received', 'Lead High-Ticket recebido', 'Notifica a equipe no painel quando um lead preenche o formulário de consultoria.', 'painel',
    'Novo lead qualificável: {{nome}} ({{orcamento}}) — prazo {{prazo}}.',
    '["nome","orcamento","prazo"]'::jsonb),
  ('order_paid_voucher', 'Pagamento aprovado', 'Envia o voucher digital com QR Code assim que o pagamento é aprovado.', 'email',
    'Pagamento aprovado! Seu voucher #{{voucher}} está disponível no portal.',
    '["voucher"]'::jsonb),
  ('club_member_welcome', 'Boas-vindas ao Clube', 'Mensagem de boas-vindas quando alguém assina o Clube do Imigrante.', 'whatsapp',
    'Bem-vindo(a) ao Clube do Imigrante, {{nome}}! Acesse o portal para liberar seu conteúdo exclusivo.',
    '["nome"]'::jsonb);

-- ============== ACTIVITY FEED TRIGGERS ==============
create or replace function public.log_order_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.activity_feed (actor_id, actor_name, type, title, description, payload)
    values (new.user_id, new.customer_name, 'order_created',
            new.customer_name || ' comprou ' || new.service_title,
            'Pedido criado · ' || (new.amount_cents/100.0) || ' ' || new.currency,
            jsonb_build_object('order_id', new.id, 'service', new.service_title));
  elsif (tg_op = 'UPDATE' and old.payment_status <> 'aprovado' and new.payment_status = 'aprovado') then
    insert into public.activity_feed (actor_id, actor_name, type, title, description, payload)
    values (new.user_id, new.customer_name, 'order_paid',
            'Pagamento aprovado: ' || new.service_title,
            new.customer_name || ' · ' || (new.amount_cents/100.0) || ' ' || new.currency,
            jsonb_build_object('order_id', new.id));
  end if;
  return new;
end;
$$;

create trigger trg_orders_activity
  after insert or update on public.orders
  for each row execute function public.log_order_activity();

create or replace function public.log_lead_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.activity_feed (actor_id, actor_name, type, title, description, payload)
    values (new.user_id, new.full_name, 'lead_created',
            new.full_name || ' preencheu o formulário',
            coalesce(new.target_visa, 'Lead novo') || ' · ' || coalesce(new.budget_range, 'sem orçamento'),
            jsonb_build_object('lead_id', new.id));
  elsif (tg_op = 'UPDATE' and old.pipeline_stage <> new.pipeline_stage) then
    if new.pipeline_stage = 'qualificado' then
      insert into public.activity_feed (actor_name, type, title, description, payload)
      values (new.full_name, 'lead_qualified', new.full_name || ' foi qualificado',
              'Lead pronto para agendar consultoria', jsonb_build_object('lead_id', new.id));
    elsif new.pipeline_stage = 'descartado' then
      insert into public.activity_feed (actor_name, type, title, description, payload)
      values (new.full_name, 'lead_dismissed', new.full_name || ' foi descartado',
              'Lead movido para Clube do Imigrante', jsonb_build_object('lead_id', new.id));
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_leads_activity
  after insert or update on public.leads
  for each row execute function public.log_lead_activity();

create or replace function public.log_member_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE' and old.is_club_member = false and new.is_club_member = true) then
    insert into public.activity_feed (actor_id, actor_name, type, title, description, payload)
    values (new.id, new.full_name, 'member_joined',
            coalesce(new.full_name,'Novo membro') || ' assinou o Clube',
            'Bem-vindo(a) à comunidade!', jsonb_build_object('user_id', new.id));
  end if;
  return new;
end;
$$;

create trigger trg_members_activity
  after update on public.profiles
  for each row execute function public.log_member_activity();

create or replace function public.log_arrival_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_feed (actor_id, actor_name, type, title, description, payload)
  values (new.user_id, new.visitor_name, 'arrival_registered',
          new.visitor_name || ' chegou ao instituto',
          coalesce(new.purpose, 'Visita registrada'),
          jsonb_build_object('arrival_id', new.id));
  return new;
end;
$$;

create trigger trg_arrivals_activity
  after insert on public.arrivals
  for each row execute function public.log_arrival_activity();

-- ============== APPOINTMENTS overlap protection ==============
-- Prevent overlapping appointments for the same service (room/resource)
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    service_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pendente', 'confirmado'));

-- ============== STORAGE BUCKET ==============
insert into storage.buckets (id, name, public) values ('club-videos', 'club-videos', false)
  on conflict (id) do nothing;

create policy "Staff upload club videos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'club-videos' and public.is_staff(auth.uid())
  );
create policy "Staff manage club videos" on storage.objects
  for all to authenticated using (
    bucket_id = 'club-videos' and public.is_staff(auth.uid())
  );
create policy "Members read club videos" on storage.objects
  for select to authenticated using (
    bucket_id = 'club-videos' and (
      public.is_staff(auth.uid())
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_club_member = true)
    )
  );
