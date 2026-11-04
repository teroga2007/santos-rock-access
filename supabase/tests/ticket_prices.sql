-- New pricing behavior only. Fixtures and writes are always rolled back.
begin;
do $$ declare k text; u uuid; begin
  foreach k in array array['owner','scanner','supervisor','org','event','request'] loop
    perform set_config('sra_prices.'||k,gen_random_uuid()::text,true);
  end loop;
  foreach k in array array['owner','scanner','supervisor'] loop
    u:=current_setting('sra_prices.'||k)::uuid;
    insert into auth.users(id,email,invited_at,aud,role) values(u,u::text||'@example.invalid',now(),'authenticated','authenticated');
  end loop;
  insert into public.organizations(id,name,slug) values(current_setting('sra_prices.org')::uuid,'Pricing fixture','pricing-'||current_setting('sra_prices.org'));
  insert into public.organization_members(organization_id,user_id,role) values
    (current_setting('sra_prices.org')::uuid,current_setting('sra_prices.owner')::uuid,'owner'),
    (current_setting('sra_prices.org')::uuid,current_setting('sra_prices.scanner')::uuid,'member'),
    (current_setting('sra_prices.org')::uuid,current_setting('sra_prices.supervisor')::uuid,'member');
  insert into public.events(id,organization_id,name,starts_at) values(current_setting('sra_prices.event')::uuid,current_setting('sra_prices.org')::uuid,'Pricing fixture',now());
  insert into public.event_members(event_id,user_id,role) values
    (current_setting('sra_prices.event')::uuid,current_setting('sra_prices.scanner')::uuid,'scanner'),
    (current_setting('sra_prices.event')::uuid,current_setting('sra_prices.supervisor')::uuid,'supervisor');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_prices.owner'),true);
do $$ declare e uuid:=current_setting('sra_prices.event')::uuid; t uuid; a uuid; r uuid; n integer; begin
  n:=public.configure_event_ticket_prices(e);
  if n<>7 or public.configure_event_ticket_prices(e)<>0 then raise exception 'Default prices are not idempotent'; end if;
  select id into t from public.ticket_types where event_id=e and name='Fase 1 + transporte';
  perform set_config('sra_prices.type',t::text,true);
  a:=public.issue_ticket(e,t,current_setting('sra_prices.request')::uuid,'sra1_'||repeat('p',43),'Pricing holder','sinpe',null,'PAY-PRICES-1');
  perform set_config('sra_prices.ticket',a::text,true);
  if (select count(*) from public.order_items where ticket_id=a)<>2
    or (select sum(unit_price_crc) from public.order_items where ticket_id=a)<>17500
    or (select unit_price_crc from public.order_items where ticket_id=a and kind='transport')<>7500 then
    raise exception 'Bundle must contain separate 10000/7500 lines'; end if;
  perform public.save_ticket_type_prices(e,'Fase 1 + transporte',11000,7500,'admission',null,'general',t);
  begin
    perform public.issue_priced_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('z',43),'Stale quote','sinpe',null,'STALE',10000,7500);
    raise exception 'Stale price accepted' using errcode='23514';
  exception when raise_exception then null; end;
  r:=public.issue_priced_ticket(e,t,current_setting('sra_prices.request')::uuid,'sra1_'||repeat('p',43),'Pricing holder','sinpe',null,'PAY-PRICES-1',10000,7500);
  if r<>a then raise exception 'Priced retry lost original sale'; end if;
  r:=public.issue_ticket(e,t,current_setting('sra_prices.request')::uuid,'sra1_'||repeat('p',43),'Pricing holder','sinpe',null,'PAY-PRICES-1');
  if r<>a or (select count(*) from public.order_items where ticket_id=a)<>2
    or (select sum(unit_price_crc) from public.order_items where ticket_id=a)<>17500 then
    raise exception 'Retry or new tariff changed the original sale'; end if;
  r:=public.issue_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('q',43),'Next holder','other',null,'OTHER-PRICES-1');
  if (select sum(unit_price_crc) from public.order_items where ticket_id=r)<>18500 then raise exception 'New tariff not applied'; end if;
  begin
    perform public.issue_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('r',43),'Free paid holder','complimentary');
    raise exception 'Paid bundle emitted as complimentary';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.issue_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('r',43),'Unverified holder','other');
    raise exception 'Paid sale without reference accepted';
  exception when invalid_parameter_value then null; end;
  select id into t from public.ticket_types where event_id=e and name='Staff';
  r:=public.issue_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('s',43),'Staff holder');
  if (select count(*) from public.order_items where ticket_id=r and kind='accreditation' and unit_price_crc=0)<>1 then
    raise exception 'Free accreditation not classified'; end if;
  t:=public.create_ticket_type(e,'Legacy unknown');
  r:=public.issue_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('t',43),'Legacy holder');
  if exists(select 1 from public.order_items where ticket_id=r) then raise exception 'Unknown historical price invented'; end if;
  begin perform public.save_ticket_type_prices(e,'Invalid staff',100,0,'accreditation');
    raise exception 'Paid accreditation allowed'; exception when invalid_parameter_value then null; end;
