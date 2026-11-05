begin;
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
    or length(coalesce(p_email,''))>254 or length(coalesce(p_payment_reference,''))>160 then
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
  if p_source in ('sinpe','door','other') then
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


create or replace function app_private.snapshot_ticket_sale() returns trigger
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

alter table public.tickets add column purchase_id uuid;
create index tickets_purchase_idx on public.tickets(purchase_id);
create table app_private.ticket_purchase_requests (
 request_id uuid primary key, actor_id uuid not null references auth.users(id),
 event_id uuid not null references public.events(id) on delete cascade,
 type_id uuid not null, source public.ticket_source not null, is_import boolean not null,
 input_digest bytea not null, content_digest bytea not null, response jsonb not null
);
revoke all on app_private.ticket_purchase_requests from public,anon,authenticated;
create unique index purchase_csv_content_unique on app_private.ticket_purchase_requests(event_id,type_id,source,content_digest) where is_import;

create function public.issue_ticket_purchases(
 p_event_id uuid,p_type_id uuid,p_request_id uuid,p_rows jsonb,p_source public.ticket_source,
 p_expected_price_crc numeric,p_expected_transport_crc numeric,p_payment_confirmed boolean,
 p_import boolean default false,p_payment_method text default null,p_cash_received_crc numeric default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior app_private.ticket_purchase_requests%rowtype; input_hash bytea; content_hash bytea;
 r jsonb; tok jsonb; total_count integer:=0; buyer integer:=0; idx integer:=0; n integer;
 result jsonb:='[]'; tid uuid; request uuid; purchase uuid; ord uuid; ev public.events%rowtype;
 tt public.ticket_types%rowtype; total numeric; change numeric; method text;
begin
 if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then raise exception 'Event administrator required' using errcode='42501'; end if;
 if p_request_id is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or p_import is null or p_source is null or p_source not in ('sinpe','complimentary','door','other') then raise exception 'Invalid purchase' using errcode='22023'; end if;
 if jsonb_array_length(p_rows) not between 1 and 100 or octet_length(p_rows::text)>1000000 then raise exception 'Invalid purchase size' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r)<>'object' or r->>'quantity' is null or (r->>'quantity') !~ '^[1-9][0-9]{0,2}$' then raise exception 'Invalid quantity' using errcode='22023'; end if;
  n:=(r->>'quantity')::integer;
  if jsonb_typeof(r->'tokens') is distinct from 'array' then raise exception 'Tokens required' using errcode='22023'; end if;
  if n>100 or jsonb_array_length(r->'tokens')<>n then raise exception 'Quantity/token mismatch' using errcode='22023'; end if;
  if r->>'name' is null or length(btrim(r->>'name')) not between 2 and 160 or length(coalesce(r->>'email',''))>254 or (nullif(btrim(r->>'email'),'') is not null and btrim(r->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then raise exception 'Invalid buyer' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(r->'tokens') t where t !~ '^sra1_[A-Za-z0-9_-]{43}$' or t is null) then raise exception 'Invalid token' using errcode='22023'; end if;
  total_count:=total_count+n;
 end loop;
 if total_count>100 or (p_import and p_source='door') then raise exception 'Maximum 100 tickets per operation' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) entry group by lower(btrim(entry->>'name')),lower(btrim(coalesce(entry->>'email',''))) having count(*)>1) then raise exception 'Combine duplicate buyer quantities' using errcode='22023'; end if;
 input_hash:=extensions.digest(jsonb_build_array(p_event_id,p_type_id,p_rows,p_source,p_expected_price_crc,p_expected_transport_crc,p_payment_confirmed,p_import,p_payment_method,p_cash_received_crc)::text,'sha256');
 select extensions.digest(jsonb_agg(jsonb_build_array(lower(btrim(entry->>'name')),lower(btrim(coalesce(entry->>'email',''))),(entry->>'quantity')::integer) order by lower(btrim(entry->>'name')),lower(btrim(coalesce(entry->>'email',''))))::text,'sha256') into content_hash from jsonb_array_elements(p_rows) entry;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into prior from app_private.ticket_purchase_requests where request_id=p_request_id;
 if found then
  if prior.actor_id<>(select auth.uid()) or prior.input_digest<>input_hash then raise exception 'Request reused with different input' using errcode='22023'; end if;
  return prior.response;
 end if;
 perform app_private.assert_ticket_price(p_event_id,p_type_id,p_expected_price_crc,p_expected_transport_crc);
 select * into ev from public.events where id=p_event_id for share;
 select * into tt from public.ticket_types where id=p_type_id and event_id=p_event_id for update;
 if p_import and exists(select 1 from app_private.ticket_purchase_requests where event_id=p_event_id and type_id=p_type_id and source=p_source and is_import and content_digest=content_hash) then raise exception 'CSV already imported' using errcode='23505'; end if;
 if ev.status in ('closed','cancelled') then raise exception 'Event is closed' using errcode='23514'; end if;
 if tt.capacity is not null and total_count+(select count(*) from public.tickets where type_id=p_type_id and status<>'void')>tt.capacity then raise exception 'Insufficient capacity' using errcode='23514'; end if;
 total:=(tt.price_crc+tt.transport_price_crc)*total_count;
 if (coalesce(total,0)>0 or p_source in ('sinpe','door')) and p_payment_confirmed is distinct from true then raise exception 'Confirm payment first' using errcode='22023'; end if;
 if p_source='door' then
  if ev.status not in ('published','live') or tt.category<>'admission' or tt.price_crc is null or tt.price_crc<=0 or tt.transport_price_crc<>0 or p_payment_method is null or p_payment_method not in ('cash','sinpe','card','other') then raise exception 'Invalid door purchase' using errcode='22023'; end if;
  method:=p_payment_method;
  if method='cash' then
   if p_cash_received_crc is null or p_cash_received_crc<total or p_cash_received_crc>999999999999.99 or p_cash_received_crc<>round(p_cash_received_crc,2) then raise exception 'Insufficient cash' using errcode='22023'; end if;
   change:=p_cash_received_crc-total;
  elsif p_cash_received_crc is not null then raise exception 'Unexpected cash' using errcode='22023'; end if;
 elsif p_payment_method is not null or p_cash_received_crc is not null then raise exception 'Unexpected payment fields' using errcode='22023'; end if;
 if p_import then insert into public.import_batches(id,event_id,source,imported_by,row_count,status) values(p_request_id,p_event_id,p_source,(select auth.uid()),total_count,'validated'); end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  buyer:=buyer+1; n:=0; purchase:=md5('purchase:'||p_request_id::text||':'||buyer::text)::uuid;
  for tok in select value from jsonb_array_elements(r->'tokens') loop
   idx:=idx+1; n:=n+1; request:=md5('purchase-ticket:'||p_request_id::text||':'||idx::text)::uuid;
   tid:=public.issue_ticket(p_event_id,p_type_id,request,tok#>>'{}',r->>'name',p_source,lower(nullif(btrim(r->>'email'),'')),null);
   update public.tickets set purchase_id=purchase,import_batch_id=case when p_import then p_request_id else null end where id=tid returning order_id into ord;
   if p_source='door' then update public.orders set payment_method=method,cash_received_crc=case when method='cash' then tt.price_crc+case when idx=1 then change else 0 end else null end,cash_change_crc=case when method='cash' then case when idx=1 then change else 0 end else null end where id=ord; end if;
   result:=result||jsonb_build_array(jsonb_build_object('row',idx,'buyer_row',buyer,'quantity_index',n,'ticket_id',tid,'purchase_id',purchase));
  end loop;
 end loop;
 if p_import then update public.import_batches set status='completed' where id=p_request_id; end if;
 result:=jsonb_build_object('tickets',result,'quantity',total_count,'total_crc',total,'cash_change_crc',change);
 insert into app_private.ticket_purchase_requests values(p_request_id,(select auth.uid()),p_event_id,p_type_id,p_source,p_import,input_hash,content_hash,result);
 insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id,metadata) values(ev.organization_id,p_event_id,(select auth.uid()),'tickets.purchased',case when p_import then 'import_batch' else 'purchase' end,p_request_id,jsonb_build_object('buyers',buyer,'quantity',total_count,'source',p_source,'total_crc',total));
 return result;
end; $$;
revoke all on function public.issue_ticket_purchases(uuid,uuid,uuid,jsonb,public.ticket_source,numeric,numeric,boolean,boolean,text,numeric) from public,anon;
grant execute on function public.issue_ticket_purchases(uuid,uuid,uuid,jsonb,public.ticket_source,numeric,numeric,boolean,boolean,text,numeric) to authenticated;
notify pgrst,'reload schema';
commit;
