begin;
-- Only the owner-facing wrapper (or the database administrator) can call this.
create function app_private.delete_test_event_data(p_event_id uuid,p_expected_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; holders uuid[]; summary jsonb;
begin
  select * into e from public.events where id=p_event_id for update;
  if not found then return jsonb_build_object('deleted',false); end if;
  if p_expected_name is distinct from e.name then raise exception 'Event name does not match' using errcode='22023'; end if;
  -- Prevent pending jobs from being claimed during deletion. A worker already
  -- sending must finish before an owner can remove this event.
  perform id from public.ticket_email_jobs where event_id=e.id order by id for update;
  if exists(select 1 from public.ticket_email_jobs where event_id=e.id and status='processing') then
    raise exception 'An email is currently processing' using errcode='55000'; end if;
  select array_agg(distinct holder_id) into holders from public.tickets where event_id=e.id and holder_id is not null;
  summary:=jsonb_build_object('deleted',true,'event_id',e.id,'event_name',e.name,
    'tickets',(select count(*) from public.tickets where event_id=e.id),
    'orders',(select count(*) from public.orders where event_id=e.id),
    'readings',(select count(*) from public.checkins where event_id=e.id),
    'financial_lines',(select count(*) from public.order_items where event_id=e.id),
    'email_jobs',(select count(*) from public.ticket_email_jobs where event_id=e.id));
  delete from public.ticket_email_jobs where event_id=e.id;
  delete from app_private.redemption_requests where event_id=e.id;
  delete from app_private.ticket_action_requests r using public.tickets t where r.ticket_id=t.id and t.event_id=e.id;
  delete from app_private.issuance_requests r using public.tickets t where r.ticket_id=t.id and t.event_id=e.id;
  delete from app_private.native_import_rows where event_id=e.id;
  delete from app_private.native_import_requests where event_id=e.id;
  delete from public.order_items where event_id=e.id;
  delete from public.checkins where event_id=e.id;
  delete from public.ticket_credentials c using public.tickets t where c.ticket_id=t.id and t.event_id=e.id;
  delete from public.tickets where event_id=e.id;
  delete from public.orders where event_id=e.id;
  delete from public.import_batches where event_id=e.id;
  delete from public.scanners where event_id=e.id;
  delete from public.ticket_types where event_id=e.id;
  delete from public.event_members where event_id=e.id;
  -- Retain audit history with its original event identifier in metadata.
  update public.audit_logs set event_id=null,
    metadata=metadata||jsonb_build_object('deleted_event_id',e.id,'deleted_event_name',e.name)
    where event_id=e.id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(e.organization_id,(select auth.uid()),'event.test_deleted','event',e.id,summary);
  delete from public.events where id=e.id;
  delete from public.ticket_holders h where h.id=any(holders)
    and not exists(select 1 from public.tickets t where t.holder_id=h.id);
  return summary;
end; $$;
revoke all on function app_private.delete_test_event_data(uuid,text) from public,anon,authenticated;

create function public.delete_test_event(p_event_id uuid,p_event_name text,p_confirm_test_data boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not exists(
    select 1 from public.events e join public.organization_members m on m.organization_id=e.organization_id
    where e.id=p_event_id and m.user_id=(select auth.uid()) and m.role='owner'
  ) then raise exception 'Organization owner required' using errcode='42501'; end if;
  if p_confirm_test_data is distinct from true then raise exception 'Test data confirmation required' using errcode='22023'; end if;
  return app_private.delete_test_event_data(p_event_id,p_event_name);
end; $$;
revoke all on function public.delete_test_event(uuid,text,boolean) from public,anon;
grant execute on function public.delete_test_event(uuid,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
