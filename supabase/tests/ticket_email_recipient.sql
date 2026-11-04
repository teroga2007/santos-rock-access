begin;
do $$ declare k text; begin
  foreach k in array array['owner','supervisor','outside','org','other_org','event','other_event'] loop
    perform set_config('sra_recipient.'||k,gen_random_uuid()::text,true);
  end loop;
  foreach k in array array['owner','supervisor','outside'] loop
    insert into auth.users(id,email,invited_at,aud,role) values(current_setting('sra_recipient.'||k)::uuid,current_setting('sra_recipient.'||k)||'@example.invalid',now(),'authenticated','authenticated');
  end loop;
  insert into public.organizations(id,name,slug) values
    (current_setting('sra_recipient.org')::uuid,'Recipient fixture','recipient-'||current_setting('sra_recipient.org')),
    (current_setting('sra_recipient.other_org')::uuid,'Other recipient fixture','recipient-'||current_setting('sra_recipient.other_org'));
  insert into public.organization_members(organization_id,user_id,role) values
    (current_setting('sra_recipient.org')::uuid,current_setting('sra_recipient.owner')::uuid,'owner'),
    (current_setting('sra_recipient.org')::uuid,current_setting('sra_recipient.supervisor')::uuid,'member'),
    (current_setting('sra_recipient.other_org')::uuid,current_setting('sra_recipient.outside')::uuid,'owner');
  insert into public.events(id,organization_id,name,starts_at) values
    (current_setting('sra_recipient.event')::uuid,current_setting('sra_recipient.org')::uuid,'Recipient fixture',now()),
    (current_setting('sra_recipient.other_event')::uuid,current_setting('sra_recipient.other_org')::uuid,'Other recipient fixture',now());
  insert into public.event_members(event_id,user_id,role) values(current_setting('sra_recipient.event')::uuid,current_setting('sra_recipient.supervisor')::uuid,'supervisor');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_recipient.owner'),true);
do $$ declare e uuid:=current_setting('sra_recipient.event')::uuid; t uuid; a uuid; b uuid; begin
  t:=public.create_ticket_type(e,'General');
  a:=public.issue_ticket(e,t,gen_random_uuid(),'sra1_'||translate(encode(extensions.gen_random_bytes(32),'base64'),'+/=','-_'),'Recipient holder','complimentary','holder@example.invalid');
  b:=public.issue_ticket(e,t,gen_random_uuid(),'sra1_'||translate(encode(extensions.gen_random_bytes(32),'base64'),'+/=','-_'),'No email holder');
  if public.get_ticket_email_recipient(a)<>'holder@example.invalid' or public.get_ticket_email_recipient(b) is not null then raise exception 'Recipient lookup incorrect'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('sra_recipient.supervisor'),true);
  begin perform public.get_ticket_email_recipient(a); raise exception 'Supervisor read private recipient'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',current_setting('sra_recipient.outside'),true);
  begin perform public.get_ticket_email_recipient(a); raise exception 'Cross-org recipient exposed'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',current_setting('sra_recipient.owner'),true);
  begin perform public.get_ticket_email_recipient(gen_random_uuid()); raise exception 'Missing ticket allowed'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
select 'ticket_email_recipient: all assertions passed; rollback follows' as result;
rollback;
