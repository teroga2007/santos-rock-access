-- Append inside ticket_redemption.sql's transaction, BEFORE its final rollback.
-- Reuses the random fixtures and exercised scenarios from the redemption suite.
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
do $$ declare d jsonb; source_summary jsonb; begin
  d:=public.get_event_dashboard(current_setting('sra_scan.event')::uuid);
  if d->'totals'<>jsonb_build_object('total',3,'admitted',1,'pending',1,'voided',1) then
    raise exception 'Dashboard totals incorrect: %',d->'totals';
  end if;
  if d->>'event_status'<>'closed' then raise exception 'Dashboard status stale'; end if;
  source_summary:=d->'sources'->0;
  if jsonb_array_length(d->'sources')<>1 or source_summary->>'source'<>'complimentary'
    or (source_summary->>'total')::int<>3 or (source_summary->>'admitted')::int<>1 then
    raise exception 'Source breakdown incorrect';
  end if;
  if jsonb_array_length(d->'types')<>1 or (d->'types'->0->>'capacity')::int<>10
    or (d->'types'->0->>'total')::int<>3 then raise exception 'Type breakdown incorrect'; end if;
  if jsonb_array_length(d->'recent')<>8 then raise exception 'Activity count incorrect'; end if;
  if (select count(*) from jsonb_array_elements(d->'recent') r where r->>'result'='accepted')<>1 then
    raise exception 'Retries duplicated recent activity';
  end if;
  if d::text like '%sra1_%' or d::text like '%token_digest%' or d::text like '%Test holder%' or d::text like '%actor_id%' then
    raise exception 'Dashboard leaked sensitive data';
  end if;
  d:=public.get_event_dashboard(current_setting('sra_scan.other_event')::uuid);
  if (d->'totals'->>'total')::int<>1 or jsonb_array_length(d->'recent')<>0 then
    raise exception 'Dashboard mixed event data';
  end if;
end; $$;
select set_config('sra_scan.empty_event',public.create_event(current_setting('sra_scan.org')::uuid,'Empty dashboard event',now())::text,true);
do $$ declare d jsonb; begin
  d:=public.get_event_dashboard(current_setting('sra_scan.empty_event')::uuid);
  if d->'totals'<>jsonb_build_object('total',0,'admitted',0,'pending',0,'voided',0)
    or d->'sources'<>'[]'::jsonb or d->'types'<>'[]'::jsonb or d->'recent'<>'[]'::jsonb then
    raise exception 'Empty event did not return zero totals and empty lists';
  end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.scanner'),true);
do $$ begin
  begin perform public.get_event_dashboard(current_setting('sra_scan.event')::uuid);
    raise exception 'Scanner accessed dashboard';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
update public.event_members set role='supervisor' where event_id=current_setting('sra_scan.event')::uuid and user_id=current_setting('sra_scan.scanner')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.scanner'),true);
do $$ declare d jsonb; begin
  d:=public.get_event_dashboard(current_setting('sra_scan.event')::uuid);
  if (d->'totals'->>'admitted')::int<>1 then raise exception 'Supervisor could not access summary'; end if;
  begin perform public.get_event_dashboard(current_setting('sra_scan.other_event')::uuid);
    raise exception 'Supervisor accessed unassigned event';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
