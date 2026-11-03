-- Random fixtures only; the entire suite rolls back.
begin;
do $$ declare k text; u uuid; begin
  foreach k in array array['owner','scanner','org','event','other_event','request'] loop
    perform set_config('sra_scan.'||k,gen_random_uuid()::text,true);
  end loop;
  foreach k in array array['owner','scanner'] loop
    u:=current_setting('sra_scan.'||k)::uuid;
    insert into auth.users(id,email,invited_at,aud,role) values(u,u::text||'@example.invalid',now(),'authenticated','authenticated');
  end loop;
  insert into public.organizations(id,name,slug) values(current_setting('sra_scan.org')::uuid,'Scan test','scan-'||current_setting('sra_scan.org'));
  insert into public.organization_members(organization_id,user_id,role) values
    (current_setting('sra_scan.org')::uuid,current_setting('sra_scan.owner')::uuid,'owner'),
    (current_setting('sra_scan.org')::uuid,current_setting('sra_scan.scanner')::uuid,'member');
  insert into public.events(id,organization_id,name,starts_at) values
    (current_setting('sra_scan.event')::uuid,current_setting('sra_scan.org')::uuid,'Scan event',now()),
    (current_setting('sra_scan.other_event')::uuid,current_setting('sra_scan.org')::uuid,'Other event',now());
  insert into public.event_members(event_id,user_id,role) values(current_setting('sra_scan.event')::uuid,current_setting('sra_scan.scanner')::uuid,'scanner');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
select set_config('sra_scan.type',public.create_ticket_type(current_setting('sra_scan.event')::uuid,'General',10)::text,true);
select set_config('sra_scan.other_type',public.create_ticket_type(current_setting('sra_scan.other_event')::uuid,'Other',10)::text,true);
select set_config('sra_scan.ticket',public.issue_ticket(current_setting('sra_scan.event')::uuid,current_setting('sra_scan.type')::uuid,
  gen_random_uuid(),'sra1_'||repeat('A',43),'Test holder')::text,true);
select set_config('sra_scan.void_ticket',public.issue_ticket(current_setting('sra_scan.event')::uuid,current_setting('sra_scan.type')::uuid,
  gen_random_uuid(),'sra1_'||repeat('B',43),'Void holder')::text,true);
select set_config('sra_scan.revoked_ticket',public.issue_ticket(current_setting('sra_scan.event')::uuid,current_setting('sra_scan.type')::uuid,
  gen_random_uuid(),'sra1_'||repeat('C',43),'Revoked holder')::text,true);
select public.issue_ticket(current_setting('sra_scan.other_event')::uuid,current_setting('sra_scan.other_type')::uuid,
  gen_random_uuid(),'sra1_'||repeat('D',43),'Other holder');
reset role;
update public.tickets set status='void' where id=current_setting('sra_scan.void_ticket')::uuid;
update public.ticket_credentials set revoked_at=now() where ticket_id=current_setting('sra_scan.revoked_ticket')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.scanner'),true);
do $$ declare response jsonb; begin
  response:=public.redeem_ticket(current_setting('sra_scan.event')::uuid,'sra1_'||repeat('A',43),gen_random_uuid());
  if response->>'reason'<>'event_not_live' then raise exception 'Draft allowed entry'; end if;
  begin perform public.set_event_status(current_setting('sra_scan.event')::uuid,'live');
    raise exception 'Scanner changed event status';
  exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
do $$ begin
  begin perform public.set_event_status(current_setting('sra_scan.event')::uuid,'live');
    raise exception 'Invalid draft to live transition allowed';
  exception when check_violation then null; end;
end; $$;
select public.set_event_status(current_setting('sra_scan.event')::uuid,'published');
select public.set_event_status(current_setting('sra_scan.event')::uuid,'live');
select set_config('request.jwt.claim.sub',current_setting('sra_scan.scanner'),true);
do $$ declare response jsonb; repeated jsonb; begin
  response:=public.redeem_ticket(current_setting('sra_scan.event')::uuid,'sra1_'||repeat('A',43),current_setting('sra_scan.request')::uuid);
  if response->>'result'<>'accepted' or response ? 'full_name' or response ? 'email' or response ? 'token' then
    raise exception 'Invalid acceptance response';
  end if;
  repeated:=public.redeem_ticket(current_setting('sra_scan.event')::uuid,'sra1_'||repeat('A',43),current_setting('sra_scan.request')::uuid);
  if repeated<>response then raise exception 'Retry did not return original response'; end if;
  repeated:=public.redeem_ticket(current_setting('sra_scan.event')::uuid,'sra1_'||repeat('A',43),gen_random_uuid());
  if repeated->>'result'<>'duplicate' or repeated->>'redeemed_at'<>response->>'redeemed_at' then raise exception 'Double entry accepted'; end if;
  begin perform public.redeem_ticket(current_setting('sra_scan.event')::uuid,'sra1_'||repeat('B',43),current_setting('sra_scan.request')::uuid);
    raise exception 'Request input changed';
  exception when invalid_parameter_value then null; end;
  response:=public.redeem_ticket(current_setting('sra_scan.event')::uuid,'sra1_'||repeat('B',43),gen_random_uuid());
  if response->>'result'<>'void' then raise exception 'Void accepted'; end if;
  response:=public.redeem_ticket(current_setting('sra_scan.event')::uuid,'sra1_'||repeat('C',43),gen_random_uuid());
  if response->>'result'<>'void' then raise exception 'Revoked credential accepted'; end if;
  response:=public.redeem_ticket(current_setting('sra_scan.event')::uuid,'sra1_'||repeat('D',43),gen_random_uuid());
  if response->>'result'<>'wrong_event' or response ? 'type_name' then raise exception 'Wrong event accepted or disclosed details'; end if;
  response:=public.redeem_ticket(current_setting('sra_scan.event')::uuid,'sra1_'||repeat('E',43),gen_random_uuid());
  if response->>'result'<>'invalid' then raise exception 'Unknown accepted'; end if;
  begin perform public.redeem_ticket(current_setting('sra_scan.other_event')::uuid,'sra1_'||repeat('D',43),gen_random_uuid());
    raise exception 'Scanner accessed unassigned event';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.ticket_credentials; raise exception 'Scanner read credentials';
  exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
select public.set_event_status(current_setting('sra_scan.event')::uuid,'closed');
do $$ declare response jsonb; begin
  response:=public.redeem_ticket(current_setting('sra_scan.event')::uuid,'sra1_'||repeat('A',43),gen_random_uuid());
  if response->>'reason'<>'event_not_live' then raise exception 'Closed event accepted scan'; end if;
  begin perform public.set_event_status(current_setting('sra_scan.event')::uuid,'live');
    raise exception 'Closed event reopened';
  exception when check_violation then null; end;
end; $$;
reset role;
do $$ begin
  if (select count(*) from public.checkins where ticket_id=current_setting('sra_scan.ticket')::uuid and result='accepted')<>1 then
    raise exception 'Accepted checkin count incorrect';
  end if;
  if not exists(select 1 from public.tickets where id=current_setting('sra_scan.ticket')::uuid and status='redeemed' and redeemed_at is not null) then
    raise exception 'Ticket state not redeemed';
  end if;
  if (select count(*) from public.audit_logs where metadata->>'request_id'=current_setting('sra_scan.request'))<>1 then
    raise exception 'Retry duplicated audit';
  end if;
end; $$;
rollback;
