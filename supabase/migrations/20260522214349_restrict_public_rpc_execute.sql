-- Remove broad PUBLIC execute grants from internal trigger/helper functions.

revoke execute on function public.apply_club_benefits() from public;
revoke execute on function public.recalculate_tab_total() from public;
revoke execute on function public.log_arrival_activity() from public;
revoke execute on function public.log_lead_activity() from public;
revoke execute on function public.log_lead_pipeline_activity() from public;
revoke execute on function public.log_member_activity() from public;
revoke execute on function public.log_order_activity() from public;
revoke execute on function public.on_order_approved() from public;
revoke execute on function public.on_order_approved_after() from public;
revoke execute on function public.recalc_tier_sold() from public;
revoke execute on function public.email_exists(text) from public;

grant execute on function public.email_exists(text) to service_role;
