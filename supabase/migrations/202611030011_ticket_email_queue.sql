begin;
create table public.ticket_email_jobs (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id),
 ticket_id uuid not null references public.tickets(id), queued_by uuid not null references auth.users(id),
 recipient text not null, credential_digest bytea not null, encrypted_token text,
 status text not null default 'pending' check(status in ('pending','processing','submitted','failed','unknown','cancelled')),
 attempts integer not null default 0, created_at timestamptz not null default now(), claimed_at timestamptz,
 submitted_at timestamptz, lease_id uuid, provider_id text, last_error text,
 unique(ticket_id,credential_digest,recipient)
);
alter table public.ticket_email_jobs enable row level security;
revoke all on public.ticket_email_jobs from public,anon,authenticated;
grant all on public.ticket_email_jobs to service_role;
grant select(id,event_id,ticket_id,recipient,status,attempts,created_at,submitted_at,last_error) on public.ticket_email_jobs to authenticated;
create policy ticket_email_read on public.ticket_email_jobs for select to authenticated using(app_private.can_manage_event(event_id));
create index ticket_email_pending_idx on public.ticket_email_jobs(status,created_at);
create index ticket_email_event_idx on public.ticket_email_jobs(event_id,created_at desc);
create table app_private.email_daily_budget(day date primary key, reserved integer not null default 0);
revoke all on app_private.email_daily_budget from public,anon,authenticated;

create function app_private.actor_manages_event(p_actor uuid,p_event uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.events e where e.id=p_event and (
   exists(select 1 from public.organization_members m where m.organization_id=e.organization_id and m.user_id=p_actor and m.role in ('owner','admin'))
   or exists(select 1 from public.event_members m where m.event_id=e.id and m.user_id=p_actor and m.role='admin')));
$$;
revoke all on function app_private.actor_manages_event(uuid,uuid) from public,anon,authenticated;

-- Only the trusted server may submit actor IDs and AES-encrypted credentials.
create function public.queue_ticket_emails(p_actor_id uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; t public.tickets%rowtype; recipient_email text; digest bytea; job public.ticket_email_jobs%rowtype;
 result jsonb:='[]'::jsonb;
begin
 if p_actor_id is null or p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Invalid queue input' using errcode='22023'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Invalid queue size' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select * into t from public.tickets where id=(item->>'ticket_id')::uuid;
  if not found or not app_private.actor_manages_event(p_actor_id,t.event_id) then raise exception 'Event administrator required' using errcode='42501'; end if;
  if t.status<>'issued' or exists(select 1 from public.events where id=t.event_id and status in ('closed','cancelled')) then
   raise exception 'Unused ticket and open event required' using errcode='23514'; end if;
  select email into recipient_email from public.ticket_holders where id=t.holder_id;
  if recipient_email is null or length(recipient_email)>254 or recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
   raise exception 'Ticket holder email required' using errcode='22023'; end if;
  if item->>'token' is null or item->>'token' !~ '^sra1_[A-Za-z0-9_-]{43}$'
   or item->>'encrypted_token' is null or length(item->>'encrypted_token') not between 50 and 2000 then
   raise exception 'Invalid credential envelope' using errcode='22023'; end if;
  digest:=extensions.digest(item->>'token','sha256');
  if not exists(select 1 from public.ticket_credentials c where c.ticket_id=t.id and c.token_digest=digest and c.credential_kind='native' and c.revoked_at is null) then
   raise exception 'Current native credential required' using errcode='23514'; end if;
  insert into public.ticket_email_jobs(event_id,ticket_id,queued_by,recipient,credential_digest,encrypted_token)
   values(t.event_id,t.id,p_actor_id,recipient_email,digest,item->>'encrypted_token')
   on conflict(ticket_id,credential_digest,recipient) do nothing returning * into job;
  if found then
   insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id)
   select organization_id,id,p_actor_id,'ticket.email_queued','email_job',job.id from public.events where id=t.event_id;
  else select * into job from public.ticket_email_jobs j where j.ticket_id=t.id and j.credential_digest=digest and j.recipient=recipient_email;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',job.id,'status',job.status,'ticket_id',job.ticket_id));
 end loop;
 return result;
end; $$;

