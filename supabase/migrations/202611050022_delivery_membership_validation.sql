begin;
create or replace function public.finish_ticket_email_delivery(p_delivery_id uuid,p_lease_id uuid,p_job_ids uuid[],p_status text,p_provider_id text default null,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare j record;
begin
 if p_status is null or p_status not in ('submitted','failed','unknown','cancelled') or p_job_ids is null then raise exception 'Invalid delivery result' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_job_ids) as ids(job_id) where not exists(select 1 from public.ticket_email_jobs q where q.id=ids.job_id and q.delivery_id=p_delivery_id and q.lease_id=p_lease_id)) then raise exception 'Delivery mismatch' using errcode='22023'; end if;
 for j in select id from public.ticket_email_jobs where delivery_id=p_delivery_id and lease_id=p_lease_id and status='processing' for update loop
  perform public.finish_ticket_email(j.id,p_lease_id,case when j.id=any(p_job_ids) then p_status else 'cancelled' end,case when j.id=any(p_job_ids) then p_provider_id else null end,case when j.id=any(p_job_ids) then p_error else 'ticket_no_longer_sendable' end);
 end loop;
end; $$;
notify pgrst,'reload schema';
commit;
