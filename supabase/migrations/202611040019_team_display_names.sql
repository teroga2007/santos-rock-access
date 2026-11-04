-- Organization administrators may see names of their own organization members.
-- Existing self-read policy remains; no write privileges are added.
begin;
create policy profile_team_select on public.profiles for select to authenticated
using (exists (
  select 1 from public.organization_members m
  where m.user_id = profiles.user_id and app_private.is_org_admin(m.organization_id)
));
commit;
