begin;
alter table public.orders
  add column payment_method text check(payment_method in ('cash','sinpe','card','other')),
  add column cash_received_crc numeric(14,2),
  add column cash_change_crc numeric(14,2),
  add constraint order_cash_valid check (
    (payment_method='cash' and cash_received_crc is not null and cash_change_crc is not null and cash_received_crc>=0 and cash_change_crc>=0)
    or (payment_method is distinct from 'cash' and cash_received_crc is null and cash_change_crc is null)
  );
alter table app_private.issuance_requests add column door_input_digest bytea;

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
  if p_source='door' and exists(select 1 from public.ticket_types where id=p_type_id and transport_price_crc>0) then
    raise exception 'Transport is not sold at the door' using errcode='22023'; end if;
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

create function public.sell_door_ticket(
  p_event_id uuid,p_type_id uuid,p_request_id uuid,p_token text,p_full_name text,p_email text,
  p_payment_method text,p_payment_reference text,p_cash_received_crc numeric,
  p_payment_confirmed boolean,p_expected_price_crc numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; tt public.ticket_types%rowtype; prior app_private.issuance_requests%rowtype;
  digest bytea; ticket uuid; order_id uuid; total numeric; change numeric; reference text;
begin
  if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then
    raise exception 'Event administrator required' using errcode='42501'; end if;
  if p_request_id is null or p_payment_confirmed is distinct from true
    or p_payment_method is null or p_payment_method not in ('cash','sinpe','card','other') then
    raise exception 'Confirmed payment required' using errcode='22023'; end if;
  digest:=extensions.digest(jsonb_build_array(p_event_id,p_type_id,p_token,p_full_name,p_email,
    p_payment_method,p_payment_reference,p_cash_received_crc,p_payment_confirmed,p_expected_price_crc)::text,'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select * into prior from app_private.issuance_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>(select auth.uid()) or prior.door_input_digest is distinct from digest then
      raise exception 'Request reused with different input' using errcode='22023'; end if;
    select t.order_id into order_id from public.tickets t where t.id=prior.ticket_id;
    return (select jsonb_build_object('ticket_id',prior.ticket_id,'order_id',o.id,
      'total_crc',(select sum(i.unit_price_crc*i.quantity) from public.order_items i where i.order_id=o.id),
      'cash_change_crc',o.cash_change_crc) from public.orders o where o.id=order_id);
  end if;
  select * into e from public.events where id=p_event_id for share;
  if not found or e.status not in ('published','live') then raise exception 'Event is not open for sales' using errcode='23514'; end if;
  select * into tt from public.ticket_types where id=p_type_id and event_id=p_event_id for update;
  if not found or tt.category<>'admission' or tt.price_crc is null or tt.price_crc<=0 or tt.transport_price_crc<>0 then
    raise exception 'Paid admission type required' using errcode='22023'; end if;
  if tt.price_crc is distinct from p_expected_price_crc then
    raise exception 'Displayed price changed' using errcode='P0001'; end if;
  total:=tt.price_crc;
  if p_payment_method='cash' then
    if p_cash_received_crc is null or p_cash_received_crc<total or p_cash_received_crc>999999999999.99
      or p_cash_received_crc<>round(p_cash_received_crc,2) then
      raise exception 'Insufficient or invalid cash received' using errcode='22023'; end if;
    change:=p_cash_received_crc-total;
    reference:='CASH-'||p_request_id::text;
  else
    if p_cash_received_crc is not null or nullif(btrim(p_payment_reference),'') is null then
      raise exception 'Payment reference required' using errcode='22023'; end if;
    reference:=btrim(p_payment_reference);
  end if;
  ticket:=public.issue_ticket(p_event_id,p_type_id,p_request_id,p_token,p_full_name,'door',p_email,reference);
  select t.order_id into order_id from public.tickets t where t.id=ticket;
  update public.orders o set payment_method=p_payment_method,
    cash_received_crc=case when p_payment_method='cash' then p_cash_received_crc else null end,
    cash_change_crc=change where o.id=order_id;
  update app_private.issuance_requests set door_input_digest=digest where request_id=p_request_id;
  insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id,metadata)
    values(e.organization_id,e.id,(select auth.uid()),'ticket.door_sold','ticket',ticket,
      jsonb_build_object('payment_method',p_payment_method,'admission_crc',tt.price_crc,'total_crc',total,'cash_change_crc',change));
  return jsonb_build_object('ticket_id',ticket,'order_id',order_id,'total_crc',total,'cash_change_crc',change);
end; $$;
revoke all on function public.sell_door_ticket(uuid,uuid,uuid,text,text,text,text,text,numeric,boolean,numeric) from public,anon;
grant execute on function public.sell_door_ticket(uuid,uuid,uuid,text,text,text,text,text,numeric,boolean,numeric) to authenticated;
create or replace function public.get_event_finances(
  p_event_id uuid,p_from date default null,p_to date default null,
  p_type_id uuid default null,p_source public.ticket_source default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null or not (
    exists(select 1 from public.events e join public.organization_members m on m.organization_id=e.organization_id
      where e.id=p_event_id and m.user_id=(select auth.uid()) and m.role='owner')
    or exists(select 1 from public.event_members m where m.event_id=p_event_id
      and m.user_id=(select auth.uid()) and m.role='supervisor')
  ) then raise exception 'Event finance permission required' using errcode='42501'; end if;
  if p_from is not null and p_to is not null and p_from>p_to then
    raise exception 'Invalid date range' using errcode='22023'; end if;
  if p_type_id is not null and not exists(select 1 from public.ticket_types where id=p_type_id and event_id=p_event_id) then
    raise exception 'Type belongs to another event' using errcode='22023'; end if;

  -- One statement: counts and financial rows use the same database snapshot.
  with filtered as (
    select t.id,t.type_id,t.status,t.source,t.order_id,o.payment_status,o.payment_method,
      main.description as type_name,main.unit_price_crc as admission_price,main.kind as category
    from public.tickets t
    left join public.orders o on o.id=t.order_id and o.event_id=t.event_id
    left join public.order_items main on main.ticket_id=t.id and main.kind in ('admission','accreditation')
    where t.event_id=p_event_id
      and (p_from is null or t.issued_at >= (p_from::timestamp at time zone 'America/Costa_Rica'))
      and (p_to is null or t.issued_at < ((p_to+1)::timestamp at time zone 'America/Costa_Rica'))
      and (p_type_id is null or t.type_id=p_type_id)
      and (p_source is null or t.source=p_source)
  ), lines as (
    select f.*,i.kind,i.unit_price_crc,i.quantity
    from filtered f join public.order_items i on i.ticket_id=f.id
  ), breakdown as (
    select type_id,type_name,kind,source,payment_status,unit_price_crc,
      sum(quantity) as quantity,
      sum(quantity*unit_price_crc) filter(where payment_status='verified') as gross_crc
    from lines group by type_id,type_name,kind,source,payment_status,unit_price_crc
  ), payment_methods as (
    select coalesce(payment_method,'unknown') as method,
      coalesce(sum(quantity*unit_price_crc) filter(where payment_status='verified'),0) as gross_crc
    from lines group by payment_method
  ), sources as (
    select source,
      count(*) filter(where kind='admission' and unit_price_crc>0 and payment_status='verified') as sold,
      coalesce(sum(quantity*unit_price_crc) filter(where kind='admission' and payment_status='verified'),0) as admission_crc,
      coalesce(sum(quantity*unit_price_crc) filter(where kind='transport' and payment_status='verified'),0) as transport_crc,
      coalesce(sum(quantity*unit_price_crc) filter(where payment_status='verified'),0) as gross_crc
    from lines group by source
  )
  select jsonb_build_object(
    'generated_at',statement_timestamp(),'currency','CRC',
    'totals',jsonb_build_object(
      'sold',(select count(*) from filtered where admission_price>0 and payment_status='verified'),
      'transport_count',(select count(*) from lines where kind='transport' and payment_status='verified'),
      'free',(select count(*) from filtered where admission_price=0),
      'admission_crc',(select coalesce(sum(quantity*unit_price_crc) filter(where kind='admission' and payment_status='verified'),0) from lines),
      'transport_crc',(select coalesce(sum(quantity*unit_price_crc) filter(where kind='transport' and payment_status='verified'),0) from lines),
      'gross_crc',(select coalesce(sum(quantity*unit_price_crc) filter(where payment_status='verified'),0) from lines),
      'without_amount',(select count(*) from filtered where admission_price is null),
      'issued',(select count(*) from filtered),
      'admitted',(select count(*) from filtered where status='redeemed'),
      'pending',(select count(*) from filtered where status='issued'),
      'voided',(select count(*) from filtered where status='void'),
      'voided_paid',(select count(*) from filtered where status='void' and payment_status='verified' and exists(
        select 1 from public.order_items i where i.ticket_id=filtered.id and i.unit_price_crc>0)),
      'unverified',(select count(*) from filtered where admission_price is not null and payment_status='pending'),
      'cancelled',(select count(*) from filtered where admission_price is not null and payment_status='cancelled'),
      'refunded',(select count(*) from filtered where admission_price is not null and payment_status='refunded')
    ),
    'breakdown',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('gross_crc',coalesce(b.gross_crc,0)) order by type_name,kind,source,unit_price_crc,payment_status) from breakdown b),'[]'::jsonb),
    'payment_methods',coalesce((select jsonb_agg(to_jsonb(m) order by method) from payment_methods m),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by source) from sources s),'[]'::jsonb),
    'types',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.ticket_types where event_id=p_event_id),'[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;

notify pgrst,'reload schema';
commit;
