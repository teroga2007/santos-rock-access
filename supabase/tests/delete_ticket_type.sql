begin;
do $$ declare k text; begin
  foreach k in array array['owner','supervisor','admin','org','event','other'] loop
    perform set_config('sra_type_delete.'||k,gen_random_uuid()::text,true);
  end loop;
  foreach k in array array['owner','supervisor','admin'] loop
    insert into auth.users(id,email,invited_at,aud,role) values(current_setting('sra_type_delete.'||k)::uuid,current_setting('sra_type_delete.'||k)||'@example.invalid',now(),'authenticated','authenticated');
  end loop;
  insert into public.organizations(id,name,slug) values(current_setting('sra_type_delete.org')::uuid,'Type deletion fixture','type-delete-'||current_setting('sra_type_delete.org'));
  insert into public.organization_members(organization_id,user_id,role) values
    (current_setting('sra_type_delete.org')::uuid,current_setting('sra_type_delete.owner')::uuid,'owner'),
    (current_setting('sra_type_delete.org')::uuid,current_setting('sra_type_delete.supervisor')::uuid,'member'),
    (current_setting('sra_type_delete.org')::uuid,current_setting('sra_type_delete.admin')::uuid,'member');
  insert into public.events(id,organization_id,name,starts_at) values
    (current_setting('sra_type_delete.event')::uuid,current_setting('sra_type_delete.org')::uuid,'Type deletion fixture',now()),
    (current_setting('sra_type_delete.other')::uuid,current_setting('sra_type_delete.org')::uuid,'Other fixture',now());
  insert into public.event_members(event_id,user_id,role) values
    (current_setting('sra_type_delete.event')::uuid,current_setting('sra_type_delete.supervisor')::uuid,'supervisor'),
    (current_setting('sra_type_delete.event')::uuid,current_setting('sra_type_delete.admin')::uuid,'admin');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_type_delete.owner'),true);
do $$ declare e uuid:=current_setting('sra_type_delete.event')::uuid; unused uuid; used uuid; ticket uuid; begin
  unused:=public.save_ticket_type_prices(e,'Unused tariff',10000);
  used:=public.save_ticket_type_prices(e,'Used tariff',0,0,'accreditation');
  ticket:=public.issue_ticket(e,used,gen_random_uuid(),'sra1_'||repeat('Z',43),'Fixture holder');
  begin perform public.delete_ticket_type(e,used,'Used tariff'); raise exception 'Used type deleted'; exception when foreign_key_violation then null; end;
  perform public.manage_ticket_credential(ticket,'void',gen_random_uuid(),'Fixture void');
  begin perform public.delete_ticket_type(e,used,'Used tariff'); raise exception 'Voided history deleted'; exception when foreign_key_violation then null; end;
  begin perform public.delete_ticket_type(e,unused,'Wrong name'); raise exception 'Name check bypassed'; exception when invalid_parameter_value then null; end;
  perform public.delete_ticket_type(current_setting('sra_type_delete.other')::uuid,unused,'Unused tariff');
  if not exists(select 1 from public.ticket_types where id=unused) then raise exception 'Type deleted across event boundary'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('sra_type_delete.supervisor'),true);
  begin perform public.delete_ticket_type(e,unused,'Unused tariff'); raise exception 'Supervisor deleted type'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',current_setting('sra_type_delete.admin'),true);
  if public.delete_ticket_type(e,unused,'Unused tariff')<>unused then raise exception 'Admin deletion failed'; end if;
  if public.delete_ticket_type(e,unused,'Unused tariff')<>unused then raise exception 'Deletion retry failed'; end if;
  if exists(select 1 from public.ticket_types where id=unused) or not exists(select 1 from public.ticket_types where id=used)
    or not exists(select 1 from public.list_event_tickets(e) where id=ticket) then raise exception 'Incorrect remaining records'; end if;
  perform set_config('sra_type_delete.deleted',unused::text,true);
end; $$;
reset role;
do $$ begin
  if (select count(*) from public.audit_logs where action='ticket_type.deleted' and entity_id=current_setting('sra_type_delete.deleted')::uuid)<>1 then
    raise exception 'Missing or duplicated deletion audit'; end if;
end; $$;
select 'delete_ticket_type: all assertions passed; rollback follows' as result;
rollback;