end; $$;

do $$ declare e uuid:=current_setting('sra_prices.event')::uuid; t uuid:=current_setting('sra_prices.type')::uuid;
  batch uuid:=gen_random_uuid(); rows jsonb; response jsonb; before_count bigint;
begin
  rows:=jsonb_build_array(
    jsonb_build_object('name','Bundle one','email','one@example.invalid','reference','CSV-PRICES','token','sra1_'||repeat('u',43)),
    jsonb_build_object('name','Bundle two','email','two@example.invalid','reference','CSV-PRICES','token','sra1_'||repeat('v',43)));
  begin
    perform public.import_priced_native_tickets(e,t,'sinpe',batch,rows,10000,7500);
    raise exception 'Stale CSV price accepted' using errcode='23514';
  exception when raise_exception then null; end;
  response:=public.import_priced_native_tickets(e,t,'sinpe',batch,rows,11000,7500);
  if (select count(*) from public.order_items i join public.tickets x on x.id=i.ticket_id where x.import_batch_id=batch)<>4
    or (select sum(i.unit_price_crc) from public.order_items i join public.tickets x on x.id=i.ticket_id where x.import_batch_id=batch)<>37000 then
    raise exception 'CSV bundle amounts incorrect'; end if;
  perform public.import_priced_native_tickets(e,t,'sinpe',batch,rows,11000,7500);
  if (select count(*) from public.order_items i join public.tickets x on x.id=i.ticket_id where x.import_batch_id=batch)<>4 then
    raise exception 'CSV retry duplicated sale lines'; end if;
  select count(*) into before_count from public.order_items where event_id=e;
  perform public.manage_ticket_credential(current_setting('sra_prices.ticket')::uuid,'reissue',gen_random_uuid(),'Reissue fixture','sra1_'||repeat('w',43));
  if (select count(*) from public.order_items where event_id=e)<>before_count then raise exception 'Reissue created another sale'; end if;
end; $$;

select set_config('request.jwt.claim.sub',current_setting('sra_prices.scanner'),true);
do $$ begin
  if exists(select 1 from public.order_items) then raise exception 'Scanner can view sale lines'; end if;
  begin perform public.configure_event_ticket_prices(current_setting('sra_prices.event')::uuid);
    raise exception 'Scanner changed prices'; exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_prices.supervisor'),true);
do $$ begin
  if not exists(select 1 from public.order_items where event_id=current_setting('sra_prices.event')::uuid) then raise exception 'Supervisor cannot read sale lines'; end if;
  begin update public.order_items set unit_price_crc=0;
    raise exception 'Sale line can be rewritten'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
select 'ticket_prices: all assertions passed; rollback follows' as result;
rollback;
