-- Run on a disposable local/staging database AFTER migrations 001-005.
-- SQL authorization regression checks, not a replacement for real Auth JWT tests.
-- All fixtures and changes roll back. Execute as the database owner.
begin;
do $$
declare k text; v_id uuid;
begin
  foreach k in array array['owner','scanner','other_user','org','other_org','event','other_event'] loop
    perform set_config('sra_test.' || k, gen_random_uuid()::text, true);
  end loop;
  foreach k in array array['owner','scanner','other_user'] loop
    v_id := current_setting('sra_test.' || k)::uuid;
    insert into auth.users(id,email,invited_at,email_confirmed_at,aud,role)
    values(v_id,v_id::text || '@example.invalid',now(),now(),'authenticated','authenticated');
  end loop;
  insert into public.organizations(id,name,slug) values
    (current_setting('sra_test.org')::uuid,'Test organization','test-' || current_setting('sra_test.org')),
    (current_setting('sra_test.other_org')::uuid,'Other organization','test-' || current_setting('sra_test.other_org'));
  insert into public.organization_members(organization_id,user_id,role) values
    (current_setting('sra_test.org')::uuid,current_setting('sra_test.owner')::uuid,'owner'),
    (current_setting('sra_test.other_org')::uuid,current_setting('sra_test.other_user')::uuid,'owner');
  insert into public.events(id,organization_id,name,starts_at) values
    (current_setting('sra_test.event')::uuid,current_setting('sra_test.org')::uuid,'Visible event',now()),
    (current_setting('sra_test.other_event')::uuid,current_setting('sra_test.other_org')::uuid,'Other event',now());
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('sra_test.owner'), true);
select public.provision_event_member(current_setting('sra_test.event')::uuid,
  current_setting('sra_test.scanner')::uuid,'scanner');
-- Repeated provisioning must preserve owner role and avoid duplicate membership.
select public.provision_event_member(current_setting('sra_test.event')::uuid,
  current_setting('sra_test.owner')::uuid,'scanner');
do $$ begin
  if not exists(select 1 from public.organization_members where user_id = current_setting('sra_test.owner')::uuid and role = 'owner') then
    raise exception 'Provisioning changed owner privileges';
  end if;
  begin
    perform public.add_organization_member(current_setting('sra_test.org')::uuid,current_setting('sra_test.owner')::uuid,'member');
    raise exception 'Owner downgrade unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.provision_event_member(current_setting('sra_test.other_event')::uuid,current_setting('sra_test.scanner')::uuid,'admin');
    raise exception 'Cross-organization provisioning unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.provision_event_member(current_setting('sra_test.event')::uuid,gen_random_uuid(),'scanner');
    raise exception 'Nonexistent account unexpectedly accepted';
  exception when check_violation then null; end;
end; $$;

select set_config('request.jwt.claim.sub', current_setting('sra_test.scanner'), true);
do $$ begin
  if not exists(select 1 from public.organization_members where user_id = (select auth.uid()) and role = 'member') then
    raise exception 'Scanner did not receive basic membership';
  end if;
  if (select count(*) from public.events) <> 1 then
    raise exception 'Scanner event visibility is incorrect';
  end if;
  if exists(select 1 from public.events where id = current_setting('sra_test.other_event')::uuid) then
    raise exception 'Scanner can see another organization event';
  end if;
  begin
    perform public.create_event(current_setting('sra_test.org')::uuid,'Unauthorized event',now());
    raise exception 'Scanner created an event';
  exception when insufficient_privilege then null; end;
  begin
    perform public.provision_event_member(current_setting('sra_test.event')::uuid,current_setting('sra_test.other_user')::uuid,'admin');
    raise exception 'Scanner provisioned another user';
  exception when insufficient_privilege then null; end;
  begin
    perform public.assign_event_member(current_setting('sra_test.event')::uuid,current_setting('sra_test.scanner')::uuid,'admin');
    raise exception 'Scanner promoted itself';
  exception when insufficient_privilege then null; end;
end; $$;

reset role;
do $$ begin
  if not exists(select 1 from public.audit_logs
    where organization_id = current_setting('sra_test.org')::uuid
      and entity_id = current_setting('sra_test.scanner')::uuid and action = 'organization.member_added')
    or not exists(select 1 from public.audit_logs
    where event_id = current_setting('sra_test.event')::uuid
      and entity_id = current_setting('sra_test.scanner')::uuid and action = 'event.member_assigned') then
    raise exception 'Provisioning audit records are missing';
  end if;
end; $$;
rollback;
