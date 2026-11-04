-- Transactional authorization checks; all fixtures are rolled back.
begin;
do $$ declare k text; begin
  foreach k in array array['owner','member','outsider','org','other_org'] loop
    perform set_config('sra_names.'||k,gen_random_uuid()::text,true);
  end loop;
  foreach k in array array['owner','member','outsider'] loop
    insert into auth.users(id,email,invited_at,aud,role)
    values(current_setting('sra_names.'||k)::uuid,current_setting('sra_names.'||k)||'@example.invalid',now(),'authenticated','authenticated');
  end loop;
  insert into public.organizations(id,name,slug) values
    (current_setting('sra_names.org')::uuid,'Names test','names-'||current_setting('sra_names.org')),
    (current_setting('sra_names.other_org')::uuid,'Other names test','names-'||current_setting('sra_names.other_org'));
  insert into public.organization_members(organization_id,user_id,role) values
    (current_setting('sra_names.org')::uuid,current_setting('sra_names.owner')::uuid,'owner'),
    (current_setting('sra_names.org')::uuid,current_setting('sra_names.member')::uuid,'member'),
    (current_setting('sra_names.other_org')::uuid,current_setting('sra_names.outsider')::uuid,'owner');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_names.owner'),true);
do $$ begin
  if not exists(select 1 from public.profiles where user_id=current_setting('sra_names.member')::uuid) then raise exception 'Owner cannot read own team'; end if;
  if exists(select 1 from public.profiles where user_id=current_setting('sra_names.outsider')::uuid) then raise exception 'Cross-organization name leak'; end if;
  begin
    update public.profiles set display_name='Changed' where user_id=current_setting('sra_names.member')::uuid;
    raise exception 'Unexpected profile write access';
  exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_names.member'),true);
do $$ begin
  if not exists(select 1 from public.profiles where user_id=current_setting('sra_names.member')::uuid) then raise exception 'Self profile unavailable'; end if;
  if exists(select 1 from public.profiles where user_id in (current_setting('sra_names.owner')::uuid,current_setting('sra_names.outsider')::uuid)) then raise exception 'Member can read other profiles'; end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_names.outsider'),true);
do $$ begin
  if exists(select 1 from public.profiles where user_id in (current_setting('sra_names.owner')::uuid,current_setting('sra_names.member')::uuid)) then raise exception 'Other owner can read foreign team'; end if;
end; $$;
rollback;
