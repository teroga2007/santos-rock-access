-- Santos Rock Access | 003: invitation-only identity + controlled event administration
-- Requires 001 and 002. No public self-registration or self-assignment of roles.
begin;

-- Default privileges are not relied on for newly created privileged functions.
create or replace function app_private.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 160), ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function app_private.create_profile_for_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_sra on auth.users;
create trigger on_auth_user_created_sra
  after insert on auth.users for each row
  execute function app_private.create_profile_for_auth_user();

-- Backfill profiles for existing Auth users; no membership or privileges are granted.
insert into public.profiles (user_id, display_name)
select id, coalesce(left(nullif(btrim(raw_user_meta_data ->> 'display_name'), ''), 160), '')
from auth.users on conflict (user_id) do nothing;

-- This RPC is exposed via PostgREST. It trusts auth.uid(), never a caller-supplied actor ID.
create or replace function public.create_event(
  p_organization_id uuid,
  p_name text,
  p_starts_at timestamptz,
  p_venue text default null,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_event_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not app_private.is_org_admin(p_organization_id) then
    raise exception 'Not authorized to create events' using errcode = '42501';
  end if;
  insert into public.events(organization_id, name, starts_at, venue, ends_at)
  values (p_organization_id, p_name, p_starts_at, p_venue, p_ends_at)
  returning id into v_event_id;
  insert into public.audit_logs(organization_id, event_id, actor_id, action, entity_type, entity_id)
  values (p_organization_id, v_event_id, (select auth.uid()), 'event.created', 'event', v_event_id);
  return v_event_id;
end;
$$;
revoke all on function public.create_event(uuid,text,timestamptz,text,timestamptz) from public, anon;
grant execute on function public.create_event(uuid,text,timestamptz,text,timestamptz) to authenticated;

-- Only organization owners/admins may assign event access, and the assignee
-- must already be an organization member (enforced also by migration 002 trigger).
create or replace function public.assign_event_member(
  p_event_id uuid,
  p_user_id uuid,
  p_role public.event_role
)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select organization_id into v_org from public.events where id = p_event_id;
  if v_org is null or not app_private.is_org_admin(v_org) then
    raise exception 'Not authorized to manage event members' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_members
                 where organization_id = v_org and user_id = p_user_id) then
    raise exception 'User must belong to organization' using errcode = '23514';
  end if;
  insert into public.event_members(event_id, user_id, role)
  values (p_event_id, p_user_id, p_role)
  on conflict (event_id, user_id) do update set role = excluded.role;
  insert into public.audit_logs(organization_id, event_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, p_event_id, (select auth.uid()), 'event.member_assigned', 'user', p_user_id,
          jsonb_build_object('role', p_role::text));
end;
$$;
revoke all on function public.assign_event_member(uuid,uuid,public.event_role) from public, anon;
grant execute on function public.assign_event_member(uuid,uuid,public.event_role) to authenticated;

-- Only organization owners may add organization members through this RPC.
-- A separate trusted backend must invite/create the Auth user first.
create or replace function public.add_organization_member(
  p_organization_id uuid,
  p_user_id uuid,
  p_role public.org_role default 'admin'
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
      and user_id = (select auth.uid()) and role = 'owner'
  ) then
    raise exception 'Organization owner required' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'Owner transfers require a separate controlled workflow' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Auth user does not exist' using errcode = '23503';
  end if;
  insert into public.organization_members(organization_id,user_id,role)
  values (p_organization_id,p_user_id,p_role)
  on conflict (organization_id,user_id) do update set role = excluded.role;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values (p_organization_id,(select auth.uid()),'organization.member_added','user',p_user_id,
          jsonb_build_object('role',p_role::text));
end;
$$;
revoke all on function public.add_organization_member(uuid,uuid,public.org_role) from public, anon;
grant execute on function public.add_organization_member(uuid,uuid,public.org_role) to authenticated;

commit;
