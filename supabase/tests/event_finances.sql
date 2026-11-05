begin;
do $$ declare k text; u uuid; begin
  foreach k in array array['owner','supervisor','scanner','admin','outside','org','other_org','event','empty_event','outside_event'] loop
    perform set_config('sra_fin.'||k,gen_random_uuid()::text,true);
  end loop;
  foreach k in array array['owner','supervisor','scanner','admin','outside'] loop
    u:=current_setting('sra_fin.'||k)::uuid;
    insert into auth.users(id,email,invited_at,aud,role) values(u,u::text||'@example.invalid',now(),'authenticated','authenticated');
  end loop;
  insert into public.organizations(id,name,slug) values
    (current_setting('sra_fin.org')::uuid,'Finance fixture','finance-'||current_setting('sra_fin.org')),
    (current_setting('sra_fin.other_org')::uuid,'Outside fixture','outside-'||current_setting('sra_fin.other_org'));
  insert into public.organization_members(organization_id,user_id,role) values
    (current_setting('sra_fin.org')::uuid,current_setting('sra_fin.owner')::uuid,'owner'),
    (current_setting('sra_fin.org')::uuid,current_setting('sra_fin.admin')::uuid,'admin'),
    (current_setting('sra_fin.org')::uuid,current_setting('sra_fin.supervisor')::uuid,'member'),
    (current_setting('sra_fin.org')::uuid,current_setting('sra_fin.scanner')::uuid,'member'),
    (current_setting('sra_fin.other_org')::uuid,current_setting('sra_fin.outside')::uuid,'owner');
  insert into public.events(id,organization_id,name,starts_at,status) values
    (current_setting('sra_fin.event')::uuid,current_setting('sra_fin.org')::uuid,'Finance fixture',now(),'live'),
    (current_setting('sra_fin.empty_event')::uuid,current_setting('sra_fin.org')::uuid,'Empty fixture',now(),'draft'),
    (current_setting('sra_fin.outside_event')::uuid,current_setting('sra_fin.other_org')::uuid,'Outside fixture',now(),'draft');
  insert into public.event_members(event_id,user_id,role) values
    (current_setting('sra_fin.event')::uuid,current_setting('sra_fin.supervisor')::uuid,'supervisor'),
    (current_setting('sra_fin.event')::uuid,current_setting('sra_fin.scanner')::uuid,'scanner');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_fin.owner'),true);
do $$ declare e uuid:=current_setting('sra_fin.event')::uuid; t uuid; ticket uuid; k integer;
begin
  perform public.configure_event_ticket_prices(e);
  select id into t from public.ticket_types where event_id=e and name='Fase 1 + transporte';
  perform set_config('sra_fin.type',t::text,true);
  for k in 1..6 loop
    ticket:=public.issue_priced_ticket(e,t,gen_random_uuid(),'sra1_'||repeat(chr(64+k),43),'Finance holder '||k,
      case when k in (2,6) then 'other'::public.ticket_source else 'sinpe'::public.ticket_source end,
      null,'FIN-'||k,10000,7500);
    perform set_config('sra_fin.ticket'||k,ticket::text,true);
  end loop;
  perform public.manage_ticket_credential(current_setting('sra_fin.ticket6')::uuid,'void',gen_random_uuid(),'Void without refund');
  select id into t from public.ticket_types where event_id=e and name='Fase 2';
  perform set_config('sra_fin.phase2',t::text,true);
  ticket:=public.issue_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('G',43),'Phase two','sinpe',null,'FIN-7');
  perform set_config('sra_fin.admitted',ticket::text,true);
  select id into t from public.ticket_types where event_id=e and name='Staff';
  perform public.issue_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('H',43),'Staff holder');
  t:=public.create_ticket_type(e,'Historical unknown');
  perform public.issue_ticket(e,t,gen_random_uuid(),'sra1_'||repeat('I',43),'Unknown holder');
  -- Current tariffs must not affect the financial report.
  perform public.save_ticket_type_prices(e,'Fase 1 + transporte',12000,8000,'admission',null,'general',current_setting('sra_fin.type')::uuid);
