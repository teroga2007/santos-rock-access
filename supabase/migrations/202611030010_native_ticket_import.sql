begin;
create table app_private.native_import_requests (
  batch_id uuid primary key references public.import_batches(id), actor_id uuid not null references auth.users(id),
  event_id uuid not null references public.events(id), type_id uuid not null references public.ticket_types(id),
  source public.ticket_source not null, input_digest bytea not null, content_digest bytea not null,
  response jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(),
  unique(event_id,type_id,source,content_digest)
);
revoke all on app_private.native_import_requests from public,anon,authenticated;
create table app_private.native_import_rows (
  batch_id uuid not null references public.import_batches(id), row_number integer not null,
  event_id uuid not null references public.events(id), type_id uuid not null references public.ticket_types(id),
  source public.ticket_source not null, row_digest bytea not null,
  primary key(batch_id,row_number), unique(event_id,type_id,source,row_digest)
);
revoke all on app_private.native_import_rows from public,anon,authenticated;

create function public.import_native_tickets(
  p_event_id uuid,p_type_id uuid,p_source public.ticket_source,p_batch_id uuid,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_input bytea; v_content bytea; v_prior app_private.native_import_requests%rowtype;
  v_row jsonb; v_ticket uuid; v_index integer:=0; v_response jsonb:='[]'::jsonb; v_request uuid; v_row_digest bytea; v_status public.event_status;
begin
  if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then
    raise exception 'Event administrator required' using errcode='42501';
  end if;
  if p_batch_id is null or p_type_id is null or p_source is null or p_source not in ('sinpe','complimentary','other')
    or p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception 'Invalid import input' using errcode='22023';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 100 or octet_length(p_rows::text)>1000000 then
    raise exception 'Import must contain 1 to 100 rows' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r)<>'object') then
    raise exception 'Each import row must be an object' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r
    group by lower(btrim(r->>'name')),lower(btrim(coalesce(r->>'email',''))),btrim(coalesce(r->>'reference','')) having count(*)>1) then
    raise exception 'Duplicate rows in import' using errcode='22023';
  end if;
  v_input:=extensions.digest(jsonb_build_array(p_event_id,p_type_id,p_source,p_rows)::text,'sha256');
  select extensions.digest(jsonb_agg(jsonb_build_array(lower(btrim(r->>'name')),lower(btrim(coalesce(r->>'email',''))),btrim(coalesce(r->>'reference','')))
    order by lower(btrim(r->>'name')),lower(btrim(coalesce(r->>'email',''))),btrim(coalesce(r->>'reference','')))::text,'sha256')
    into v_content from jsonb_array_elements(p_rows) r;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_batch_id::text,0));
  select * into v_prior from app_private.native_import_requests where batch_id=p_batch_id;
  if found then
    if v_prior.actor_id<>(select auth.uid()) or v_prior.input_digest<>v_input then
      raise exception 'Import ID reused with different input' using errcode='22023';
    end if;
    return v_prior.response;
  end if;
  -- Match issue_ticket's lock order before inserting any FK reference to the type.
  select status into v_status from public.events where id=p_event_id for share;
  if v_status in ('closed','cancelled') then raise exception 'Event is closed' using errcode='23514'; end if;
  perform id from public.ticket_types where id=p_type_id and event_id=p_event_id for update;
  if not found then raise exception 'Ticket type does not belong to event' using errcode='23514'; end if;
  -- Reserve this content fingerprint; concurrent duplicate batches cannot both commit.
  insert into public.import_batches(id,event_id,source,imported_by,row_count,status)
  values(p_batch_id,p_event_id,p_source,(select auth.uid()),jsonb_array_length(p_rows),'validated');
  insert into app_private.native_import_requests(batch_id,actor_id,event_id,type_id,source,input_digest,content_digest)
  values(p_batch_id,(select auth.uid()),p_event_id,p_type_id,p_source,v_input,v_content);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_index:=v_index+1;
    if nullif(btrim(v_row->>'email'),'') is not null and btrim(v_row->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception 'Invalid email in import' using errcode='22023';
    end if;
    v_row_digest:=extensions.digest(jsonb_build_array(lower(btrim(v_row->>'name')),lower(btrim(coalesce(v_row->>'email',''))),btrim(coalesce(v_row->>'reference','')))::text,'sha256');
    insert into app_private.native_import_rows(batch_id,row_number,event_id,type_id,source,row_digest)
    values(p_batch_id,v_index,p_event_id,p_type_id,p_source,v_row_digest);
    v_request:=md5('native-import:'||p_batch_id::text||':'||v_index::text)::uuid;
    if exists(select 1 from app_private.issuance_requests where request_id=v_request) then
      raise exception 'Issuance request already exists' using errcode='23505';
    end if;
    v_ticket:=public.issue_ticket(p_event_id,p_type_id,v_request,v_row->>'token',v_row->>'name',p_source,
      nullif(btrim(v_row->>'email'),''),nullif(btrim(v_row->>'reference'),''));
    update public.tickets set import_batch_id=p_batch_id where id=v_ticket;
    v_response:=v_response||jsonb_build_array(jsonb_build_object('row',v_index,'ticket_id',v_ticket));
  end loop;
  update public.import_batches set status='completed' where id=p_batch_id;
  update app_private.native_import_requests set response=v_response where batch_id=p_batch_id;
  insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id,metadata)
  select organization_id,id,(select auth.uid()),'tickets.imported','import_batch',p_batch_id,
    jsonb_build_object('row_count',v_index,'source',p_source,'type_id',p_type_id) from public.events where id=p_event_id;
  return v_response;
end; $$;
revoke all on function public.import_native_tickets(uuid,uuid,public.ticket_source,uuid,jsonb) from public,anon;
grant execute on function public.import_native_tickets(uuid,uuid,public.ticket_source,uuid,jsonb) to authenticated;
commit;