create function public.claim_ticket_emails(p_daily_limit integer default 80,p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare day_utc date:=(clock_timestamp() at time zone 'UTC')::date; used integer; j public.ticket_email_jobs%rowtype;
 claimed jsonb:='[]'::jsonb; lease uuid;
begin
 if p_daily_limit not between 1 and 250 or p_limit not between 1 and 5 or p_daily_limit is null or p_limit is null then
  raise exception 'Invalid email budget' using errcode='22023'; end if;
 -- Do not automatically resend jobs whose provider acceptance is uncertain.
 update public.ticket_email_jobs set status='unknown',encrypted_token=null,last_error='worker_interrupted'
  where status='processing' and claimed_at<now()-interval '15 minutes';
 update public.ticket_email_jobs q set status='cancelled',encrypted_token=null,last_error='ticket_no_longer_sendable'
 where q.status='pending' and not exists(
  select 1 from public.tickets t join public.events e on e.id=t.event_id join public.ticket_holders h on h.id=t.holder_id
  join public.ticket_credentials c on c.ticket_id=t.id and c.token_digest=q.credential_digest
  where t.id=q.ticket_id and t.status='issued' and e.status not in ('closed','cancelled')
   and h.email=q.recipient and c.revoked_at is null and app_private.actor_manages_event(q.queued_by,q.event_id));
 insert into app_private.email_daily_budget(day) values(day_utc) on conflict do nothing;
 select reserved into used from app_private.email_daily_budget where day=day_utc for update;
 for j in select * from public.ticket_email_jobs where status='pending' order by created_at,id for update skip locked limit least(p_limit,greatest(0,p_daily_limit-used)) loop
  lease:=gen_random_uuid();
  update public.ticket_email_jobs set status='processing',claimed_at=now(),lease_id=lease,attempts=attempts+1 where id=j.id;
  claimed:=claimed||jsonb_build_array(jsonb_build_object('id',j.id,'lease_id',lease));
  used:=used+1;
 end loop;
 update app_private.email_daily_budget set reserved=used where day=day_utc;
 return claimed;
end; $$;

create function public.get_claimed_ticket_email(p_job_id uuid,p_lease_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',j.id,'ticket_id',t.id,'recipient',j.recipient,'encrypted_token',j.encrypted_token,
  'holder_name',h.full_name,'event_name',e.name,'venue',e.venue,'starts_at',e.starts_at,'timezone',e.timezone,'type_name',tt.name,'access_zone',tt.access_zone)
 from public.ticket_email_jobs j join public.tickets t on t.id=j.ticket_id join public.events e on e.id=t.event_id
 join public.ticket_types tt on tt.id=t.type_id join public.ticket_holders h on h.id=t.holder_id
 where j.id=p_job_id and j.lease_id=p_lease_id and j.status='processing' and t.status='issued'
 and e.status not in ('closed','cancelled') and h.email=j.recipient and app_private.actor_manages_event(j.queued_by,j.event_id)
 and exists(select 1 from public.ticket_credentials c where c.ticket_id=t.id and c.token_digest=j.credential_digest and c.revoked_at is null);
$$;

create function public.finish_ticket_email(p_job_id uuid,p_lease_id uuid,p_status text,p_provider_id text default null,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare j public.ticket_email_jobs%rowtype;
begin
 if p_status is null or p_status not in ('submitted','failed','unknown','cancelled') then raise exception 'Invalid mail result' using errcode='22023'; end if;
 update public.ticket_email_jobs set status=p_status,provider_id=left(p_provider_id,200),last_error=left(p_error,100),
  submitted_at=case when p_status='submitted' then now() else null end,
  encrypted_token=case when p_status='failed' then encrypted_token else null end
  where id=p_job_id and lease_id=p_lease_id and status='processing' returning * into j;
 if found then insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id,metadata)
  select organization_id,id,j.queued_by,'ticket.email_'||p_status,'email_job',j.id,jsonb_build_object('provider_id',j.provider_id,'error',j.last_error)
  from public.events where id=j.event_id; end if;
end; $$;

create function public.retry_ticket_email(p_job_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare j public.ticket_email_jobs%rowtype;
begin
 select * into j from public.ticket_email_jobs where id=p_job_id for update;
 if (select auth.uid()) is null or not found or not app_private.can_manage_event(j.event_id) then raise exception 'Event administrator required' using errcode='42501'; end if;
 if j.status<>'failed' or j.encrypted_token is null then raise exception 'Only rejected messages may be retried' using errcode='23514'; end if;
 update public.ticket_email_jobs set status='pending',last_error=null where id=j.id;
 insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id)
 select organization_id,id,(select auth.uid()),'ticket.email_retried','email_job',j.id from public.events where id=j.event_id;
end; $$;
revoke all on function public.queue_ticket_emails(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.claim_ticket_emails(integer,integer) from public,anon,authenticated;
revoke all on function public.get_claimed_ticket_email(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_ticket_email(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.queue_ticket_emails(uuid,jsonb) to service_role;
grant execute on function public.claim_ticket_emails(integer,integer) to service_role;
grant execute on function public.get_claimed_ticket_email(uuid,uuid) to service_role;
grant execute on function public.finish_ticket_email(uuid,uuid,text,text,text) to service_role;
revoke all on function public.retry_ticket_email(uuid) from public,anon;
grant execute on function public.retry_ticket_email(uuid) to authenticated;
commit;
