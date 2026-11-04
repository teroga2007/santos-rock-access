begin;
do $$ declare k text; begin
  foreach k in array array['owner','supervisor','scanner','org','event','draft','cash_request'] loop
    perform set_config('sra_door.'||k,gen_random_uuid()::text,true);
  end loop;
  foreach k in array array['owner','supervisor','scanner'] loop
    insert into auth.users(id,email,invited_at,aud,role) values(current_setting('sra_door.'||k)::uuid,current_setting('sra_door.'||k)||'@example.invalid',now(),'authenticated','authenticated');
  end loop;
  insert into public.organizations(id,name,slug) values(current_setting('sra_door.org')::uuid,'Door fixture','door-'||current_setting('sra_door.org'));
  insert into public.organization_members(organization_id,user_id,role) values
    (current_setting('sra_door.org')::uuid,current_setting('sra_door.owner')::uuid,'owner'),
    (current_setting('sra_door.org')::uuid,current_setting('sra_door.supervisor')::uuid,'member'),
    (current_setting('sra_door.org')::uuid,current_setting('sra_door.scanner')::uuid,'member');
  insert into public.events(id,organization_id,name,starts_at,status) values
    (current_setting('sra_door.event')::uuid,current_setting('sra_door.org')::uuid,'Door fixture',now(),'published'),
    (current_setting('sra_door.draft')::uuid,current_setting('sra_door.org')::uuid,'Draft fixture',now(),'draft');
  insert into public.event_members(event_id,user_id,role) values
    (current_setting('sra_door.event')::uuid,current_setting('sra_door.supervisor')::uuid,'supervisor'),
    (current_setting('sra_door.event')::uuid,current_setting('sra_door.scanner')::uuid,'scanner');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_door.owner'),true);
