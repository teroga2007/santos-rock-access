-- Append inside ticket_redemption.sql's transaction before its final rollback.
-- Run in staging or before activating real workers: budget assertions assume an unused UTC-day budget.
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
select set_config('sra_mail.event',public.create_event(current_setting('sra_scan.org')::uuid,'Mail test',now())::text,true);
select set_config('sra_mail.type',public.create_ticket_type(current_setting('sra_mail.event')::uuid,'Mail general',10)::text,true);
select set_config('sra_mail.ticket',public.issue_ticket(current_setting('sra_mail.event')::uuid,current_setting('sra_mail.type')::uuid,gen_random_uuid(),'sra1_'||repeat('X',43),'Mail One','complimentary','one@example.invalid')::text,true);
select set_config('sra_mail.second',public.issue_ticket(current_setting('sra_mail.event')::uuid,current_setting('sra_mail.type')::uuid,gen_random_uuid(),'sra1_'||repeat('Y',43),'Mail Two','complimentary','two@example.invalid')::text,true);
do $$ begin
 begin perform public.queue_ticket_emails(current_setting('sra_scan.owner')::uuid,'[]'::jsonb); raise exception 'Browser could impersonate actor';
 exception when insufficient_privilege then null; end;
 begin perform encrypted_token from public.ticket_email_jobs; raise exception 'Browser could read encrypted credentials';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
set local role service_role;
do $$ declare items jsonb; r jsonb; again jsonb; begin
 items:=jsonb_build_array(jsonb_build_object('ticket_id',current_setting('sra_mail.ticket'),'token','sra1_'||repeat('X',43),'encrypted_token',repeat('encrypted',20)));
 r:=public.queue_ticket_emails(current_setting('sra_scan.owner')::uuid,items);
 again:=public.queue_ticket_emails(current_setting('sra_scan.owner')::uuid,items);
 if r<>again or jsonb_array_length(r)<>1 then raise exception 'Queue retry duplicated jobs'; end if;
 perform set_config('sra_mail.job',r->0->>'id',true);
 perform public.queue_ticket_emails(current_setting('sra_scan.owner')::uuid,jsonb_build_array(jsonb_build_object('ticket_id',current_setting('sra_mail.second'),'token','sra1_'||repeat('Y',43),'encrypted_token',repeat('encrypted',20))));
 begin perform public.queue_ticket_emails(current_setting('sra_scan.scanner')::uuid,items); raise exception 'Unassigned actor queued email';
 exception when insufficient_privilege then null; end;
 begin perform public.queue_ticket_emails(current_setting('sra_scan.owner')::uuid,jsonb_build_array(jsonb_build_object('ticket_id',current_setting('sra_mail.ticket'),'token','sra1_'||repeat('Z',43),'encrypted_token',repeat('encrypted',20)))); raise exception 'Unknown credential queued';
 exception when check_violation then null; end;
end; $$;
-- Cancel the second ticket before claiming; it must not consume budget.
reset role;
update public.tickets set status='void' where id=current_setting('sra_mail.second')::uuid;
set local role service_role;
do $$ declare claims jsonb; j jsonb; begin
 claims:=public.claim_ticket_emails(1,5);
 if jsonb_array_length(claims)<>1 then raise exception 'Wrong claim size'; end if;
 perform set_config('sra_mail.lease',claims->0->>'lease_id',true);
 if claims->0->>'id'<>current_setting('sra_mail.job') then raise exception 'Claimed cancelled ticket'; end if;
 if jsonb_array_length(public.claim_ticket_emails(1,5))<>0 then raise exception 'Daily budget exceeded'; end if;
 j:=public.get_claimed_ticket_email(current_setting('sra_mail.job')::uuid,current_setting('sra_mail.lease')::uuid);
 if j->>'recipient'<>'one@example.invalid' then raise exception 'Wrong recipient'; end if;
 if public.get_claimed_ticket_email(current_setting('sra_mail.job')::uuid,gen_random_uuid()) is not null then raise exception 'Wrong lease accessed job'; end if;
 perform public.finish_ticket_email(current_setting('sra_mail.job')::uuid,gen_random_uuid(),'submitted','fake');
 if not exists(select 1 from public.ticket_email_jobs where id=current_setting('sra_mail.job')::uuid and status='processing') then raise exception 'Wrong lease finished job'; end if;
 perform public.finish_ticket_email(current_setting('sra_mail.job')::uuid,current_setting('sra_mail.lease')::uuid,'submitted','test-provider-id');
 perform public.finish_ticket_email(current_setting('sra_mail.job')::uuid,current_setting('sra_mail.lease')::uuid,'submitted','test-provider-id');
 if not exists(select 1 from public.ticket_email_jobs where id=current_setting('sra_mail.job')::uuid and status='submitted' and encrypted_token is null) then raise exception 'Submitted payload not cleared'; end if;
