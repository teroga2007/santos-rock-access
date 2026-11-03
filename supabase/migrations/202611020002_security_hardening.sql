-- Santos Rock Access | Migration 002: security hardening
-- Apply after 001. No client write privileges are introduced.
begin;

-- Keep the internal event -> organization lookup unavailable to frontend roles.
revoke execute on function app_private.event_org(uuid) from public, anon, authenticated;

-- Check cross-tenant references, including changes to parent records.
create or replace function app_private.assert_ticket_holder_org()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_event_org uuid; v_holder_org uuid;
begin
  if new.holder_id is null then return new; end if;
  select organization_id into v_event_org from public.events where id = new.event_id;
  select organization_id into v_holder_org from public.ticket_holders where id = new.holder_id;
  if v_event_org is null or v_holder_org is null or v_event_org <> v_holder_org then
    raise exception 'Ticket holder must belong to the event organization' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger ticket_holder_org_guard
before insert or update of event_id, holder_id on public.tickets
for each row execute function app_private.assert_ticket_holder_org();

create or replace function app_private.assert_event_member_org()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.events where id = new.event_id;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = v_org and m.user_id = new.user_id
  ) then
    raise exception 'Event member must belong to the event organization' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger event_member_org_guard
before insert or update of event_id, user_id on public.event_members
for each row execute function app_private.assert_event_member_org();

create or replace function app_private.assert_audit_event_org()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_org uuid;
begin
  if new.event_id is null then return new; end if;
  select organization_id into v_org from public.events where id = new.event_id;
  if v_org is distinct from new.organization_id then
    raise exception 'Audit event organization mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger audit_event_org_guard
before insert or update of event_id, organization_id on public.audit_logs
for each row execute function app_private.assert_audit_event_org();

-- Prevent changing an event's organization after creation.
create or replace function app_private.prevent_event_org_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Event organization is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger event_org_immutable
before update of organization_id on public.events
for each row execute function app_private.prevent_event_org_change();

-- Protect organization ownership of holders, even when referenced by tickets.
create or replace function app_private.prevent_holder_org_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Holder organization is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger holder_org_immutable
before update of organization_id on public.ticket_holders
for each row execute function app_private.prevent_holder_org_change();

-- Prevent removal of org membership while the user retains event assignments.
-- A future membership management RPC must remove event assignments first.
create or replace function app_private.prevent_orphan_event_members()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from public.event_members em
    join public.events e on e.id = em.event_id
    where e.organization_id = old.organization_id and em.user_id = old.user_id
  ) then
    raise exception 'Remove event assignments before organization membership' using errcode = '23514';
  end if;
  return old;
end;
$$;
create trigger org_member_delete_guard
before delete on public.organization_members
for each row execute function app_private.prevent_orphan_event_members();

-- Internal trigger functions do not need client EXECUTE privileges.
revoke all on function app_private.assert_ticket_holder_org() from public, anon, authenticated;
revoke all on function app_private.assert_event_member_org() from public, anon, authenticated;
revoke all on function app_private.assert_audit_event_org() from public, anon, authenticated;
revoke all on function app_private.prevent_event_org_change() from public, anon, authenticated;
revoke all on function app_private.prevent_holder_org_change() from public, anon, authenticated;
revoke all on function app_private.prevent_orphan_event_members() from public, anon, authenticated;

commit;