do $$ declare e uuid:=current_setting('sra_door.event')::uuid; t uuid; bundle uuid; free uuid; r jsonb; v jsonb; k text; begin
  t:=public.save_ticket_type_prices(e,'Día del evento / puerta',16000);
  bundle:=public.save_ticket_type_prices(e,'Fase 1 + transporte',10000,7500);
  free:=public.save_ticket_type_prices(e,'Staff',0,0,'accreditation');
  perform set_config('sra_door.type',t::text,true);
  r:=public.sell_door_ticket(e,t,current_setting('sra_door.cash_request')::uuid,'sra1_'||repeat('J',43),'Cash holder',null,'cash',null,20000,true,16000);
  perform set_config('sra_door.result',r::text,true);
  if (r->>'total_crc')::numeric<>16000 or (r->>'cash_change_crc')::numeric<>4000 then raise exception 'Incorrect cash change'; end if;
  perform public.sell_door_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('L',43),'Card holder',null,'card','CARD-1',null,true,16000);
  perform public.sell_door_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('M',43),'SINPE holder',null,'sinpe','SINPE-1',null,true,16000);
  perform public.sell_door_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('N',43),'Other holder',null,'other','OTHER-1',null,true,16000);
  begin perform public.sell_door_ticket(e,bundle,gen_random_uuid(),'sra1_'||repeat('O',43),'Transport rejected',null,'cash',null,20000,true,10000);
    raise exception 'Transport bundle accepted at door'; exception when invalid_parameter_value then null; end;
  begin perform public.issue_ticket(e,bundle,gen_random_uuid(),'sra1_'||repeat('O',43),'Generic door bundle','door',null,'DOOR-REF');
    raise exception 'Generic issuance sold transport at the door'; exception when invalid_parameter_value then null; end;
  v:=public.get_event_finances(e);
  if (v->'totals'->>'gross_crc')::numeric<>64000 or (v->'totals'->>'admission_crc')::numeric<>64000
    or (v->'totals'->>'transport_crc')::numeric<>0 or (v->'totals'->>'sold')::integer<>4
    or (v->'totals'->>'transport_count')::integer<>0 then raise exception 'Door finance totals incorrect: %',v->'totals'; end if;
  if (select (x->>'gross_crc')::numeric from jsonb_array_elements(v->'payment_methods') x where x->>'method'='cash')<>16000
    or (select sum((x->>'gross_crc')::numeric) from jsonb_array_elements(v->'payment_methods') x)<>64000 then
    raise exception 'Payment method totals incorrect'; end if;
  perform public.save_ticket_type_prices(e,'Día del evento / puerta',17000,0,'admission',null,'general',t);
  r:=public.sell_door_ticket(e,t,current_setting('sra_door.cash_request')::uuid,'sra1_'||repeat('J',43),'Cash holder',null,'cash',null,20000,true,16000);
  if r<>current_setting('sra_door.result')::jsonb or (select count(*) from public.tickets where event_id=e)<>4 then raise exception 'Retry duplicated or changed sale'; end if;
  begin perform public.sell_door_ticket(e,t,current_setting('sra_door.cash_request')::uuid,'sra1_'||repeat('J',43),'Cash holder',null,'cash',null,21000,true,16000);
    raise exception 'Changed cash accepted on retry'; exception when invalid_parameter_value then null; end;
  begin perform public.sell_door_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('O',43),'Stale price',null,'cash',null,20000,true,16000);
    raise exception 'Stale price accepted' using errcode='23514'; exception when raise_exception then null; end;
  begin perform public.sell_door_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('O',43),'No confirmation',null,'cash',null,20000,false,17000);
    raise exception 'Missing payment acknowledgement accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.sell_door_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('O',43),'Insufficient cash',null,'cash',null,100,true,17000);
    raise exception 'Insufficient cash accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.sell_door_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('O',43),'Missing card reference',null,'card',null,null,true,17000);
    raise exception 'Missing reference accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.sell_door_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('O',43),'Cash on card',null,'card','CARD-2',20000,true,17000);
    raise exception 'Card stored cash value'; exception when invalid_parameter_value then null; end;
  begin perform public.sell_door_ticket(e,free,gen_random_uuid(),'sra1_'||repeat('O',43),'Free type',null,'cash',null,20000,true,0);
    raise exception 'Free type used for door sale'; exception when invalid_parameter_value then null; end;
  foreach k in array array['supervisor','scanner'] loop
    perform set_config('request.jwt.claim.sub',current_setting('sra_door.'||k),true);
    begin perform public.sell_door_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('O',43),'Forbidden sale',null,'cash',null,20000,true,17000);
      raise exception 'Unauthorized sale'; exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('request.jwt.claim.sub',current_setting('sra_door.owner'),true);
  t:=public.save_ticket_type_prices(current_setting('sra_door.draft')::uuid,'Draft paid',16000);
  begin perform public.sell_door_ticket(current_setting('sra_door.draft')::uuid,t,gen_random_uuid(),'sra1_'||repeat('O',43),'Draft sale',null,'cash',null,20000,true,16000);
    raise exception 'Draft sale accepted'; exception when check_violation then null; end;
  perform public.set_event_status(e,'live'); perform public.set_event_status(e,'closed');
  r:=public.sell_door_ticket(e,current_setting('sra_door.type')::uuid,current_setting('sra_door.cash_request')::uuid,'sra1_'||repeat('J',43),'Cash holder',null,'cash',null,20000,true,16000);
  if r<>current_setting('sra_door.result')::jsonb then raise exception 'Closed event lost successful retry'; end if;
end; $$;
reset role;
do $$ begin
  if exists(select 1 from public.orders where event_id=current_setting('sra_door.event')::uuid and (source<>'door' or payment_method is null)) then
    raise exception 'Source/payment method lost'; end if;
  if not exists(select 1 from public.orders where event_id=current_setting('sra_door.event')::uuid and payment_method='cash' and cash_received_crc=20000 and cash_change_crc=4000) then
    raise exception 'Cash receipt not persisted'; end if;
end; $$;
select 'door_sales: all assertions passed; rollback follows' as result;
rollback;
