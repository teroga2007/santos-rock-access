begin;
-- Literal, accent-insensitive word matching: '%' and '_' are not wildcard operators.
create function app_private.list_text_matches(p_text text,p_query text) returns boolean
language sql immutable set search_path='' as $$
 select not exists(select 1 from regexp_split_to_table(translate(lower(btrim(coalesce(p_query,''))),'áéíóúüñ','aeiouun'),'\s+') term
 where term<>'' and strpos(translate(lower(coalesce(p_text,'')),'áéíóúüñ','aeiouun'),term)=0);
$$;
revoke all on function app_private.list_text_matches(text,text) from public,anon,authenticated;

create function public.search_event_tickets(
 p_event_id uuid,p_query text default '',p_status text default null,p_source text default null,
 p_limit integer default 20,p_offset integer default 0,p_sort_by text default 'issued_at',p_ascending boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or not app_private.has_event_role(p_event_id,array['admin','supervisor']::public.event_role[]) then raise exception 'Event supervisor required' using errcode='42501'; end if;
 if length(coalesce(p_query,''))>160 or p_limit is null or p_limit not in (20,50,100) or p_offset is null or p_offset<0 or p_offset>1000000 or p_ascending is null or p_sort_by is null or p_sort_by not in ('full_name','type_name','source','status','issued_at')
 or (p_status is not null and p_status not in ('issued','redeemed','void')) or (p_source is not null and p_source not in ('sinpe','complimentary','door','other','ticketera')) then raise exception 'Invalid search or pagination' using errcode='22023'; end if;
 with base as (
 select t.id,tt.name as type_name,h.full_name,h.email,t.source,t.status,t.issued_at,
 case t.source when 'complimentary' then 'cortesía acreditación' when 'sinpe' then 'sinpe' when 'door' then 'puerta' when 'ticketera' then 'la tiquetera' else 'otro' end as source_label,
 case t.status when 'issued' then 'emitida pendiente' when 'redeemed' then 'utilizada usada' else 'anulada' end as status_label
 from public.tickets t join public.ticket_types tt on tt.id=t.type_id left join public.ticket_holders h on h.id=t.holder_id where t.event_id=p_event_id
 ), filtered as (
 select b.*,case p_sort_by when 'full_name' then lower(b.full_name) when 'type_name' then lower(b.type_name) when 'source' then b.source_label when 'status' then b.status_label end as sort_text
 from base b where (p_status is null or b.status::text=p_status) and (p_source is null or b.source::text=p_source)
 and app_private.list_text_matches(concat_ws(' ',b.full_name,b.email,b.type_name,b.id::text,b.source::text,b.status::text,b.source_label,b.status_label),p_query)
 ), numbered as (select f.*,row_number() over(order by case when p_ascending then f.sort_text end collate "es-x-icu" asc nulls last,
 case when not p_ascending then f.sort_text end collate "es-x-icu" desc nulls last,

 case when p_ascending and p_sort_by='issued_at' then f.issued_at end asc,
 case when not p_ascending and p_sort_by='issued_at' then f.issued_at end desc,f.id asc) as ordinal from filtered f), page_rows as (
 select * from numbered order by ordinal limit p_limit offset p_offset
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)-'ordinal'-'sort_text'-'source_label'-'status_label' order by ordinal) from page_rows r),'[]'::jsonb),
 'total',(select count(*) from filtered),'total_all',(select count(*) from base)) into result;
 return result;
end; $$;
revoke all on function public.search_event_tickets(uuid,text,text,text,integer,integer,text,boolean) from public,anon;
grant execute on function public.search_event_tickets(uuid,text,text,text,integer,integer,text,boolean) to authenticated;

create function public.search_event_email_deliveries(
 p_event_id uuid,p_query text default '',p_status text default null,
 p_limit integer default 20,p_offset integer default 0,p_sort_by text default 'created_at',p_ascending boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then raise exception 'Event administrator required' using errcode='42501'; end if;
 if length(coalesce(p_query,''))>160 or p_limit is null or p_limit not in (20,50,100) or p_offset is null or p_offset<0 or p_offset>1000000 or p_ascending is null or p_sort_by is null or p_sort_by not in ('recipient','status','attempts','created_at')
 or (p_status is not null and p_status not in ('pending','processing','submitted','failed','unknown','cancelled')) then raise exception 'Invalid search or pagination' using errcode='22023'; end if;
 with base as (
 select j.delivery_id as id,min(j.recipient) as recipient,
 case when bool_or(j.status='unknown') then 'unknown' when bool_or(j.status='processing') then 'processing' when bool_or(j.status='pending') then 'pending' when bool_or(j.status='failed') then 'failed' when bool_or(j.status='submitted') then 'submitted' else 'cancelled' end as status,
 max(j.attempts) as attempts,min(j.created_at) as created_at,max(j.last_error) as last_error,count(*) as ticket_count,count(*) filter(where j.status='cancelled') as cancelled_count,
 string_agg(concat_ws(' ',h.full_name,tt.name,t.id::text),' ') as search_text
 from public.ticket_email_jobs j join public.tickets t on t.id=j.ticket_id join public.ticket_types tt on tt.id=t.type_id left join public.ticket_holders h on h.id=t.holder_id where j.event_id=p_event_id group by j.delivery_id
 ), labeled as (
 select b.*,case b.status when 'submitted' then 'aceptado por brevo enviado' when 'pending' then 'pendiente' when 'processing' then 'procesando' when 'failed' then 'rechazado error' when 'unknown' then 'requiere revisión' else 'cancelado' end as status_label from base b
 ), filtered as (
 select b.*,case p_sort_by when 'recipient' then lower(b.recipient) when 'status' then b.status_label end as sort_text from labeled b
 where (p_status is null or b.status=p_status) and app_private.list_text_matches(concat_ws(' ',b.recipient,b.search_text,b.id::text,b.status,b.status_label),p_query)
 ), numbered as (select f.*,row_number() over(order by case when p_ascending then f.sort_text end collate "es-x-icu" asc nulls last,
 case when not p_ascending then f.sort_text end collate "es-x-icu" desc nulls last,
 case when p_ascending and p_sort_by='attempts' then f.attempts end asc,
 case when not p_ascending and p_sort_by='attempts' then f.attempts end desc,
 case when p_ascending and p_sort_by='created_at' then f.created_at end asc,
 case when not p_ascending and p_sort_by='created_at' then f.created_at end desc,f.id asc) as ordinal from filtered f), page_rows as (
 select * from numbered order by ordinal limit p_limit offset p_offset
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)-'ordinal'-'sort_text'-'search_text'-'status_label' order by ordinal) from page_rows r),'[]'::jsonb),
 'total',(select count(*) from filtered),'total_all',(select count(*) from base),'ticket_total',(select coalesce(sum(ticket_count),0) from filtered)) into result;
 return result;
end; $$;
revoke all on function public.search_event_email_deliveries(uuid,text,text,integer,integer,text,boolean) from public,anon;
grant execute on function public.search_event_email_deliveries(uuid,text,text,integer,integer,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
