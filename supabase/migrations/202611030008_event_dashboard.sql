begin;
create index redemption_event_time_idx on app_private.redemption_requests(event_id,created_at desc);

create function public.get_event_dashboard(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_dashboard jsonb;
begin
  if (select auth.uid()) is null or not app_private.has_event_role(p_event_id,array['admin','supervisor']::public.event_role[]) then
    raise exception 'Event supervisor required' using errcode='42501';
  end if;
  -- A single statement keeps totals, breakdowns and activity on the same snapshot.
  with event_tickets as materialized (
    select source,status,type_id from public.tickets where event_id=p_event_id
  ), source_totals as (
    select source,count(*) total,count(*) filter(where status='redeemed') admitted,
      count(*) filter(where status='issued') pending,count(*) filter(where status='void') voided
    from event_tickets group by source
  ), type_totals as (
    select tt.id,tt.name,tt.capacity,tt.access_zone,count(t.type_id) total,
      count(*) filter(where t.status='redeemed') admitted,
      count(*) filter(where t.status='issued') pending,
      count(*) filter(where t.status='void') voided
    from public.ticket_types tt left join event_tickets t on t.type_id=tt.id
    where tt.event_id=p_event_id group by tt.id
  ), recent as (
    select request_id,created_at,response->>'result' result,response->>'reason' reason,
      response->>'type_name' type_name,response->>'access_zone' access_zone
    from app_private.redemption_requests where event_id=p_event_id
    order by created_at desc,request_id desc limit 15
  )
  select jsonb_build_object(
    'generated_at',statement_timestamp(),
    'event_status',(select status from public.events where id=p_event_id),
    'totals',(select jsonb_build_object('total',count(*),
      'admitted',count(*) filter(where status='redeemed'),
      'pending',count(*) filter(where status='issued'),
      'voided',count(*) filter(where status='void')) from event_tickets),
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.source) from source_totals s),'[]'::jsonb),
    'types',coalesce((select jsonb_agg(to_jsonb(t) order by t.name,t.id) from type_totals t),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.request_id desc) from recent r),'[]'::jsonb)
  ) into v_dashboard;
  return v_dashboard;
end; $$;
revoke all on function public.get_event_dashboard(uuid) from public,anon;
grant execute on function public.get_event_dashboard(uuid) to authenticated;
commit;
