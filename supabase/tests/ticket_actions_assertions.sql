-- Append to ticket_redemption.sql BEFORE its final rollback; reuses random fixtures.
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
select set_config('sra_action.event',public.create_event(current_setting('sra_scan.org')::uuid,'Action test',now())::text,true);
select set_config('sra_action.type',public.create_ticket_type(current_setting('sra_action.event')::uuid,'General',2)::text,true);
select set_config('sra_action.ticket',public.issue_ticket(current_setting('sra_action.event')::uuid,current_setting('sra_action.type')::uuid,
  gen_random_uuid(),'sra1_'||repeat('X',43),'Reissue holder')::text,true);
select set_config('sra_action.void_ticket',public.issue_ticket(current_setting('sra_action.event')::uuid,current_setting('sra_action.type')::uuid,
  gen_random_uuid(),'sra1_'||repeat('Y',43),'Void holder')::text,true);
select set_config('sra_action.request',gen_random_uuid()::text,true);
select set_config('sra_action.void_request',gen_random_uuid()::text,true);
select public.set_event_status(current_setting('sra_action.event')::uuid,'published');
select public.set_event_status(current_setting('sra_action.event')::uuid,'live');
select public.provision_event_member(current_setting('sra_action.event')::uuid,current_setting('sra_scan.scanner')::uuid,'scanner');
do $$ declare r uuid; begin
  r:=public.manage_ticket_credential(current_setting('sra_action.ticket')::uuid,'reissue',current_setting('sra_action.request')::uuid,'QR lost by holder','sra1_'||repeat('Z',43));
  if r::text<>current_setting('sra_action.ticket') then raise exception 'Reissue changed ticket identity'; end if;
  r:=public.manage_ticket_credential(current_setting('sra_action.ticket')::uuid,'reissue',current_setting('sra_action.request')::uuid,'QR lost by holder','sra1_'||repeat('Z',43));
  begin perform public.manage_ticket_credential(current_setting('sra_action.ticket')::uuid,'reissue',current_setting('sra_action.request')::uuid,'QR lost by holder','sra1_'||repeat('W',43));
    raise exception 'Changed request parameters accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.manage_ticket_credential(current_setting('sra_action.void_ticket')::uuid,'reissue',gen_random_uuid(),'Test collision','sra1_'||repeat('Z',43));
    raise exception 'Duplicate token accepted';
  exception when unique_violation then null; end;
  begin perform public.manage_ticket_credential(current_setting('sra_scan.revoked_ticket')::uuid,'reissue',gen_random_uuid(),'Closed event test','sra1_'||repeat('N',43));
    raise exception 'Closed event allowed reissue';
  exception when check_violation then null; end;
end; $$;
reset role;
do $$ begin
  if not exists(select 1 from public.ticket_credentials where ticket_id=current_setting('sra_action.void_ticket')::uuid
    and token_digest=extensions.digest('sra1_'||repeat('Y',43),'sha256') and revoked_at is null) then
    raise exception 'Failed action revoked the original credential';
  end if;
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.scanner'),true);
do $$ declare r jsonb; begin
  begin perform public.manage_ticket_credential(current_setting('sra_action.void_ticket')::uuid,'void',gen_random_uuid(),'Scanner attempting cancellation');
    raise exception 'Scanner voided ticket';
  exception when insufficient_privilege then null; end;
  r:=public.redeem_ticket(current_setting('sra_action.event')::uuid,'sra1_'||repeat('X',43),gen_random_uuid());
  if r->>'result'<>'void' then raise exception 'Old QR remained usable'; end if;
  r:=public.redeem_ticket(current_setting('sra_action.event')::uuid,'sra1_'||repeat('Z',43),gen_random_uuid());
  if r->>'result'<>'accepted' then raise exception 'New QR was not accepted'; end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
do $$ begin
  begin perform public.manage_ticket_credential(current_setting('sra_action.ticket')::uuid,'reissue',gen_random_uuid(),'Already used ticket','sra1_'||repeat('L',43));
    raise exception 'Used ticket reissued';
  exception when check_violation then null; end;
  begin perform public.manage_ticket_credential(current_setting('sra_action.ticket')::uuid,'void',gen_random_uuid(),'Already used ticket');
    raise exception 'Used ticket voided';
  exception when check_violation then null; end;
  perform public.manage_ticket_credential(current_setting('sra_action.void_ticket')::uuid,'void',current_setting('sra_action.void_request')::uuid,'Holder requested cancellation');
  perform public.manage_ticket_credential(current_setting('sra_action.void_ticket')::uuid,'void',current_setting('sra_action.void_request')::uuid,'Holder requested cancellation');
end; $$;
select public.assign_event_member(current_setting('sra_action.event')::uuid,current_setting('sra_scan.scanner')::uuid,'supervisor');
select set_config('request.jwt.claim.sub',current_setting('sra_scan.scanner'),true);
do $$ declare r jsonb; begin
  begin perform public.manage_ticket_credential(current_setting('sra_action.void_ticket')::uuid,'reissue',gen_random_uuid(),'Supervisor request','sra1_'||repeat('P',43));
    raise exception 'Supervisor reissued ticket';
  exception when insufficient_privilege then null; end;
  r:=public.redeem_ticket(current_setting('sra_action.event')::uuid,'sra1_'||repeat('Y',43),gen_random_uuid());
  if r->>'result'<>'void' then raise exception 'Voided ticket QR accepted'; end if;
end; $$;
reset role;
do $$ begin
  if (select count(*) from public.tickets where event_id=current_setting('sra_action.event')::uuid)<>2 then raise exception 'Actions duplicated tickets'; end if;
  if (select count(*) from public.tickets where type_id=current_setting('sra_action.type')::uuid and status<>'void')<>1 then raise exception 'Void did not free capacity'; end if;
  if (select count(*) from public.ticket_credentials where ticket_id=current_setting('sra_action.ticket')::uuid and revoked_at is null)<>1 then raise exception 'Reissue created multiple active credentials'; end if;
  if (select count(*) from public.audit_logs where entity_id=current_setting('sra_action.ticket')::uuid and action='ticket.credential_reissued')<>1 then raise exception 'Reissue audit missing or duplicated'; end if;
  if (select count(*) from public.audit_logs where entity_id=current_setting('sra_action.void_ticket')::uuid and action='ticket.voided')<>1 then raise exception 'Void audit missing or duplicated'; end if;
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
select public.assign_event_member(current_setting('sra_action.event')::uuid,current_setting('sra_scan.scanner')::uuid,'admin');
select set_config('sra_action.admin_ticket',public.issue_ticket(current_setting('sra_action.event')::uuid,current_setting('sra_action.type')::uuid,
  gen_random_uuid(),'sra1_'||repeat('K',43),'Admin scope test')::text,true);
select set_config('request.jwt.claim.sub',current_setting('sra_scan.scanner'),true);
do $$ begin
  perform public.manage_ticket_credential(current_setting('sra_action.admin_ticket')::uuid,'reissue',gen_random_uuid(),'Assigned event admin','sra1_'||repeat('J',43));
  begin perform public.manage_ticket_credential(current_setting('sra_scan.ticket')::uuid,'void',gen_random_uuid(),'Another event test');
    raise exception 'Event admin accessed another event ticket';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
