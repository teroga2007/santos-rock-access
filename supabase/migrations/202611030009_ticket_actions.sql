begin;
create table app_private.ticket_action_requests (
  request_id uuid primary key, actor_id uuid not null references auth.users(id),
  input_digest bytea not null, ticket_id uuid not null references public.tickets(id),
  action text not null check(action in ('void','reissue')),
  created_at timestamptz not null default now()
);
revoke all on app_private.ticket_action_requests from public,anon,authenticated;

create function public.manage_ticket_credential(
  p_ticket_id uuid,p_action text,p_request_id uuid,p_reason text,p_new_token text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_ticket public.tickets%rowtype; v_event public.events%rowtype;
  v_request app_private.ticket_action_requests%rowtype; v_input bytea;
begin
  select * into v_ticket from public.tickets where id=p_ticket_id;
  if (select auth.uid()) is null or not found or not app_private.can_manage_event(v_ticket.event_id) then
    raise exception 'Event administrator required' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('void','reissue') or p_request_id is null
    or p_reason is null or length(btrim(p_reason)) not between 5 and 300
    or (p_action='reissue' and (p_new_token is null or p_new_token !~ '^sra1_[A-Za-z0-9_-]{43}$'))
    or (p_action='void' and p_new_token is not null) then
    raise exception 'Invalid ticket action input' using errcode='22023';
  end if;
  v_input:=extensions.digest(jsonb_build_array(p_ticket_id,p_action,p_reason,p_new_token)::text,'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select * into v_request from app_private.ticket_action_requests where request_id=p_request_id;
  if found then
    if v_request.actor_id<>(select auth.uid()) or v_request.input_digest<>v_input then
      raise exception 'Request reused with different input' using errcode='22023';
    end if;
    return v_request.ticket_id;
  end if;
  select * into v_event from public.events where id=v_ticket.event_id for share;
  if p_action='reissue' and v_event.status in ('closed','cancelled') then
    raise exception 'Event is closed' using errcode='23514';
  end if;
  -- Same lock order as redeem_ticket: event, credentials, ticket.
  perform id from public.ticket_credentials where ticket_id=p_ticket_id order by id for update;
  select * into v_ticket from public.tickets where id=p_ticket_id for update;
  if v_ticket.status<>'issued' or v_ticket.source='ticketera' then
    raise exception 'Only unused native tickets can be changed' using errcode='23514';
  end if;
  if not exists(select 1 from public.ticket_credentials where ticket_id=p_ticket_id and credential_kind='native') then
    raise exception 'Native credential required' using errcode='23514';
  end if;
  update public.ticket_credentials set revoked_at=coalesce(revoked_at,clock_timestamp()) where ticket_id=p_ticket_id;
  if p_action='void' then
    update public.tickets set status='void' where id=p_ticket_id;
  else
    insert into public.ticket_credentials(ticket_id,credential_kind,token_digest)
    values(p_ticket_id,'native',extensions.digest(p_new_token,'sha256'));
  end if;
  insert into app_private.ticket_action_requests(request_id,actor_id,input_digest,ticket_id,action)
  values(p_request_id,(select auth.uid()),v_input,p_ticket_id,p_action);
  insert into public.audit_logs(organization_id,event_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_event.organization_id,v_event.id,(select auth.uid()),
    case when p_action='void' then 'ticket.voided' else 'ticket.credential_reissued' end,
    'ticket',p_ticket_id,jsonb_build_object('reason',btrim(p_reason),'request_id',p_request_id));
  return p_ticket_id;
end; $$;
revoke all on function public.manage_ticket_credential(uuid,text,uuid,text,text) from public,anon;
grant execute on function public.manage_ticket_credential(uuid,text,uuid,text,text) to authenticated;
commit;
