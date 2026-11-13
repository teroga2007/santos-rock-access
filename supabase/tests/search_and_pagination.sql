-- Isolated fixtures and all writes rolled back; no provider calls.
begin;
do $$ declare k text; begin
 foreach k in array array['owner','supervisor','scanner','outsider','org','event','other_event'] loop perform set_config('sra_search.'||k,gen_random_uuid()::text,true); end loop;
 foreach k in array array['owner','supervisor','scanner','outsider'] loop insert into auth.users(id,email,invited_at,aud,role) values(current_setting('sra_search.'||k)::uuid,current_setting('sra_search.'||k)||'@example.invalid',now(),'authenticated','authenticated'); end loop;
 insert into public.organizations(id,name,slug) values(current_setting('sra_search.org')::uuid,'Search fixture','search-'||current_setting('sra_search.org'));
 insert into public.organization_members(organization_id,user_id,role) values(current_setting('sra_search.org')::uuid,current_setting('sra_search.owner')::uuid,'owner'),(current_setting('sra_search.org')::uuid,current_setting('sra_search.supervisor')::uuid,'member'),(current_setting('sra_search.org')::uuid,current_setting('sra_search.scanner')::uuid,'member');
 insert into public.events(id,organization_id,name,starts_at) values(current_setting('sra_search.event')::uuid,current_setting('sra_search.org')::uuid,'Search fixture',now()),(current_setting('sra_search.other_event')::uuid,current_setting('sra_search.org')::uuid,'Other event',now());
 insert into public.event_members(event_id,user_id,role) values(current_setting('sra_search.event')::uuid,current_setting('sra_search.supervisor')::uuid,'supervisor'),(current_setting('sra_search.event')::uuid,current_setting('sra_search.scanner')::uuid,'scanner');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_search.owner'),true);
do $$ declare t uuid; n integer; tid uuid; begin
 t:=public.save_ticket_type_prices(current_setting('sra_search.event')::uuid,'General + transporte',10000,7500,'admission',200);
 for n in 1..45 loop
  tid:=public.issue_ticket(current_setting('sra_search.event')::uuid,t,gen_random_uuid(),'sra1_'||translate(encode(extensions.gen_random_bytes(32),'base64'),'+/=','-_'),case when n=1 then 'José María' else 'Persona '||lpad(n::text,3,'0') end,case when n%2=0 then 'sinpe'::public.ticket_source else 'other'::public.ticket_source end,'grupo'||((n-1)/3)::text||'@example.invalid',null);
 end loop;
 t:=public.create_ticket_type(current_setting('sra_search.other_event')::uuid,'Other');
 perform public.issue_ticket(current_setting('sra_search.other_event')::uuid,t,gen_random_uuid(),'sra1_'||translate(encode(extensions.gen_random_bytes(32),'base64'),'+/=','-_'),'Other holder');
