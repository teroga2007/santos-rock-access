begin;
create function public.list_event_tickets_sorted(
  p_event_id uuid,p_limit integer default 20,p_offset integer default 0,
  p_sort_by text default 'issued_at',p_ascending boolean default false
) returns table(id uuid,type_name text,full_name text,source public.ticket_source,status public.ticket_status,issued_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not app_private.has_event_role(p_event_id,array['admin','supervisor']::public.event_role[]) then
    raise exception 'Event supervisor required' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0
    or p_ascending is null or p_sort_by is null or p_sort_by not in ('full_name','type_name','source','status','issued_at') then
    raise exception 'Invalid table sorting' using errcode='22023'; end if;
  return query with rows as (
    select t.id,tt.name as type_name,h.full_name,t.source,t.status,t.issued_at,
      case when p_sort_by='full_name' then lower(h.full_name)
        when p_sort_by='type_name' then lower(tt.name)
        when p_sort_by='source' then case t.source when 'complimentary' then 'cortesía / acreditación' when 'sinpe' then 'sinpe' when 'door' then 'puerta' when 'ticketera' then 'la tiquetera' else 'otro' end
        when p_sort_by='status' then case t.status when 'issued' then 'emitida' when 'redeemed' then 'utilizada' else 'anulada' end end as sort_text
    from public.tickets t join public.ticket_types tt on tt.id=t.type_id left join public.ticket_holders h on h.id=t.holder_id
    where t.event_id=p_event_id
  ) select r.id,r.type_name,r.full_name,r.source,r.status,r.issued_at from rows r
  order by
    case when p_ascending and p_sort_by<>'issued_at' then r.sort_text end collate "es-x-icu" asc nulls last,
    case when not p_ascending and p_sort_by<>'issued_at' then r.sort_text end collate "es-x-icu" desc nulls last,
    case when p_ascending and p_sort_by='issued_at' then r.issued_at end asc,
    case when not p_ascending and p_sort_by='issued_at' then r.issued_at end desc,
    r.id asc
  limit p_limit offset p_offset;
end; $$;
revoke all on function public.list_event_tickets_sorted(uuid,integer,integer,text,boolean) from public,anon;
grant execute on function public.list_event_tickets_sorted(uuid,integer,integer,text,boolean) to authenticated;
create function public.list_event_ticket_emails_sorted(
  p_event_id uuid,p_limit integer default 20,p_offset integer default 0,
  p_sort_by text default 'created_at',p_ascending boolean default false
) returns table(id uuid,ticket_id uuid,recipient text,status text,attempts integer,created_at timestamptz,last_error text)
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then
    raise exception 'Event administrator required' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 or p_ascending is null
    or p_sort_by is null or p_sort_by not in ('recipient','status','attempts','created_at') then
    raise exception 'Invalid table sorting' using errcode='22023'; end if;
  return query with rows as (
    select j.id,j.ticket_id,j.recipient,j.status,j.attempts,j.created_at,j.last_error,
      case when p_sort_by='recipient' then lower(j.recipient) when p_sort_by='status' then
        case j.status when 'submitted' then 'aceptado por brevo' when 'cancelled' then 'cancelado'
          when 'pending' then 'pendiente' when 'processing' then 'procesando' when 'failed' then 'rechazado / error' else 'requiere revisión' end end as sort_text
    from public.ticket_email_jobs j where j.event_id=p_event_id
  ) select r.id,r.ticket_id,r.recipient,r.status,r.attempts,r.created_at,r.last_error from rows r
  order by
    case when p_ascending then r.sort_text end collate "es-x-icu" asc nulls last,
    case when not p_ascending then r.sort_text end collate "es-x-icu" desc nulls last,
    case when p_ascending and p_sort_by='attempts' then r.attempts end asc,
    case when not p_ascending and p_sort_by='attempts' then r.attempts end desc,
    case when p_ascending and p_sort_by='created_at' then r.created_at end asc,
    case when not p_ascending and p_sort_by='created_at' then r.created_at end desc,
    r.id asc
  limit p_limit offset p_offset;
end; $$;
revoke all on function public.list_event_ticket_emails_sorted(uuid,integer,integer,text,boolean) from public,anon;
grant execute on function public.list_event_ticket_emails_sorted(uuid,integer,integer,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
