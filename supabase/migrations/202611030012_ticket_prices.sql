begin;

-- NULL is intentional: an existing type has no reliable historical price.
alter table public.ticket_types
  add column price_crc numeric(12,2),
  add column transport_price_crc numeric(12,2) not null default 0,
  add column category text not null default 'admission',
  add constraint ticket_type_prices_valid check (
    category in ('admission','accreditation') and transport_price_crc >= 0
    and (price_crc is null or price_crc >= 0)
    and (price_crc is not null or transport_price_crc = 0)
    and (category <> 'accreditation' or (price_crc = 0 and transport_price_crc = 0))
  );

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  order_id uuid not null,
  ticket_id uuid not null,
  kind text not null check (kind in ('admission','transport','accreditation')),
  description text not null,
  currency text not null default 'CRC' check (currency = 'CRC'),
  quantity integer not null default 1 check (quantity = 1),
  unit_price_crc numeric(12,2) not null check (unit_price_crc >= 0),
  created_at timestamptz not null default now(),
  foreign key (order_id,event_id) references public.orders(id,event_id),
  foreign key (ticket_id,event_id) references public.tickets(id,event_id),
  unique(ticket_id,kind)
);
create index order_items_event_order on public.order_items(event_id,order_id);
alter table public.order_items enable row level security;
revoke all on public.order_items from public,anon,authenticated;
grant select on public.order_items to authenticated;
create policy order_items_select on public.order_items for select to authenticated using (
  exists(select 1 from public.events e join public.organization_members m on m.organization_id=e.organization_id
    where e.id=order_items.event_id and m.user_id=(select auth.uid()) and m.role='owner')
  or exists(select 1 from public.event_members m where m.event_id=order_items.event_id
    and m.user_id=(select auth.uid()) and m.role='supervisor')
);

create function public.save_ticket_type_prices(
  p_event_id uuid,p_name text,p_price_crc numeric,p_transport_price_crc numeric default 0,
  p_category text default 'admission',p_capacity integer default null,
  p_access_zone text default 'general',p_type_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_status public.event_status;
begin
  if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then
    raise exception 'Event administrator required' using errcode='42501';
  end if;
  select status into v_status from public.events where id=p_event_id for update;
  if v_status in ('closed','cancelled') then raise exception 'Event is closed' using errcode='23514'; end if;
  if p_name is null or length(btrim(p_name)) not between 2 and 100
    or p_access_zone is null or length(btrim(p_access_zone)) not between 1 and 80
    or p_price_crc is null or p_price_crc < 0 or p_price_crc > 9999999999.99
    or p_price_crc <> round(p_price_crc,2)
    or p_transport_price_crc is null or p_transport_price_crc < 0 or p_transport_price_crc > 9999999999.99
    or p_transport_price_crc <> round(p_transport_price_crc,2)
    or p_category is null or p_category not in ('admission','accreditation')
    or (p_category='accreditation' and (p_price_crc<>0 or p_transport_price_crc<>0))
    or p_capacity < 0 then raise exception 'Invalid ticket price' using errcode='22023'; end if;
  if exists(select 1 from public.ticket_types where event_id=p_event_id and lower(btrim(name))=lower(btrim(p_name))
    and (p_type_id is null or id<>p_type_id)) then raise exception 'Ticket type already exists' using errcode='23505'; end if;
  if p_type_id is null then
    insert into public.ticket_types(event_id,name,capacity,access_zone,price_crc,transport_price_crc,category)
    values(p_event_id,btrim(p_name),p_capacity,btrim(p_access_zone),p_price_crc,p_transport_price_crc,p_category) returning id into v_id;
  else
    perform id from public.ticket_types where id=p_type_id and event_id=p_event_id for update;
    if not found then raise exception 'Ticket type not found' using errcode='22023'; end if;
    if p_capacity is not null and p_capacity < (select count(*) from public.tickets where type_id=p_type_id and status<>'void') then
      raise exception 'Capacity below active tickets' using errcode='23514';
    end if;
    update public.ticket_types set name=btrim(p_name),capacity=p_capacity,access_zone=btrim(p_access_zone),
      price_crc=p_price_crc,transport_price_crc=p_transport_price_crc,category=p_category where id=p_type_id;
    v_id:=p_type_id;
  end if;
  insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id,metadata)
  select organization_id,id,(select auth.uid()),'ticket_type.priced','ticket_type',v_id,
    jsonb_build_object('price_crc',p_price_crc,'transport_price_crc',p_transport_price_crc,'category',p_category) from public.events where id=p_event_id;
  return v_id;
end; $$;

