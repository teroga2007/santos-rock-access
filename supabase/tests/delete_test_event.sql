begin;
do $$ declare k text; begin
  foreach k in array array['owner','supervisor','admin','org','event','keep'] loop
    perform set_config('sra_delete.'||k,gen_random_uuid()::text,true);
  end loop;
  foreach k in array array['owner','supervisor','admin'] loop
    insert into auth.users(id,email,invited_at,aud,role) values(current_setting('sra_delete.'||k)::uuid,k||'-'||current_setting('sra_delete.'||k)||'@example.invalid',now(),'authenticated','authenticated');
  end loop;
  insert into public.organizations(id,name,slug) values(current_setting('sra_delete.org')::uuid,'Deletion fixture','deletion-'||current_setting('sra_delete.org'));
  insert into public.organization_members(organization_id,user_id,role) values
    (current_setting('sra_delete.org')::uuid,current_setting('sra_delete.owner')::uuid,'owner'),
    (current_setting('sra_delete.org')::uuid,current_setting('sra_delete.supervisor')::uuid,'member'),
    (current_setting('sra_delete.org')::uuid,current_setting('sra_delete.admin')::uuid,'admin');
  insert into public.events(id,organization_id,name,starts_at) values
    (current_setting('sra_delete.event')::uuid,current_setting('sra_delete.org')::uuid,'Delete fixture',now()),
    (current_setting('sra_delete.keep')::uuid,current_setting('sra_delete.org')::uuid,'Keep fixture',now());
  insert into public.event_members(event_id,user_id,role) values(current_setting('sra_delete.event')::uuid,current_setting('sra_delete.supervisor')::uuid,'supervisor');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_delete.owner'),true);
do $$ declare e uuid:=current_setting('sra_delete.event')::uuid; t uuid; r jsonb; keep_ticket uuid; k text; begin
  t:=public.save_ticket_type_prices(e,'Bundle',10000,7500);
  r:=public.import_priced_native_tickets(e,t,'sinpe',gen_random_uuid(),jsonb_build_array(
    jsonb_build_object('name','Shared holder','email','one@example.invalid','reference','DEL-1','token','sra1_'||repeat('a',43)),
    jsonb_build_object('name','Orphan holder','email','two@example.invalid','reference','DEL-2','token','sra1_'||repeat('b',43))),10000,7500);
  perform set_config('sra_delete.ticket1',r->0->>'ticket_id',true);
  perform set_config('sra_delete.ticket2',r->1->>'ticket_id',true);
  perform public.manage_ticket_credential((r->1->>'ticket_id')::uuid,'reissue',gen_random_uuid(),'Fixture reissue','sra1_'||repeat('c',43));
  perform public.set_event_status(e,'published'); perform public.set_event_status(e,'live');
  perform public.redeem_ticket(e,'sra1_'||repeat('a',43),gen_random_uuid());
  t:=public.create_ticket_type(current_setting('sra_delete.keep')::uuid,'Keep type');
  keep_ticket:=public.issue_ticket(current_setting('sra_delete.keep')::uuid,t,gen_random_uuid(),'sra1_'||repeat('d',43),'Keep holder');
  perform set_config('sra_delete.keep_ticket',keep_ticket::text,true);
  begin perform public.delete_test_event(e,'Wrong name',true); raise exception 'Name confirmation bypassed';
    exception when invalid_parameter_value then null; end;
  begin perform public.delete_test_event(e,'Delete fixture',false); raise exception 'Test confirmation bypassed';
    exception when invalid_parameter_value then null; end;
  foreach k in array array['supervisor','admin'] loop
    perform set_config('request.jwt.claim.sub',current_setting('sra_delete.'||k),true);
    begin perform public.delete_test_event(e,'Delete fixture',true); raise exception 'Non-owner deleted event';
      exception when insufficient_privilege then null; end;
  end loop;
  begin perform app_private.delete_test_event_data(e,'Delete fixture'); raise exception 'Private cleanup exposed';
    exception when insufficient_privilege then null; end;
end; $$;
reset role;
select set_config('sra_delete.shared_holder',(select holder_id::text from public.tickets where id=current_setting('sra_delete.ticket1')::uuid),true);
select set_config('sra_delete.orphan_holder',(select holder_id::text from public.tickets where id=current_setting('sra_delete.ticket2')::uuid),true);
update public.tickets set holder_id=current_setting('sra_delete.shared_holder')::uuid where id=current_setting('sra_delete.keep_ticket')::uuid;
insert into public.ticket_email_jobs(event_id,ticket_id,queued_by,recipient,credential_digest,encrypted_token,status,claimed_at,lease_id)
values(current_setting('sra_delete.event')::uuid,current_setting('sra_delete.ticket2')::uuid,current_setting('sra_delete.owner')::uuid,'two@example.invalid',extensions.digest('fixture','sha256'),'fixture','processing',now(),gen_random_uuid());
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_delete.owner'),true);
do $$ begin
  begin perform public.delete_test_event(current_setting('sra_delete.event')::uuid,'Delete fixture',true);
    raise exception 'Active worker guard bypassed'; exception when object_not_in_prerequisite_state then null; end;
end; $$;
reset role;
update public.ticket_email_jobs set status='pending' where event_id=current_setting('sra_delete.event')::uuid;
set local role authenticated;
do $$ declare r jsonb; begin
  r:=public.delete_test_event(current_setting('sra_delete.event')::uuid,'Delete fixture',true);
  if r->>'deleted'<>'true' or (r->>'tickets')::integer<>2 or (r->>'orders')::integer<>2 or (r->>'financial_lines')::integer<>4 then
    raise exception 'Incorrect cleanup summary'; end if;
end; $$;
reset role;
do $$ declare e uuid:=current_setting('sra_delete.event')::uuid; begin
  if exists(select 1 from public.events where id=e) or exists(select 1 from public.tickets where event_id=e)
    or exists(select 1 from public.orders where event_id=e) or exists(select 1 from public.order_items where event_id=e)
    or exists(select 1 from public.checkins where event_id=e) or exists(select 1 from public.ticket_email_jobs where event_id=e)
    or exists(select 1 from public.ticket_types where event_id=e) or exists(select 1 from public.import_batches where event_id=e)
    or exists(select 1 from public.event_members where event_id=e) or exists(select 1 from app_private.native_import_requests where event_id=e)
    or exists(select 1 from app_private.native_import_rows where event_id=e) or exists(select 1 from app_private.redemption_requests where event_id=e) then
    raise exception 'Event data remains'; end if;
  if not exists(select 1 from public.events where id=current_setting('sra_delete.keep')::uuid)
    or not exists(select 1 from public.tickets where id=current_setting('sra_delete.keep_ticket')::uuid)
    or not exists(select 1 from public.ticket_holders where id=current_setting('sra_delete.shared_holder')::uuid)
    or exists(select 1 from public.ticket_holders where id=current_setting('sra_delete.orphan_holder')::uuid) then
    raise exception 'Cleanup crossed event boundaries or retained orphan holder'; end if;
  if not exists(select 1 from public.audit_logs where action='event.test_deleted' and entity_id=e and event_id is null)
    or not exists(select 1 from public.audit_logs where metadata->>'deleted_event_id'=e::text and event_id is null) then
    raise exception 'Audit not retained'; end if;
end; $$;
select 'delete_test_event: all assertions passed; rollback follows' as result;
rollback;
