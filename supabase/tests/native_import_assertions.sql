-- Append inside ticket_redemption.sql's transaction, before its final rollback.
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
select set_config('sra_csv.event',public.create_event(current_setting('sra_scan.org')::uuid,'CSV test',now())::text,true);
select set_config('sra_csv.type',public.create_ticket_type(current_setting('sra_csv.event')::uuid,'CSV general',5)::text,true);
select set_config('sra_csv.small_type',public.create_ticket_type(current_setting('sra_csv.event')::uuid,'CSV small',1)::text,true);
select set_config('sra_csv.batch',gen_random_uuid()::text,true);
select set_config('sra_csv.rows',jsonb_build_array(
  jsonb_build_object('name','Import One','email','one@example.invalid','reference','PAY-1','token','sra1_'||repeat('X',43)),
  jsonb_build_object('name','Import Two','email','two@example.invalid','reference','PAY-1','token','sra1_'||repeat('Y',43)))::text,true);
do $$ declare r jsonb; repeated jsonb; begin
  -- If the second row exceeds capacity, the entire batch must roll back.
  begin perform public.import_native_tickets(current_setting('sra_csv.event')::uuid,current_setting('sra_csv.small_type')::uuid,'sinpe',gen_random_uuid(),current_setting('sra_csv.rows')::jsonb);
    raise exception 'Import exceeded capacity';
  exception when check_violation then null; end;
  r:=public.import_native_tickets(current_setting('sra_csv.event')::uuid,current_setting('sra_csv.type')::uuid,'sinpe',current_setting('sra_csv.batch')::uuid,current_setting('sra_csv.rows')::jsonb);
  if jsonb_array_length(r)<>2 then raise exception 'Incorrect import result'; end if;
  repeated:=public.import_native_tickets(current_setting('sra_csv.event')::uuid,current_setting('sra_csv.type')::uuid,'sinpe',current_setting('sra_csv.batch')::uuid,current_setting('sra_csv.rows')::jsonb);
  if repeated<>r then raise exception 'Retry changed tickets'; end if;
  begin perform public.import_native_tickets(current_setting('sra_csv.event')::uuid,current_setting('sra_csv.type')::uuid,'other',current_setting('sra_csv.batch')::uuid,current_setting('sra_csv.rows')::jsonb);
    raise exception 'Import ID accepted changed input';
  exception when invalid_parameter_value then null; end;
  begin perform public.import_native_tickets(current_setting('sra_csv.event')::uuid,current_setting('sra_csv.type')::uuid,'sinpe',gen_random_uuid(),jsonb_build_array(
    jsonb_build_object('name','Import Two','email','two@example.invalid','reference','PAY-1','token','sra1_'||repeat('Z',43)),
    jsonb_build_object('name','Import One','email','one@example.invalid','reference','PAY-1','token','sra1_'||repeat('W',43))));
    raise exception 'Reordered duplicate CSV accepted';
  exception when unique_violation then null; end;
  begin perform public.import_native_tickets(current_setting('sra_csv.event')::uuid,current_setting('sra_csv.type')::uuid,'sinpe',gen_random_uuid(),jsonb_build_array(
    jsonb_build_object('name','Import Three','email','three@example.invalid','reference','PAY-2','token','sra1_'||repeat('Z',43)),
    jsonb_build_object('name','Import One','email','one@example.invalid','reference','PAY-1','token','sra1_'||repeat('W',43))));
    raise exception 'Partially overlapping CSV accepted';
  exception when unique_violation then null; end;

  begin perform public.import_native_tickets(current_setting('sra_csv.event')::uuid,current_setting('sra_csv.type')::uuid,'other',gen_random_uuid(),jsonb_build_array(
    jsonb_build_object('name','Invalid email','email','not-an-email','token','sra1_'||repeat('Z',43))));
    raise exception 'Invalid email accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.import_native_tickets(current_setting('sra_csv.event')::uuid,current_setting('sra_csv.type')::uuid,'ticketera',gen_random_uuid(),current_setting('sra_csv.rows')::jsonb);
    raise exception 'External source imported natively';
  exception when invalid_parameter_value then null; end;
  begin perform public.import_native_tickets(current_setting('sra_scan.other_event')::uuid,current_setting('sra_csv.type')::uuid,'other',gen_random_uuid(),current_setting('sra_csv.rows')::jsonb);
    raise exception 'Cross-event type accepted';
  exception when check_violation then null; end;
end; $$;
select public.provision_event_member(current_setting('sra_csv.event')::uuid,current_setting('sra_scan.scanner')::uuid,'supervisor');
select set_config('request.jwt.claim.sub',current_setting('sra_scan.scanner'),true);
do $$ begin
  begin perform public.import_native_tickets(current_setting('sra_csv.event')::uuid,current_setting('sra_csv.type')::uuid,'other',gen_random_uuid(),current_setting('sra_csv.rows')::jsonb);
    raise exception 'Supervisor imported tickets';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
do $$ begin
  if (select count(*) from public.tickets where event_id=current_setting('sra_csv.event')::uuid)<>2 then raise exception 'Import duplicated tickets or left partial rows'; end if;
  if (select count(*) from public.import_batches where event_id=current_setting('sra_csv.event')::uuid)<>1 then raise exception 'Failed imports left batches'; end if;
  if not exists(select 1 from public.import_batches where id=current_setting('sra_csv.batch')::uuid and status='completed' and row_count=2) then raise exception 'Batch status incorrect'; end if;
  if (select count(*) from public.tickets where import_batch_id=current_setting('sra_csv.batch')::uuid)<>2 then raise exception 'Tickets not associated with batch'; end if;
  if (select count(*) from public.orders where event_id=current_setting('sra_csv.event')::uuid and payment_status='verified')<>2 then raise exception 'Imported payments not recorded'; end if;
  if (select count(*) from public.audit_logs where event_id=current_setting('sra_csv.event')::uuid and action='tickets.imported')<>1 then raise exception 'Batch audit duplicated or missing'; end if;
end; $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('sra_scan.owner'),true);
select set_config('sra_csv.large_type',public.create_ticket_type(current_setting('sra_csv.event')::uuid,'CSV max batch',100)::text,true);
do $$ declare rows jsonb; result jsonb; begin
  select jsonb_agg(jsonb_build_object('name','Bulk person '||i::text,'email','bulk'||i::text||'@example.invalid','reference','BULK-'||i::text,
    'token','sra1_'||lpad(i::text,43,'0')) order by i) into rows from generate_series(1,100) i;
  result:=public.import_native_tickets(current_setting('sra_csv.event')::uuid,current_setting('sra_csv.large_type')::uuid,'sinpe',gen_random_uuid(),rows);
  if jsonb_array_length(result)<>100 then raise exception 'Maximum batch did not issue 100 tickets'; end if;
  begin perform public.import_native_tickets(current_setting('sra_csv.event')::uuid,current_setting('sra_csv.large_type')::uuid,'sinpe',gen_random_uuid(),rows||jsonb_build_array(rows->0));
    raise exception 'More than 100 rows accepted';
  exception when invalid_parameter_value then null; end;
end; $$;
reset role;