end; $$;
reset role;
update public.orders set payment_status='pending' where id=(select order_id from public.tickets where id=current_setting('sra_fin.ticket3')::uuid);
update public.orders set payment_status='refunded' where id=(select order_id from public.tickets where id=current_setting('sra_fin.ticket4')::uuid);
update public.orders set payment_status='cancelled' where id=(select order_id from public.tickets where id=current_setting('sra_fin.ticket5')::uuid);
update public.tickets set issued_at='2026-11-03 18:00:00+00' where event_id=current_setting('sra_fin.event')::uuid;
update public.tickets set issued_at='2026-11-03 05:59:59+00' where id=current_setting('sra_fin.ticket1')::uuid;
update public.tickets set status='redeemed',redeemed_at=now() where id=current_setting('sra_fin.admitted')::uuid;
set local role authenticated;
do $$ declare e uuid:=current_setting('sra_fin.event')::uuid; r jsonb; v jsonb; k text; begin
  r:=public.get_event_finances(e); v:=r->'totals';
  if (v->>'gross_crc')::numeric<>66000 or (v->>'admission_crc')::numeric<>43500
    or (v->>'transport_crc')::numeric<>22500 or (v->>'sold')::integer<>4
    or (v->>'transport_count')::integer<>3 or (v->>'free')::integer<>1
    or (v->>'without_amount')::integer<>1 or (v->>'issued')::integer<>9
    or (v->>'admitted')::integer<>1 or (v->>'pending')::integer<>7
    or (v->>'voided')::integer<>1 or (v->>'voided_paid')::integer<>1
    or (v->>'unverified')::integer<>1 or (v->>'refunded')::integer<>1 or (v->>'cancelled')::integer<>1 then
    raise exception 'Incorrect financial totals: %',v; end if;
  if (select sum((x->>'gross_crc')::numeric) from jsonb_array_elements(r->'breakdown') x)<>66000
    or (select sum((x->>'gross_crc')::numeric) from jsonb_array_elements(r->'sources') x)<>66000 then
    raise exception 'Breakdown double-counts or disagrees with totals'; end if;
  if (public.get_event_finances(e,'2026-11-02','2026-11-02')->'totals'->>'gross_crc')::numeric<>17500
    or (public.get_event_finances(e,'2026-11-03','2026-11-03')->'totals'->>'gross_crc')::numeric<>48500 then
    raise exception 'Costa Rica date boundaries incorrect'; end if;
  if (public.get_event_finances(e,null,null,current_setting('sra_fin.phase2')::uuid)->'totals'->>'gross_crc')::numeric<>13500
    or (public.get_event_finances(e,null,null,null,'other')->'totals'->>'gross_crc')::numeric<>35000 then
    raise exception 'Type/source filter incorrect'; end if;
  if (public.get_event_finances(current_setting('sra_fin.empty_event')::uuid)->'totals'->>'gross_crc')::numeric<>0 then
    raise exception 'Empty event is not zero'; end if;
  begin perform public.get_event_finances(e,'2026-11-04','2026-11-03');
    raise exception 'Invalid date range accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.get_event_finances(current_setting('sra_fin.empty_event')::uuid,null,null,current_setting('sra_fin.type')::uuid);
    raise exception 'Cross-event type accepted'; exception when invalid_parameter_value then null; end;
  foreach k in array array['scanner','admin','outside'] loop
    perform set_config('request.jwt.claim.sub',current_setting('sra_fin.'||k),true);
    begin perform public.get_event_finances(e); raise exception 'Unauthorized finance access: %',k;
    exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('request.jwt.claim.sub',current_setting('sra_fin.supervisor'),true);
  if (public.get_event_finances(e)->'totals'->>'gross_crc')::numeric<>66000 then raise exception 'Supervisor access failed'; end if;
  begin perform public.get_event_finances(current_setting('sra_fin.outside_event')::uuid);
    raise exception 'Supervisor read another organization'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
select 'event_finances: all assertions passed; rollback follows' as result;
rollback;