end; $$;
reset role;
update public.tickets t set status='redeemed',redeemed_at=now() from public.ticket_holders h where t.holder_id=h.id and t.event_id=current_setting('sra_search.event')::uuid and h.full_name='Persona 045';
insert into public.ticket_email_jobs(event_id,ticket_id,queued_by,recipient,credential_digest,encrypted_token,delivery_id,status,attempts)
select t.event_id,t.id,current_setting('sra_search.owner')::uuid,h.email,extensions.digest(t.id::text,'sha256'),'private-fixture',md5(t.event_id::text||h.email)::uuid,case when h.email='grupo0@example.invalid' then 'failed' else 'pending' end,case when h.email='grupo0@example.invalid' then 1 else 0 end
from public.tickets t join public.ticket_holders h on h.id=t.holder_id where t.event_id=current_setting('sra_search.event')::uuid;
set local role authenticated;
do $$ declare e uuid:=current_setting('sra_search.event')::uuid; r jsonb; n integer; begin
 r:=public.search_event_tickets(e);
 if (r->>'total')::integer<>45 or jsonb_array_length(r->'items')<>20 then raise exception 'Wrong initial ticket total'; end if;
 r:=public.search_event_tickets(e,'',null,null,20,40);
 if (r->>'total')::integer<>45 or jsonb_array_length(r->'items')<>5 then raise exception 'Wrong last page'; end if;
 r:=public.search_event_tickets(e,'',null,null,20,500);
 if (r->>'total')::integer<>45 or jsonb_array_length(r->'items')<>0 then raise exception 'Missing totals on empty page'; end if;
 r:=public.search_event_tickets(e,'  JOSE   maria  ');
 if (r->>'total')::integer<>1 or r->'items'->0->>'full_name'<>'José María' then raise exception 'Accents or multiple words failed'; end if;
 r:=public.search_event_tickets(e,'grupo0@example.invalid');
 if (r->>'total')::integer<>3 then raise exception 'Email search failed'; end if;
 r:=public.search_event_tickets(e,'GENERAL transporte');
 if (r->>'total')::integer<>45 then raise exception 'Type keyword search failed'; end if;
 r:=public.search_event_tickets(e,'',null,'sinpe');
 if (r->>'total')::integer<>22 then raise exception 'Source filter failed'; end if;
 r:=public.search_event_tickets(e,'utilizada','redeemed');
 if (r->>'total')::integer<>1 then raise exception 'Status keyword/filter failed'; end if;
 r:=public.search_event_tickets(e,'%',null,null);
 if (r->>'total')::integer<>0 or (r->>'total_all')::integer<>45 then raise exception 'Wildcard search was not literal'; end if;
 r:=public.search_event_tickets(e,'unknown buyer');
 if (r->>'total')::integer<>0 then raise exception 'Empty search incorrect'; end if;
 select count(distinct item->>'id') into n from (
  select jsonb_array_elements(public.search_event_tickets(e,'',null,null,20,0)->'items') as item union all
  select jsonb_array_elements(public.search_event_tickets(e,'',null,null,20,20)->'items') as item union all
  select jsonb_array_elements(public.search_event_tickets(e,'',null,null,20,40)->'items') as item
 ) all_pages;
 if n<>45 then raise exception 'Date ties lost or duplicated tickets across pages'; end if;
 begin perform public.search_event_tickets(e,'',null,null,999); raise exception 'Invalid page size accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.search_event_tickets(e,'',null,null,20,0,'invalid; select 1'); raise exception 'Invalid sort accepted'; exception when invalid_parameter_value then null; end;
 r:=public.search_event_email_deliveries(e);
 if (r->>'total')::integer<>15 or (r->>'ticket_total')::integer<>45 then raise exception 'Grouped email totals incorrect'; end if;
 r:=public.search_event_email_deliveries(e,'JOSE maria');
 if (r->>'total')::integer<>1 or (r->>'ticket_total')::integer<>3 then raise exception 'Group search omitted companion names'; end if;
 if (r->'items'->0) ? 'search_text' or r::text like '%private-fixture%' then raise exception 'Internal search metadata leaked'; end if;
 r:=public.search_event_email_deliveries(e,'rechazado','failed');
 if (r->>'total')::integer<>1 then raise exception 'Group status search/filter failed'; end if;
 r:=public.search_event_email_deliveries(e,'',null,20,500);
 if (r->>'total')::integer<>15 or (r->>'ticket_total')::integer<>45 or jsonb_array_length(r->'items')<>0 then raise exception 'Missing totals on empty email page'; end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_search.supervisor'),true);
do $$ begin
 if (public.search_event_tickets(current_setting('sra_search.event')::uuid)->>'total')::integer<>45 then raise exception 'Supervisor cannot search tickets'; end if;
 begin perform public.search_event_email_deliveries(current_setting('sra_search.event')::uuid); raise exception 'Supervisor read mail queue'; exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_search.scanner'),true);
do $$ begin
 begin perform public.search_event_tickets(current_setting('sra_search.event')::uuid); raise exception 'Scanner read holders'; exception when insufficient_privilege then null; end;
 begin perform public.search_event_email_deliveries(current_setting('sra_search.event')::uuid); raise exception 'Scanner read recipients'; exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_search.outsider'),true);
do $$ begin
 begin perform public.search_event_tickets(current_setting('sra_search.event')::uuid); raise exception 'Outside user read event'; exception when insufficient_privilege then null; end;
 begin perform public.search_event_email_deliveries(current_setting('sra_search.event')::uuid); raise exception 'Outside user read mail'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
rollback;
