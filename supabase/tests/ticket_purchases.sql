-- All fixtures, budget reservations and queue changes are rolled back. No provider calls.
begin;
do $$ declare k text; begin
 foreach k in array array['owner','scanner','org','event','request','csv'] loop perform set_config('sra_buy.'||k,gen_random_uuid()::text,true); end loop;
 foreach k in array array['owner','scanner'] loop insert into auth.users(id,email,invited_at,aud,role) values(current_setting('sra_buy.'||k)::uuid,current_setting('sra_buy.'||k)||'@example.invalid',now(),'authenticated','authenticated'); end loop;
 insert into public.organizations(id,name,slug) values(current_setting('sra_buy.org')::uuid,'Purchase fixture','purchase-'||current_setting('sra_buy.org'));
 insert into public.organization_members(organization_id,user_id,role) values(current_setting('sra_buy.org')::uuid,current_setting('sra_buy.owner')::uuid,'owner'),(current_setting('sra_buy.org')::uuid,current_setting('sra_buy.scanner')::uuid,'member');
 insert into public.events(id,organization_id,name,starts_at,status) values(current_setting('sra_buy.event')::uuid,current_setting('sra_buy.org')::uuid,'Purchase fixture',now(),'live');
 insert into public.event_members(event_id,user_id,role) values(current_setting('sra_buy.event')::uuid,current_setting('sra_buy.scanner')::uuid,'scanner');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_buy.owner'),true);
select set_config('sra_buy.type',public.save_ticket_type_prices(current_setting('sra_buy.event')::uuid,'Bundle',10000,7500,'admission',8)::text,true);
do $$ declare e uuid:=current_setting('sra_buy.event')::uuid; t uuid:=current_setting('sra_buy.type')::uuid; req uuid:=current_setting('sra_buy.request')::uuid; rows jsonb; a jsonb; b jsonb; before_count integer; begin
 rows:=jsonb_build_array(jsonb_build_object('name','Buyer One','email','BUYER@example.invalid','quantity',3,'tokens',jsonb_build_array('sra1_'||repeat('A',43),'sra1_'||repeat('B',43),'sra1_'||repeat('C',43))));
 a:=public.issue_ticket_purchases(e,t,req,rows,'sinpe',10000,7500,true);
 if a->>'quantity'<>'3' or (a->>'total_crc')::numeric<>52500 then raise exception 'Wrong total'; end if;
 if (select count(*) from public.tickets where event_id=e)<>3 or (select count(distinct purchase_id) from public.tickets where event_id=e)<>1 then raise exception 'Purchase grouping failed'; end if;
 if (select sum(unit_price_crc) from public.order_items where event_id=e)<>52500 then raise exception 'Financial lines not multiplied'; end if;
 if exists(select 1 from public.orders where event_id=e and payment_reference is not null) then raise exception 'Fabricated payment reference'; end if;
 b:=public.issue_ticket_purchases(e,t,req,rows,'sinpe',10000,7500,true);
 if a<>b or (select count(*) from public.tickets where event_id=e)<>3 then raise exception 'Retry duplicated purchase'; end if;
 begin perform public.issue_ticket_purchases(e,t,req,rows,'other',10000,7500,true); raise exception 'Changed retry accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.issue_ticket_purchases(e,t,gen_random_uuid(),rows,'sinpe',10000,7500,false); raise exception 'Unconfirmed payment accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.issue_ticket_purchases(e,t,gen_random_uuid(),rows,'sinpe',9999,7500,true); raise exception 'Stale quote accepted'; exception when sqlstate 'P0001' then if sqlerrm='Stale quote accepted' then raise; end if; end;
 rows:=jsonb_build_array(jsonb_build_object('name','CSV One','email','buyer@example.invalid','quantity',2,'tokens',jsonb_build_array('sra1_'||repeat('D',43),'sra1_'||repeat('E',43))),jsonb_build_object('name','CSV Two','email','buyer@example.invalid','quantity',1,'tokens',jsonb_build_array('sra1_'||repeat('F',43))));
 a:=public.issue_ticket_purchases(e,t,current_setting('sra_buy.csv')::uuid,rows,'sinpe',10000,7500,true,true);
 if jsonb_array_length(a->'tickets')<>3 or (select count(*) from public.tickets where event_id=e)<>6 then raise exception 'CSV quantity expansion failed'; end if;
 begin perform public.issue_ticket_purchases(e,t,gen_random_uuid(),rows,'sinpe',10000,7500,true,true); raise exception 'Duplicate CSV accepted'; exception when unique_violation then null; end;
 rows:=jsonb_build_array(jsonb_build_object('name','Too Many','email','buyer@example.invalid','quantity',3,'tokens',jsonb_build_array('sra1_'||repeat('G',43),'sra1_'||repeat('H',43),'sra1_'||repeat('I',43))));
 begin perform public.issue_ticket_purchases(e,t,gen_random_uuid(),rows,'sinpe',10000,7500,true); raise exception 'Capacity exceeded'; exception when check_violation then null; end;
 if (select count(*) from public.tickets where event_id=e)<>6 then raise exception 'Partial commit on capacity error'; end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_buy.scanner'),true);
do $$ declare e uuid:=current_setting('sra_buy.event')::uuid; r jsonb; begin
 r:=public.redeem_ticket(e,'sra1_'||repeat('A',43),gen_random_uuid()); if r->>'result'<>'accepted' then raise exception 'First QR failed'; end if;
 r:=public.redeem_ticket(e,'sra1_'||repeat('A',43),gen_random_uuid()); if r->>'result'<>'duplicate' then raise exception 'QR reused'; end if;
 r:=public.redeem_ticket(e,'sra1_'||repeat('B',43),gen_random_uuid()); if r->>'result'<>'accepted' then raise exception 'Companion QR not independent'; end if;
 begin perform public.issue_ticket_purchases(e,current_setting('sra_buy.type')::uuid,gen_random_uuid(),'[]','sinpe',10000,7500,true); raise exception 'Scanner can issue'; exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_buy.owner'),true);
