begin;

-- Keep owner management separate; default new memberships to least privilege.
create or replace function public.add_organization_member(
  p_organization_id uuid, p_user_id uuid, p_role public.org_role default 'member'
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = (select auth.uid()) and role = 'owner'
  ) then
    raise exception 'Organization owner required' using errcode = '42501';
  end if;
  if p_role is null or p_role = 'owner' then
    raise exception 'Owner transfers require a separate controlled workflow' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Auth user does not exist' using errcode = '23503';
  end if;
  insert into public.organization_members(organization_id,user_id,role)
  values(p_organization_id,p_user_id,p_role)
  on conflict (organization_id,user_id) do update set role = excluded.role
    where public.organization_members.role <> 'owner';
  if not found then
    raise exception 'Owner memberships cannot be changed here' using errcode = '42501';
  end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,(select auth.uid()),'organization.member_added','user',p_user_id,
    jsonb_build_object('role',p_role::text));
end;
$$;
revoke all on function public.add_organization_member(uuid,uuid,public.org_role) from public,anon;
grant execute on function public.add_organization_member(uuid,uuid,public.org_role) to authenticated;

-- Add an existing invited account and its event assignment atomically.
-- This endpoint cannot promote an organization member to organization admin.
create or replace function public.provision_event_member(
  p_event_id uuid, p_user_id uuid, p_role public.event_role
) returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select organization_id into v_org from public.events where id = p_event_id;
  if v_org is null or not app_private.is_org_admin(v_org) then
    raise exception 'Organization administrator required' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'Event role required' using errcode = '23514';
  end if;
  if not exists(select 1 from auth.users where id = p_user_id and invited_at is not null) then
    raise exception 'An existing invited account is required' using errcode = '23514';
  end if;
  insert into public.organization_members(organization_id,user_id,role)
  values(v_org,p_user_id,'member') on conflict (organization_id,user_id) do nothing;
  if found then
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(v_org,(select auth.uid()),'organization.member_added','user',p_user_id,
      jsonb_build_object('role','member'));
  end if;
  perform public.assign_event_member(p_event_id,p_user_id,p_role);
end;
$$;
revoke all on function public.provision_event_member(uuid,uuid,public.event_role) from public,anon;
grant execute on function public.provision_event_member(uuid,uuid,public.event_role) to authenticated;
commit;
