-- Commit the enum change before using it in migration 005.
begin;
alter type public.org_role add value if not exists 'member';
commit;
