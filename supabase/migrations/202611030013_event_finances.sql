begin;
create function public.get_event_finances(
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
    select t.id,t.type_id,t.status,t.source,t.order_id,o.payment_status,
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
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by source) from sources s),'[]'::jsonb),
    'types',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.ticket_types where event_id=p_event_id),'[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;
revoke all on function public.get_event_finances(uuid,date,date,uuid,public.ticket_source) from public,anon;
grant execute on function public.get_event_finances(uuid,date,date,uuid,public.ticket_source) to authenticated;
notify pgrst,'reload schema';
commit;
