begin;
create function public.get_ticket_email_recipient(p_ticket_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare event_id uuid; recipient text;
begin
  select t.event_id into event_id from public.tickets t where t.id=p_ticket_id;
  if (select auth.uid()) is null or event_id is null or not app_private.can_manage_event(event_id) then
    raise exception 'Event administrator required' using errcode='42501'; end if;
  select nullif(btrim(h.email),'') into recipient from public.tickets t
    left join public.ticket_holders h on h.id=t.holder_id where t.id=p_ticket_id;
  return recipient;
end; $$;
revoke all on function public.get_ticket_email_recipient(uuid) from public,anon;
grant execute on function public.get_ticket_email_recipient(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
