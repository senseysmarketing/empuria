
-- Lock down SECURITY DEFINER functions (used internally by triggers/policies only)
revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.is_staff(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.update_updated_at_column() from public, anon, authenticated;

-- Tighten leads insert policy
drop policy if exists "Anyone can create lead" on public.leads;

create policy "Anon can submit lead without user link"
on public.leads for insert to anon
with check (user_id is null);

create policy "Authenticated submit own lead"
on public.leads for insert to authenticated
with check (user_id is null or user_id = auth.uid());
