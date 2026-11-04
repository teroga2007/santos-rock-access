begin;
create function public.delete_ticket_type(p_event_id uuid,p_type_id uuid,p_type_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; t public.ticket_types%rowtype;
begin
  if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then
    raise exception 'Event administrator required' using errcode='42501'; end if;
  -- Same event/type lock order as pricing and issuance; no new ticket can
  -- appear between checking usage and deleting the type.
  select * into e from public.events where id=p_event_id for update;
  if not found or e.status in ('closed','cancelled') then raise exception 'Event is closed' using errcode='23514'; end if;
  select * into t from public.ticket_types where id=p_type_id and event_id=p_event_id for update;
  if not found then return p_type_id; end if;
  if p_type_name is distinct from t.name then raise exception 'Type name changed' using errcode='22023'; end if;
  if exists(select 1 from public.tickets where type_id=t.id)
    or exists(select 1 from app_private.native_import_requests where type_id=t.id)
    or exists(select 1 from app_private.native_import_rows where type_id=t.id) then
    raise exception 'Ticket type has history' using errcode='23503'; end if;
  delete from public.ticket_types where id=t.id;
  insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id,metadata)
    values(e.organization_id,e.id,(select auth.uid()),'ticket_type.deleted','ticket_type',t.id,jsonb_build_object('name',t.name,'price_crc',t.price_crc,'transport_price_crc',t.transport_price_crc));
  return t.id;
end; $$;
revoke all on function public.delete_ticket_type(uuid,uuid,text) from public,anon;
grant execute on function public.delete_ticket_type(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