do $$ declare e uuid:=current_setting('sra_buy.event')::uuid; t uuid; r jsonb; rows jsonb; begin
 t:=public.save_ticket_type_prices(e,'Door',16000,0,'admission',10);
 rows:=jsonb_build_array(jsonb_build_object('name','Door Buyer','email','door@example.invalid','quantity',3,'tokens',jsonb_build_array('sra1_'||repeat('J',43),'sra1_'||repeat('K',43),'sra1_'||repeat('L',43))));
 r:=public.issue_ticket_purchases(e,t,gen_random_uuid(),rows,'door',16000,0,true,false,'cash',50000);
 if (r->>'total_crc')::numeric<>48000 or (r->>'cash_change_crc')::numeric<>2000 then raise exception 'Group cash calculation failed'; end if;
 if (select sum(cash_received_crc) from public.orders where event_id=e and payment_method='cash')<>50000 or (select sum(cash_change_crc) from public.orders where event_id=e and payment_method='cash')<>2000 then raise exception 'Cash counted more than once'; end if;
end; $$;
reset role;
do $$ declare items jsonb; queued jsonb; group_id uuid; claims jsonb; lease uuid; reserved integer; jobs jsonb; active_ids uuid[]; e uuid:=current_setting('sra_buy.event')::uuid; begin
 select jsonb_agg(jsonb_build_object('ticket_id',t.id,'token', 'sra1_'||repeat(case r.row_number when 1 then 'D' when 2 then 'E' else 'F' end,43),'encrypted_token',repeat('x',80))) into items from public.tickets t join (select (j->>'ticket_id')::uuid as ticket_id,(j->>'row')::integer as row_number from app_private.ticket_purchase_requests p,jsonb_array_elements(p.response->'tickets') j where p.request_id=current_setting('sra_buy.csv')::uuid) r on r.ticket_id=t.id;
 queued:=public.queue_ticket_emails(current_setting('sra_buy.owner')::uuid,items);
 if jsonb_array_length(queued)<>3 or (select count(distinct delivery_id) from public.ticket_email_jobs where event_id=e)<>1 then raise exception 'Shared email not grouped'; end if;
 if public.queue_ticket_emails(current_setting('sra_buy.owner')::uuid,items)<>queued then raise exception 'Queue retry not idempotent'; end if;
 update public.ticket_email_jobs set created_at='1900-01-01' where event_id=e;
 -- Cancel one QR before claiming; the other two must still be sent together.
 update public.tickets set status='void' where id=(items->0->>'ticket_id')::uuid;
 select coalesce((select b.reserved from app_private.email_daily_budget b where b.day=(clock_timestamp() at time zone 'UTC')::date),0) into reserved;
 claims:=public.claim_ticket_email_deliveries(250,1);
 if (select b.reserved from app_private.email_daily_budget b where day=(clock_timestamp() at time zone 'UTC')::date)<>reserved+1 then raise exception 'Budget counted QR instead of messages'; end if;
 select delivery_id,lease_id into group_id,lease from public.ticket_email_jobs where event_id=e and status='processing' limit 1;
 if group_id is null or jsonb_array_length(claims)<>2 then raise exception 'Group not claimed atomically'; end if;
 jobs:=public.get_claimed_ticket_email_delivery(group_id,lease);
 if jsonb_array_length(jobs)<>2 then raise exception 'Cancelled QR blocked valid companions'; end if;
 select array_agg((j->>'id')::uuid) into active_ids from jsonb_array_elements(jobs) j;
 begin perform public.finish_ticket_email_delivery(group_id,lease,array[gen_random_uuid()],'submitted','wrong-delivery',null); raise exception 'Foreign job accepted'; exception when invalid_parameter_value then null; end;
 perform public.finish_ticket_email_delivery(group_id,lease,active_ids,'failed',null,'brevo_http_429');
 perform set_config('request.jwt.claim.sub',current_setting('sra_buy.owner'),true);
 perform public.retry_ticket_email_delivery(group_id);
 claims:=public.claim_ticket_email_deliveries(250,1);
 select lease_id into lease from public.ticket_email_jobs where delivery_id=group_id and status='processing' limit 1;
 if jsonb_array_length(claims)<>2 then raise exception 'Failed bundle retry separated companions'; end if;
 perform public.finish_ticket_email_delivery(group_id,lease,active_ids,'submitted','fixture-provider',null);
 if (select count(*) from public.ticket_email_jobs where event_id=e and status='submitted')<>2 then raise exception 'Group outcome not saved'; end if;
 if exists(select 1 from public.ticket_email_jobs where event_id=e and encrypted_token is not null) then raise exception 'Credentials retained after send'; end if;
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_buy.owner'),true);
do $$ declare r record; begin
 select * into r from public.list_event_email_deliveries(current_setting('sra_buy.event')::uuid);
 if r.ticket_count<>3 or r.cancelled_count<>1 or r.status<>'submitted' then raise exception 'Delivery summary incorrect'; end if;
end; $$;
select public.delete_test_event(current_setting('sra_buy.event')::uuid,'Purchase fixture',true);
reset role;
do $$ begin
 if exists(select 1 from app_private.ticket_purchase_requests where event_id=current_setting('sra_buy.event')::uuid) then raise exception 'Deleted test event retained purchase requests'; end if;
end; $$;
rollback;
