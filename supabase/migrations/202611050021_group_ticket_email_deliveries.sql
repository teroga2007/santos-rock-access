begin;
alter table public.ticket_email_jobs add column delivery_id uuid not null default gen_random_uuid();
create index ticket_email_delivery_idx on public.ticket_email_jobs(delivery_id,status);
create or replace function public.queue_ticket_emails(p_actor_id uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; t public.tickets%rowtype; recipient_email text; digest bytea; job public.ticket_email_jobs%rowtype;
 result jsonb:='[]'::jsonb; groups jsonb:='{}'; group_key text; delivery uuid;
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
  group_key:=t.event_id::text||':'||lower(recipient_email);
  if groups->>group_key is null then groups:=groups||jsonb_build_object(group_key,gen_random_uuid()::text); end if;
  delivery:=(groups->>group_key)::uuid;
  insert into public.ticket_email_jobs(event_id,ticket_id,queued_by,recipient,credential_digest,encrypted_token,delivery_id)
   values(t.event_id,t.id,p_actor_id,recipient_email,digest,item->>'encrypted_token',delivery)
   on conflict(ticket_id,credential_digest,recipient) do nothing returning * into job;
  if found then
   insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id)
   select organization_id,id,p_actor_id,'ticket.email_queued','email_job',job.id from public.events where id=t.event_id;
  else select * into job from public.ticket_email_jobs j where j.ticket_id=t.id and j.credential_digest=digest and j.recipient=recipient_email;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',job.id,'status',job.status,'ticket_id',job.ticket_id,'delivery_id',job.delivery_id));
 end loop;
 return result;
end; $$;


create function public.claim_ticket_email_deliveries(p_daily_limit integer default 80,p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare day_utc date:=(clock_timestamp() at time zone 'UTC')::date; used integer; j public.ticket_email_jobs%rowtype;
 claimed jsonb:='[]'::jsonb; lease uuid; d record; g record;
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
 for d in select delivery_id,min(created_at) as first_at from public.ticket_email_jobs where status='pending' group by delivery_id order by first_at,delivery_id limit least(p_limit,greatest(0,p_daily_limit-used)) loop
  lease:=gen_random_uuid();
  for g in update public.ticket_email_jobs set status='processing',claimed_at=now(),lease_id=lease,attempts=attempts+1 where delivery_id=d.delivery_id and status='pending' returning id loop
   claimed:=claimed||jsonb_build_array(jsonb_build_object('id',g.id,'lease_id',lease,'delivery_id',d.delivery_id));
  end loop;
  used:=used+1;
 end loop;
 update app_private.email_daily_budget set reserved=used where day=day_utc;
 return claimed;
end; $$;


create function public.get_claimed_ticket_email_delivery(p_delivery_id uuid,p_lease_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(data order by id) filter(where data is not null),'[]'::jsonb) from (
  select j.id,public.get_claimed_ticket_email(j.id,p_lease_id) as data from public.ticket_email_jobs j
  where j.delivery_id=p_delivery_id and j.lease_id=p_lease_id and j.status='processing'
 ) jobs;
$$;
create function public.finish_ticket_email_delivery(p_delivery_id uuid,p_lease_id uuid,p_job_ids uuid[],p_status text,p_provider_id text default null,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare j record;
begin
 if p_status is null or p_status not in ('submitted','failed','unknown','cancelled') or p_job_ids is null then raise exception 'Invalid delivery result' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_job_ids) id where not exists(select 1 from public.ticket_email_jobs q where q.id=id and q.delivery_id=p_delivery_id and q.lease_id=p_lease_id)) then raise exception 'Delivery mismatch' using errcode='22023'; end if;
 for j in select id from public.ticket_email_jobs where delivery_id=p_delivery_id and lease_id=p_lease_id and status='processing' for update loop
  perform public.finish_ticket_email(j.id,p_lease_id,case when j.id=any(p_job_ids) then p_status else 'cancelled' end,case when j.id=any(p_job_ids) then p_provider_id else null end,case when j.id=any(p_job_ids) then p_error else 'ticket_no_longer_sendable' end);
 end loop;
end; $$;
revoke all on function public.get_claimed_ticket_email_delivery(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_ticket_email_delivery(uuid,uuid,uuid[],text,text,text) from public,anon,authenticated;
grant execute on function public.get_claimed_ticket_email_delivery(uuid,uuid) to service_role;
grant execute on function public.finish_ticket_email_delivery(uuid,uuid,uuid[],text,text,text) to service_role;
create function public.list_event_email_deliveries(p_event_id uuid,p_limit integer default 20,p_offset integer default 0,p_sort_by text default 'created_at',p_ascending boolean default false)
returns table(id uuid,recipient text,status text,attempts integer,created_at timestamptz,last_error text,ticket_count bigint,cancelled_count bigint)
language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then raise exception 'Event administrator required' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 or p_sort_by is null or p_sort_by not in ('recipient','status','attempts','created_at') or p_ascending is null then raise exception 'Invalid sorting' using errcode='22023'; end if;
 return query with deliveries as (
 select j.delivery_id as id,min(j.recipient) as recipient,
 case when bool_or(j.status='unknown') then 'unknown' when bool_or(j.status='processing') then 'processing' when bool_or(j.status='pending') then 'pending' when bool_or(j.status='failed') then 'failed' when bool_or(j.status='submitted') then 'submitted' else 'cancelled' end as status,
 max(j.attempts) as attempts,min(j.created_at) as created_at,max(j.last_error) as last_error,count(*) as ticket_count,count(*) filter(where j.status='cancelled') as cancelled_count
 from public.ticket_email_jobs j where j.event_id=p_event_id group by j.delivery_id
 ) select d.id,d.recipient,d.status,d.attempts,d.created_at,d.last_error,d.ticket_count,d.cancelled_count from deliveries d
 order by
 case when p_ascending and p_sort_by='recipient' then lower(d.recipient) when p_ascending and p_sort_by='status' then d.status end collate "es-x-icu" asc nulls last,
 case when not p_ascending and p_sort_by='recipient' then lower(d.recipient) when not p_ascending and p_sort_by='status' then d.status end collate "es-x-icu" desc nulls last,
 case when p_ascending and p_sort_by='attempts' then d.attempts end asc,
 case when not p_ascending and p_sort_by='attempts' then d.attempts end desc,
 case when p_ascending and p_sort_by='created_at' then d.created_at end asc,
 case when not p_ascending and p_sort_by='created_at' then d.created_at end desc,d.id asc limit p_limit offset p_offset;
end; $$;
create function public.retry_ticket_email_delivery(p_delivery_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare j record;
begin
 for j in select id,event_id,status from public.ticket_email_jobs where delivery_id=p_delivery_id order by id for update loop
  if not app_private.can_manage_event(j.event_id) or (select auth.uid()) is null then raise exception 'Event administrator required' using errcode='42501'; end if;
  if j.status='failed' then perform public.retry_ticket_email(j.id); end if;
 end loop;
end; $$;
revoke all on function public.list_event_email_deliveries(uuid,integer,integer,text,boolean) from public,anon;
revoke all on function public.retry_ticket_email_delivery(uuid) from public,anon;
grant execute on function public.list_event_email_deliveries(uuid,integer,integer,text,boolean) to authenticated;
grant execute on function public.retry_ticket_email_delivery(uuid) to authenticated;
revoke all on function public.claim_ticket_email_deliveries(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_ticket_email_deliveries(integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
