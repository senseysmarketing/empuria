
-- =========== ENUMS ===========
create type public.app_role as enum ('admin', 'staff', 'member');
create type public.service_category as enum ('esteira1', 'esteira2', 'clube');
create type public.lead_status as enum ('novo', 'contatado', 'qualificado', 'fechado', 'perdido');
create type public.appointment_status as enum ('pendente', 'confirmado', 'cancelado', 'concluido');

-- =========== UPDATED_AT HELPER ===========
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========== PROFILES ===========
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  phone text,
  country_origin text,
  is_club_member boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create trigger trg_profiles_updated
before update on public.profiles
for each row execute function public.update_updated_at_column();

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =========== USER ROLES ===========
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role in ('admin', 'staff')
  )
$$;

-- =========== SERVICES ===========
create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  category service_category not null,
  price_cents integer not null default 0,
  currency text not null default 'EUR',
  duration_minutes integer,
  requires_booking boolean not null default false,
  is_active boolean not null default true,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.services enable row level security;

create trigger trg_services_updated
before update on public.services
for each row execute function public.update_updated_at_column();

-- =========== LEADS (Consultoria Imigratória High Ticket) ===========
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text not null,
  current_country text,
  target_visa text,
  budget_range text,
  timeline text,
  message text,
  status lead_status not null default 'novo',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads enable row level security;

create trigger trg_leads_updated
before update on public.leads
for each row execute function public.update_updated_at_column();

create index idx_leads_status on public.leads(status);
create index idx_leads_user on public.leads(user_id);

-- =========== APPOINTMENTS ===========
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status appointment_status not null default 'pendente',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_appointment_time check (ends_at > starts_at)
);

alter table public.appointments enable row level security;

create trigger trg_appointments_updated
before update on public.appointments
for each row execute function public.update_updated_at_column();

create index idx_appointments_user on public.appointments(user_id);
create index idx_appointments_starts on public.appointments(starts_at);

-- Prevent overlapping appointments (exclude cancelled)
create extension if not exists btree_gist;

alter table public.appointments
add constraint no_overlap_appointments
exclude using gist (
  tstzrange(starts_at, ends_at) with &&
) where (status <> 'cancelado');

-- =========== RLS POLICIES ===========

-- profiles
create policy "Profiles viewable by owner and staff"
on public.profiles for select to authenticated
using (auth.uid() = id or public.is_staff(auth.uid()));

create policy "Users update own profile"
on public.profiles for update to authenticated
using (auth.uid() = id);

create policy "Staff update any profile"
on public.profiles for update to authenticated
using (public.is_staff(auth.uid()));

-- user_roles
create policy "Users view own roles"
on public.user_roles for select to authenticated
using (auth.uid() = user_id or public.is_staff(auth.uid()));

create policy "Admins manage roles"
on public.user_roles for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

-- services (public read of active)
create policy "Anyone can view active services"
on public.services for select to anon, authenticated
using (is_active = true or public.is_staff(auth.uid()));

create policy "Staff manage services"
on public.services for all to authenticated
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

-- leads (anyone can submit, only owner/staff can read)
create policy "Anyone can create lead"
on public.leads for insert to anon, authenticated
with check (true);

create policy "Owner or staff view leads"
on public.leads for select to authenticated
using (auth.uid() = user_id or public.is_staff(auth.uid()));

create policy "Staff manage leads"
on public.leads for update to authenticated
using (public.is_staff(auth.uid()));

create policy "Staff delete leads"
on public.leads for delete to authenticated
using (public.is_staff(auth.uid()));

-- appointments
create policy "Owner or staff view appointments"
on public.appointments for select to authenticated
using (auth.uid() = user_id or public.is_staff(auth.uid()));

create policy "Users create own appointments"
on public.appointments for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users update own pending appointments"
on public.appointments for update to authenticated
using (auth.uid() = user_id and status in ('pendente', 'confirmado'));

create policy "Staff manage all appointments"
on public.appointments for all to authenticated
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));
