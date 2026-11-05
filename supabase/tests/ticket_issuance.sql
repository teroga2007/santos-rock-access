-- Transactional regression suite. All fixtures and issued tickets are rolled back.
-- Run after 001-006 as database owner; test users have random IDs and no real emails.
begin;
do $$
declare k text; u uuid;
begin
  foreach k in array array['owner','scanner','org','event','other_event','request'] loop
    perform set_config('sra_issue.'||k,gen_random_uuid()::text,true);
  end loop;
  foreach k in array array['owner','scanner'] loop
    u:=current_setting('sra_issue.'||k)::uuid;
    insert into auth.users(id,email,invited_at,aud,role) values(u,u::text||'@example.invalid',now(),'authenticated','authenticated');
  end loop;
  insert into public.organizations(id,name,slug) values(current_setting('sra_issue.org')::uuid,'Issuance test','issue-'||current_setting('sra_issue.org'));
  insert into public.organization_members(organization_id,user_id,role) values
    (current_setting('sra_issue.org')::uuid,current_setting('sra_issue.owner')::uuid,'owner'),
    (current_setting('sra_issue.org')::uuid,current_setting('sra_issue.scanner')::uuid,'member');
  insert into public.events(id,organization_id,name,starts_at) values
    (current_setting('sra_issue.event')::uuid,current_setting('sra_issue.org')::uuid,'Issuance test',now()),
    (current_setting('sra_issue.other_event')::uuid,current_setting('sra_issue.org')::uuid,'Other event',now());
  insert into public.event_members(event_id,user_id,role) values(current_setting('sra_issue.event')::uuid,current_setting('sra_issue.scanner')::uuid,'scanner');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_issue.owner'),true);
select set_config('sra_issue.type',public.create_ticket_type(current_setting('sra_issue.event')::uuid,'General',1)::text,true);
select set_config('sra_issue.ticket',public.issue_ticket(current_setting('sra_issue.event')::uuid,current_setting('sra_issue.type')::uuid,
  current_setting('sra_issue.request')::uuid,'sra1_'||repeat('A',43),'Test holder')::text,true);
do $$ declare v_retry uuid; begin
  v_retry:=public.issue_ticket(current_setting('sra_issue.event')::uuid,current_setting('sra_issue.type')::uuid,
    current_setting('sra_issue.request')::uuid,'sra1_'||repeat('A',43),'Test holder');
  if v_retry::text<>current_setting('sra_issue.ticket') then raise exception 'Retry duplicated ticket'; end if;
  begin
    perform public.issue_ticket(current_setting('sra_issue.event')::uuid,current_setting('sra_issue.type')::uuid,
      current_setting('sra_issue.request')::uuid,'sra1_'||repeat('B',43),'Different input');
    raise exception 'Request reused with different input';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.issue_ticket(current_setting('sra_issue.event')::uuid,current_setting('sra_issue.type')::uuid,
      gen_random_uuid(),'sra1_'||repeat('B',43),'Capacity overflow');
    raise exception 'Capacity exceeded';
  exception when check_violation then null; end;
  begin
    perform public.issue_ticket(current_setting('sra_issue.other_event')::uuid,current_setting('sra_issue.type')::uuid,
      gen_random_uuid(),'sra1_'||repeat('C',43),'Wrong event');
    raise exception 'Cross-event type accepted';
  exception when check_violation then null; end;
  if (select count(*) from public.list_event_tickets(current_setting('sra_issue.event')::uuid))<>1 then
    raise exception 'Listing should have exactly one ticket';
  end if;
  begin perform 1 from public.ticket_credentials; raise exception 'Credential SELECT allowed';
  exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_issue.scanner'),true);
do $$ begin
  begin
    perform public.issue_ticket(current_setting('sra_issue.event')::uuid,current_setting('sra_issue.type')::uuid,
      gen_random_uuid(),'sra1_'||repeat('E',43),'Scanner issuing');
    raise exception 'Scanner issued a ticket';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.list_event_tickets(current_setting('sra_issue.event')::uuid);
    raise exception 'Scanner read holders';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.tickets where event_id=current_setting('sra_issue.event')::uuid) then
    raise exception 'Scanner read ticket rows';
  end if;
end; $$;
reset role;
do $$ begin
  if (select count(*) from public.ticket_holders where organization_id=current_setting('sra_issue.org')::uuid)<>1 then
    raise exception 'Rejected requests left orphan holders';
  end if;
  if not exists(select 1 from public.ticket_credentials where ticket_id=current_setting('sra_issue.ticket')::uuid
    and token_digest=extensions.digest('sra1_'||repeat('A',43),'sha256')) then
    raise exception 'Credential digest is incorrect';
  end if;
  if (select count(*) from public.audit_logs where event_id=current_setting('sra_issue.event')::uuid and action='ticket.issued')<>1 then
    raise exception 'Issuance audit duplicated or missing';
  end if;
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_issue.owner'),true);
select set_config('sra_issue.paid_type',public.create_ticket_type(current_setting('sra_issue.event')::uuid,'Paid',null)::text,true);
select set_config('sra_issue.paid_ticket',public.issue_ticket(current_setting('sra_issue.event')::uuid,current_setting('sra_issue.paid_type')::uuid,
  gen_random_uuid(),'sra1_'||repeat('F',43),'Paid holder','sinpe',null,'test-reference')::text,true);
do $$ begin
  begin
    perform public.issue_ticket(current_setting('sra_issue.event')::uuid,current_setting('sra_issue.paid_type')::uuid,
      gen_random_uuid(),'sra1_'||repeat('G',43),'External ticket','ticketera');
    raise exception 'External ticket source accepted';
  exception when invalid_parameter_value then null; end;
end; $$;
reset role;
do $$ begin
  if not exists(select 1 from public.tickets t join public.orders o on o.id=t.order_id
    where t.id=current_setting('sra_issue.paid_ticket')::uuid and o.payment_status='verified' and o.payment_reference='test-reference') then
    raise exception 'Paid ticket has no verified order';
  end if;
end; $$;
update public.events set status='closed' where id=current_setting('sra_issue.event')::uuid;
update public.event_members set role='supervisor' where event_id=current_setting('sra_issue.event')::uuid and user_id=current_setting('sra_issue.scanner')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_issue.owner'),true);
do $$ begin
  begin
    perform public.issue_ticket(current_setting('sra_issue.event')::uuid,current_setting('sra_issue.paid_type')::uuid,
      gen_random_uuid(),'sra1_'||repeat('H',43),'Closed event');
    raise exception 'Closed event accepted issuance';
  exception when check_violation then null; end;
  begin
    perform public.create_ticket_type(current_setting('sra_issue.event')::uuid,'Too late',10);
    raise exception 'Closed event accepted new type';
  exception when check_violation then null; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_issue.scanner'),true);
do $$ begin
  if (select count(*) from public.list_event_tickets(current_setting('sra_issue.event')::uuid))<>2 then
    raise exception 'Supervisor cannot see issued tickets';
  end if;
  begin
    perform public.create_ticket_type(current_setting('sra_issue.event')::uuid,'Unauthorized supervisor',10);
    raise exception 'Supervisor created ticket type';
  exception when insufficient_privilege then null; end;
end; $$;
rollback;
