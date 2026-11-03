begin;
create table app_private.redemption_requests (
  request_id uuid primary key, actor_id uuid not null references auth.users(id),
  event_id uuid not null references public.events(id), token_digest bytea not null,
  response jsonb not null, created_at timestamptz not null default now()
);
create index redemption_actor_time_idx on app_private.redemption_requests(actor_id,created_at);
revoke all on app_private.redemption_requests from public,anon,authenticated;

create function public.set_event_status(p_event_id uuid,p_status public.event_status)
returns void language plpgsql security definer set search_path='' as $$
declare v_event public.events%rowtype;
begin
  if (select auth.uid()) is null or not app_private.can_manage_event(p_event_id) then
    raise exception 'Event administrator required' using errcode='42501';
  end if;
  select * into v_event from public.events where id=p_event_id for update;
  if p_status=v_event.status then return; end if;
  if p_status is null or not (
    (v_event.status='draft' and p_status in ('published','cancelled')) or
    (v_event.status='published' and p_status in ('live','cancelled')) or
    (v_event.status='live' and p_status='closed')
  ) then raise exception 'Invalid event transition' using errcode='23514'; end if;
  update public.events set status=p_status where id=p_event_id;
  insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_event.organization_id,p_event_id,(select auth.uid()),'event.status_changed','event',p_event_id,
    jsonb_build_object('from',v_event.status,'to',p_status));
end; $$;

create function public.redeem_ticket(p_event_id uuid,p_token text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_request app_private.redemption_requests%rowtype; v_digest bytea; v_event public.events%rowtype;
  v_ticket public.tickets%rowtype; v_credential public.ticket_credentials%rowtype;
  v_result text; v_response jsonb; v_time timestamptz:=clock_timestamp(); v_type public.ticket_types%rowtype;
begin
  if (select auth.uid()) is null or not app_private.can_view_event(p_event_id) then
    raise exception 'Event access required' using errcode='42501';
  end if;
  if p_request_id is null or p_token is null or length(p_token)>512 then
    raise exception 'Invalid scan input' using errcode='22023';
  end if;
  v_digest:=extensions.digest(p_token,'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select * into v_request from app_private.redemption_requests where request_id=p_request_id;
  if found then
    if v_request.actor_id<>(select auth.uid()) or v_request.event_id<>p_event_id or v_request.token_digest<>v_digest then
      raise exception 'Request reused with different input' using errcode='22023';
    end if;
    return v_request.response;
  end if;
  -- Serialize the per-operator limit, including requests from several devices.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('scan-actor:'||(select auth.uid())::text,0));
  if (select count(*) from app_private.redemption_requests where actor_id=(select auth.uid()) and created_at>now()-interval '1 minute')>=180 then
    raise exception 'Scan rate exceeded' using errcode='54000';
  end if;
  select * into v_event from public.events where id=p_event_id for share;
  if v_event.status<>'live' then
    v_response:=jsonb_build_object('result','error','reason','event_not_live');
  else
    select * into v_credential from public.ticket_credentials where token_digest=v_digest and credential_kind='native' for share;
    if not found or p_token !~ '^sra1_[A-Za-z0-9_-]{43}$' then
      v_result:='invalid';
    else
      select * into v_ticket from public.tickets where id=v_credential.ticket_id for update;
      if v_ticket.event_id<>p_event_id then v_result:='wrong_event';
      elsif v_credential.revoked_at is not null or v_ticket.status='void' then v_result:='void';
      elsif v_ticket.status='redeemed' then v_result:='duplicate';
      else
        v_result:='accepted';
        update public.tickets set status='redeemed',redeemed_at=v_time where id=v_ticket.id;
        v_ticket.redeemed_at:=v_time;
      end if;
      if v_result in ('accepted','duplicate','void') then
        insert into public.checkins(event_id,ticket_id,operator_id,result,request_id,checked_in_at)
        values(p_event_id,v_ticket.id,(select auth.uid()),v_result::public.checkin_result,p_request_id,v_time);
      end if;
    end if;
    v_response:=jsonb_build_object('result',v_result);
    if v_result in ('accepted','duplicate') then
      select * into v_type from public.ticket_types where id=v_ticket.type_id;
      v_response:=v_response||jsonb_build_object('type_name',v_type.name,'access_zone',v_type.access_zone,'redeemed_at',v_ticket.redeemed_at);
    end if;
  end if;
  insert into app_private.redemption_requests(request_id,actor_id,event_id,token_digest,response)
  values(p_request_id,(select auth.uid()),p_event_id,v_digest,v_response);
  insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_event.organization_id,p_event_id,(select auth.uid()),'ticket.scanned','event',p_event_id,
    jsonb_build_object('result',v_response->>'result','request_id',p_request_id));
  return v_response;
end; $$;
revoke all on function public.set_event_status(uuid,public.event_status) from public,anon;
revoke all on function public.redeem_ticket(uuid,text,uuid) from public,anon;
grant execute on function public.set_event_status(uuid,public.event_status) to authenticated;
grant execute on function public.redeem_ticket(uuid,text,uuid) to authenticated;
commit;
