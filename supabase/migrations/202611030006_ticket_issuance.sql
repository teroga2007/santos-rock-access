begin;
create table app_private.issuance_requests (
  request_id uuid primary key, actor_id uuid not null references auth.users(id),
  input_digest bytea not null, ticket_id uuid not null references public.tickets(id),
  created_at timestamptz not null default now()
);
revoke all on app_private.issuance_requests from public,anon,authenticated;

create function public.create_ticket_type(p_event_id uuid,p_name text,p_capacity integer default null,p_access_zone text default 'general')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status public.event_status;
begin
  if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then
    raise exception 'Event administrator required' using errcode='42501';
  end if;
  select status into v_status from public.events where id=p_event_id for update;
  if v_status in ('closed','cancelled') then raise exception 'Event is closed' using errcode='23514'; end if;
  if p_name is null or length(btrim(p_name)) not between 2 and 100
    or p_access_zone is null or length(btrim(p_access_zone)) not between 1 and 80
    or p_capacity < 0 then raise exception 'Invalid ticket type' using errcode='22023'; end if;
  if exists(select 1 from public.ticket_types where event_id=p_event_id and lower(btrim(name))=lower(btrim(p_name))) then
    raise exception 'Ticket type already exists' using errcode='23505';
  end if;
  insert into public.ticket_types(event_id,name,capacity,access_zone)
  values(p_event_id,btrim(p_name),p_capacity,btrim(p_access_zone)) returning id into v_id;
  insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id)
  select organization_id,id,(select auth.uid()),'ticket_type.created','ticket_type',v_id from public.events where id=p_event_id;
  return v_id;
end; $$;

create function public.issue_ticket(
  p_event_id uuid,p_type_id uuid,p_request_id uuid,p_token text,p_full_name text,
  p_source public.ticket_source default 'complimentary',p_email text default null,p_payment_reference text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_status public.event_status; v_capacity integer; v_ticket uuid; v_holder uuid; v_order uuid;
  v_input bytea; v_existing app_private.issuance_requests%rowtype;
begin
  if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then
    raise exception 'Event administrator required' using errcode='42501';
  end if;
  if p_request_id is null or p_token is null or p_token !~ '^sra1_[A-Za-z0-9_-]{43}$'
    or p_full_name is null or length(btrim(p_full_name)) not between 2 and 160
    or p_source is null or p_source not in ('complimentary','sinpe','door','other')
    or length(coalesce(p_email,''))>254 or length(coalesce(p_payment_reference,''))>160
    or (p_source in ('sinpe','door') and nullif(btrim(p_payment_reference),'') is null) then
    raise exception 'Invalid issuance input' using errcode='22023';
  end if;
  v_input:=extensions.digest(jsonb_build_array(p_event_id,p_type_id,p_token,p_full_name,p_source,p_email,p_payment_reference)::text,'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select * into v_existing from app_private.issuance_requests where request_id=p_request_id;
  if found then
    if v_existing.actor_id<>(select auth.uid()) or v_existing.input_digest<>v_input then
      raise exception 'Request already used with different input' using errcode='22023';
    end if;
    return v_existing.ticket_id;
  end if;
  select organization_id,status into v_org,v_status from public.events where id=p_event_id for share;
  if v_status in ('closed','cancelled') then raise exception 'Event is closed' using errcode='23514'; end if;
  select capacity into v_capacity from public.ticket_types where id=p_type_id and event_id=p_event_id for update;
  if not found then raise exception 'Ticket type does not belong to event' using errcode='23514'; end if;
  if v_capacity is not null and (select count(*) from public.tickets where type_id=p_type_id and status<>'void')>=v_capacity then
    raise exception 'Ticket type is full' using errcode='23514';
  end if;
  insert into public.ticket_holders(organization_id,full_name,email)
  values(v_org,btrim(p_full_name),nullif(btrim(p_email),'')) returning id into v_holder;
  if p_source in ('sinpe','door') then
    insert into public.orders(event_id,source,buyer_email,payment_reference,payment_status)
    values(p_event_id,p_source,nullif(btrim(p_email),''),btrim(p_payment_reference),'verified') returning id into v_order;
  end if;
  insert into public.tickets(event_id,type_id,holder_id,order_id,source)
  values(p_event_id,p_type_id,v_holder,v_order,p_source) returning id into v_ticket;
  insert into public.ticket_credentials(ticket_id,credential_kind,token_digest)
  values(v_ticket,'native',extensions.digest(p_token,'sha256'));
  insert into app_private.issuance_requests(request_id,actor_id,input_digest,ticket_id)
  values(p_request_id,(select auth.uid()),v_input,v_ticket);
  insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_org,p_event_id,(select auth.uid()),'ticket.issued','ticket',v_ticket,jsonb_build_object('source',p_source,'type_id',p_type_id));
  return v_ticket;
end; $$;

create function public.list_event_tickets(p_event_id uuid,p_limit integer default 100,p_offset integer default 0)
returns table(id uuid,type_name text,full_name text,source public.ticket_source,status public.ticket_status,issued_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not app_private.has_event_role(p_event_id,array['admin','supervisor']::public.event_role[]) then
    raise exception 'Event supervisor required' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then
    raise exception 'Invalid pagination' using errcode='22023';
  end if;
  return query select t.id,tt.name,h.full_name,t.source,t.status,t.issued_at
    from public.tickets t join public.ticket_types tt on tt.id=t.type_id
    left join public.ticket_holders h on h.id=t.holder_id
    where t.event_id=p_event_id order by t.issued_at desc,t.id limit p_limit offset p_offset;
end; $$;

revoke all on function public.create_ticket_type(uuid,text,integer,text) from public,anon;
revoke all on function public.issue_ticket(uuid,uuid,uuid,text,text,public.ticket_source,text,text) from public,anon;
revoke all on function public.list_event_tickets(uuid,integer,integer) from public,anon;
grant execute on function public.create_ticket_type(uuid,text,integer,text) to authenticated;
grant execute on function public.issue_ticket(uuid,uuid,uuid,text,text,public.ticket_source,text,text) to authenticated;
grant execute on function public.list_event_tickets(uuid,integer,integer) to authenticated;
commit;