create function public.configure_event_ticket_prices(p_event_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare r record; n integer:=0;
begin
  if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then
    raise exception 'Event administrator required' using errcode='42501';
  end if;
  perform id from public.events where id=p_event_id for update;
  if exists(select 1 from public.events where id=p_event_id and status in ('closed','cancelled')) then
    raise exception 'Event is closed' using errcode='23514';
  end if;
  for r in select * from (values
    ('Fase 1',10000,0,'admission'),('Fase 2',13500,0,'admission'),
    ('Día del evento / puerta',16000,0,'admission'),('Fase 1 + transporte',10000,7500,'admission'),
    ('Cortesías',0,0,'accreditation'),('Prensa',0,0,'accreditation'),('Staff',0,0,'accreditation')
  ) as defaults(name,price,transport,category) loop
    if not exists(select 1 from public.ticket_types where event_id=p_event_id and lower(btrim(name))=lower(r.name)) then
      perform public.save_ticket_type_prices(p_event_id,r.name,r.price,r.transport,r.category);
      n:=n+1;
    end if;
  end loop;
  return n;
end; $$;

create or replace function public.issue_ticket(
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
  if p_source in ('sinpe','door') or (p_source='other' and nullif(btrim(p_payment_reference),'') is not null) then
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

-- Shared by individual issuance and CSV. The existing request IDs and transactions
-- make the ticket and its immutable sale lines commit once, together.
create function app_private.snapshot_ticket_sale() returns trigger
language plpgsql security definer set search_path='' as $$
declare tt public.ticket_types%rowtype; v_order uuid; v_reference text; v_total numeric;
begin
  -- External sales require provider amounts and are handled by a future integration.
  if new.source='ticketera' then return new; end if;
  select * into tt from public.ticket_types where id=new.type_id and event_id=new.event_id for share;
  if tt.price_crc is null then return new; end if;
  v_total:=tt.price_crc+tt.transport_price_crc;
  if new.source='complimentary' and v_total>0 then
    raise exception 'Paid type cannot be issued as complimentary' using errcode='22023';
  end if;
  if new.order_id is not null then
    select payment_reference into v_reference from public.orders where id=new.order_id;
  end if;
  if v_total>0 and nullif(btrim(v_reference),'') is null then
    raise exception 'Verified payment reference required for priced tickets' using errcode='22023';
  end if;
  v_order:=new.order_id;
  if v_order is null then
    insert into public.orders(event_id,source,buyer_email,payment_status)
    select new.event_id,new.source,h.email,'verified' from public.ticket_holders h where h.id=new.holder_id
    returning id into v_order;
    if v_order is null then raise exception 'Ticket holder required' using errcode='22023'; end if;
    update public.tickets set order_id=v_order where id=new.id;
  end if;
  insert into public.order_items(event_id,order_id,ticket_id,kind,description,unit_price_crc)
  values(new.event_id,v_order,new.id,tt.category,tt.name,tt.price_crc);
  if tt.transport_price_crc>0 then
    insert into public.order_items(event_id,order_id,ticket_id,kind,description,unit_price_crc)
    values(new.event_id,v_order,new.id,'transport','Transporte',tt.transport_price_crc);
  end if;
  return new;
end; $$;
revoke all on function app_private.snapshot_ticket_sale() from public,anon,authenticated;
create trigger ticket_sale_snapshot after insert on public.tickets for each row execute function app_private.snapshot_ticket_sale();

revoke all on function public.save_ticket_type_prices(uuid,text,numeric,numeric,text,integer,text,uuid) from public,anon;
revoke all on function public.configure_event_ticket_prices(uuid) from public,anon;
grant execute on function public.save_ticket_type_prices(uuid,text,numeric,numeric,text,integer,text,uuid) to authenticated;
grant execute on function public.configure_event_ticket_prices(uuid) to authenticated;

-- Reject a stale displayed quote before a first sale; a retry of a committed
-- request still returns its original ticket, even after a tariff change.
create function app_private.assert_ticket_price(p_event_id uuid,p_type_id uuid,p_expected_price_crc numeric,p_expected_transport_crc numeric)
returns void language plpgsql security definer set search_path='' as $$
declare t public.ticket_types%rowtype;
begin
  if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then
    raise exception 'Event administrator required' using errcode='42501'; end if;
  perform id from public.events where id=p_event_id for share;
  select * into t from public.ticket_types where id=p_type_id and event_id=p_event_id for update;
  if not found then raise exception 'Unknown ticket type' using errcode='22023'; end if;
  if t.price_crc is distinct from p_expected_price_crc or t.transport_price_crc is distinct from p_expected_transport_crc then
    raise exception 'Ticket price changed; refresh before confirming payment' using errcode='P0001'; end if;
end; $$;
revoke all on function app_private.assert_ticket_price(uuid,uuid,numeric,numeric) from public,anon,authenticated;

create function public.issue_priced_ticket(
  p_event_id uuid,p_type_id uuid,p_request_id uuid,p_token text,p_full_name text,
  p_source public.ticket_source,p_email text,p_payment_reference text,
  p_expected_price_crc numeric,p_expected_transport_crc numeric
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  if not exists(select 1 from app_private.issuance_requests where request_id=p_request_id) then
    perform app_private.assert_ticket_price(p_event_id,p_type_id,p_expected_price_crc,p_expected_transport_crc);
  end if;
  return public.issue_ticket(p_event_id,p_type_id,p_request_id,p_token,p_full_name,p_source,p_email,p_payment_reference);
end; $$;
create function public.import_priced_native_tickets(
  p_event_id uuid,p_type_id uuid,p_source public.ticket_source,p_batch_id uuid,p_rows jsonb,
  p_expected_price_crc numeric,p_expected_transport_crc numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_batch_id::text,0));
  if not exists(select 1 from app_private.native_import_requests where batch_id=p_batch_id) then
    perform app_private.assert_ticket_price(p_event_id,p_type_id,p_expected_price_crc,p_expected_transport_crc);
  end if;
  return public.import_native_tickets(p_event_id,p_type_id,p_source,p_batch_id,p_rows);
end; $$;
revoke all on function public.issue_priced_ticket(uuid,uuid,uuid,text,text,public.ticket_source,text,text,numeric,numeric) from public,anon;
revoke all on function public.import_priced_native_tickets(uuid,uuid,public.ticket_source,uuid,jsonb,numeric,numeric) from public,anon;
grant execute on function public.issue_priced_ticket(uuid,uuid,uuid,text,text,public.ticket_source,text,text,numeric,numeric) to authenticated;
grant execute on function public.import_priced_native_tickets(uuid,uuid,public.ticket_source,uuid,jsonb,numeric,numeric) to authenticated;

notify pgrst,'reload schema';
commit;
