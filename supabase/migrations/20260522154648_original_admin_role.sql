
insert into public.user_roles (user_id, role)
values ('37110d33-3ba0-42b4-8a1f-cab7d1a4d30e', 'admin')
on conflict (user_id, role) do nothing;

update public.profiles
set full_name = coalesce(full_name, 'Admin')
where id = '37110d33-3ba0-42b4-8a1f-cab7d1a4d30e';
