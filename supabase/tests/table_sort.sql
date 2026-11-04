begin;
do $$ declare k text; begin
  foreach k in array array['owner','supervisor','org','event'] loop
    perform set_config('sra_sort.'||k,gen_random_uuid()::text,true);
  end loop;
  foreach k in array array['owner','supervisor'] loop
    insert into auth.users(id,email,invited_at,aud,role) values(current_setting('sra_sort.'||k)::uuid,current_setting('sra_sort.'||k)||'@example.invalid',now(),'authenticated','authenticated');
  end loop;
  insert into public.organizations(id,name,slug) values(current_setting('sra_sort.org')::uuid,'Sort fixture','sort-'||current_setting('sra_sort.org'));
  insert into public.organization_members(organization_id,user_id,role) values
    (current_setting('sra_sort.org')::uuid,current_setting('sra_sort.owner')::uuid,'owner'),
    (current_setting('sra_sort.org')::uuid,current_setting('sra_sort.supervisor')::uuid,'member');
  insert into public.events(id,organization_id,name,starts_at) values(current_setting('sra_sort.event')::uuid,current_setting('sra_sort.org')::uuid,'Sort fixture',now());
  insert into public.event_members(event_id,user_id,role) values(current_setting('sra_sort.event')::uuid,current_setting('sra_sort.supervisor')::uuid,'supervisor');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_sort.owner'),true);
do $$ declare t uuid; n integer; begin
  t:=public.create_ticket_type(current_setting('sra_sort.event')::uuid,'General');
  for n in 1..25 loop
    perform public.issue_ticket(current_setting('sra_sort.event')::uuid,t,gen_random_uuid(),'sra1_'||translate(encode(extensions.gen_random_bytes(32),'base64'),'+/=','-_'),
      'Persona '||lpad(n::text,2,'0'));
  end loop;
end; $$;
reset role;
insert into public.ticket_email_jobs(event_id,ticket_id,queued_by,recipient,credential_digest,encrypted_token,attempts,status)
select t.event_id,t.id,current_setting('sra_sort.owner')::uuid,lower(replace(h.full_name,' ','')||'@example.invalid'),extensions.digest(t.id::text,'sha256'),'fixture',right(h.full_name,2)::integer,
  case right(h.full_name,2)::integer % 3 when 0 then 'submitted' when 1 then 'cancelled' else 'pending' end
from public.tickets t join public.ticket_holders h on h.id=t.holder_id where t.event_id=current_setting('sra_sort.event')::uuid;
set local role authenticated;
do $$ declare e uuid:=current_setting('sra_sort.event')::uuid; value text; n integer; begin
  select full_name into value from public.list_event_tickets_sorted(e,1,0,'full_name',true);
  if value<>'Persona 01' then raise exception 'Ascending name sort failed'; end if;
  select full_name into value from public.list_event_tickets_sorted(e,1,20,'full_name',true);
  if value<>'Persona 21' then raise exception 'Sorting was applied after pagination'; end if;
  select full_name into value from public.list_event_tickets_sorted(e,1,0,'full_name',false);
  if value<>'Persona 25' then raise exception 'Descending name sort failed'; end if;
  select count(distinct id) into n from (
    select id from public.list_event_tickets_sorted(e,20,0,'issued_at',false)
    union all select id from public.list_event_tickets_sorted(e,20,20,'issued_at',false)
  ) r;
  if n<>25 then raise exception 'Unstable date ties across pages'; end if;
  select attempts into n from public.list_event_ticket_emails_sorted(e,1,20,'attempts',true);
  if n<>21 then raise exception 'Email attempts are not globally numeric'; end if;
  select attempts into n from public.list_event_ticket_emails_sorted(e,1,0,'attempts',false);
  if n<>25 then raise exception 'Email descending attempts failed'; end if;
  select status into value from public.list_event_ticket_emails_sorted(e,1,0,'status',true);
  if value<>'submitted' then raise exception 'Email status is not sorted by visible label'; end if;
  begin perform public.list_event_tickets_sorted(e,20,0,'invalid; select 1',true);
    raise exception 'Invalid sorting column accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.list_event_ticket_emails_sorted(e,20,-1,'recipient',true);
    raise exception 'Invalid offset accepted'; exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claim.sub',current_setting('sra_sort.supervisor'),true);
  if (select count(*) from public.list_event_tickets_sorted(e))<>20 then raise exception 'Supervisor ticket listing failed'; end if;
  begin perform public.list_event_ticket_emails_sorted(e);
    raise exception 'Supervisor can read email queue'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',current_setting('sra_sort.owner'),true);
  perform public.issue_ticket(e,(select id from public.ticket_types where event_id=e limit 1),gen_random_uuid(),
    'sra1_'||translate(encode(extensions.gen_random_bytes(32),'base64'),'+/=','-_'),'Álvaro');
  select full_name into value from public.list_event_tickets_sorted(e,1,0,'full_name',true);
  if value<>'Álvaro' then raise exception 'Spanish accent sorting failed'; end if;
end; $$;
reset role;
select 'table_sort: all assertions passed; rollback follows' as result;
rollback;