end; $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
do $$ begin
 if (select count(*) from public.ticket_email_jobs where event_id=current_setting('sra_mail.event')::uuid)<>2 then raise exception 'Owner cannot see queue'; end if;
 begin perform public.retry_ticket_email(current_setting('sra_mail.job')::uuid); raise exception 'Submitted mail requeued';
 exception when check_violation then null; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.scanner'),true);
do $$ begin
 if exists(select 1 from public.ticket_email_jobs where event_id=current_setting('sra_mail.event')::uuid) then raise exception 'Scanner saw queue'; end if;
 begin perform public.retry_ticket_email(current_setting('sra_mail.job')::uuid); raise exception 'Scanner requeued mail';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
do $$ begin
 if (select count(*) from public.audit_logs where entity_id=current_setting('sra_mail.job')::uuid and action='ticket.email_queued')<>1 then raise exception 'Queue audit duplicated'; end if;
 if (select count(*) from public.audit_logs where entity_id=current_setting('sra_mail.job')::uuid and action='ticket.email_submitted')<>1 then raise exception 'Send audit duplicated'; end if;
 if not exists(select 1 from public.ticket_email_jobs where ticket_id=current_setting('sra_mail.second')::uuid and status='cancelled' and encrypted_token is null) then raise exception 'Invalid ticket was not cancelled'; end if;
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
select set_config('sra_mail.third',public.issue_ticket(current_setting('sra_mail.event')::uuid,current_setting('sra_mail.type')::uuid,gen_random_uuid(),'sra1_'||repeat('Z',43),'Mail Three','complimentary','three@example.invalid')::text,true);
set local role service_role;
do $$ declare r jsonb; c jsonb; begin
 r:=public.queue_ticket_emails(current_setting('sra_scan.owner')::uuid,jsonb_build_array(jsonb_build_object('ticket_id',current_setting('sra_mail.third'),'token','sra1_'||repeat('Z',43),'encrypted_token',repeat('encrypted',20))));
 perform set_config('sra_mail.third_job',r->0->>'id',true);
 c:=public.claim_ticket_emails(2,5);
 if jsonb_array_length(c)<>1 then raise exception 'Third job not claimed'; end if;
 perform public.finish_ticket_email((c->0->>'id')::uuid,(c->0->>'lease_id')::uuid,'failed',null,'brevo_http_429');
end; $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
select public.retry_ticket_email(current_setting('sra_mail.third_job')::uuid);
reset role;
set local role service_role;
do $$ declare c jsonb; begin
 if jsonb_array_length(public.claim_ticket_emails(2,5))<>0 then raise exception 'Retry bypassed daily budget'; end if;
 c:=public.claim_ticket_emails(3,5);
 if jsonb_array_length(c)<>1 then raise exception 'Failed message could not be retried'; end if;
 perform public.finish_ticket_email((c->0->>'id')::uuid,(c->0->>'lease_id')::uuid,'unknown',null,'provider_or_worker_uncertain');
end; $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
do $$ begin
 begin perform public.retry_ticket_email(current_setting('sra_mail.third_job')::uuid); raise exception 'Uncertain send was retried automatically';
 exception when check_violation then null; end;
end; $$;
reset role;
