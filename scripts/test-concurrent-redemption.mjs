import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

// Real independent database sessions via the existing authenticated CLI.
// Requires an explicit linked project; never loads application secrets or real users.
const args = process.argv.slice(2);
const expectedProject = args[args.indexOf('--project-ref') + 1];
if (!args.includes('--remote') || !args.includes('--project-ref') || !/^[a-z0-9]{20}$/.test(expectedProject || '')) {
  throw new Error('Uso: npm run test:concurrency -- --remote --project-ref REF_DEL_PROYECTO');
}
const linkedProject = (await readFile('supabase/.temp/project-ref', 'utf8')).trim();
assert.equal(linkedProject, expectedProject, 'El proyecto vinculado no coincide con el autorizado');
if (!process.env.npm_execpath) throw new Error('Ejecutar mediante npm run test:concurrency');
const npx = join(dirname(process.env.npm_execpath), 'npx-cli.js');
const folder = await mkdtemp(join(tmpdir(), 'sra-concurrency-'));
const files = [];
const run = randomUUID();
const ids = { org: randomUUID(), event: randomUUID(), type: randomUUID(), owner: randomUUID(), scanners: Array.from({ length: 4 }, randomUUID) };
const tokens = Array.from({ length: 9 }, () => 'sra1_' + randomBytes(32).toString('base64url'));
const tickets = Array.from({ length: 8 }, randomUUID);
let sequence = 0;
let interrupted = false;
process.on('SIGINT', () => { interrupted = true; process.exitCode = 1; });
const report = { run, project: expectedProject, started_at: new Date().toISOString(), scenarios: [], cleanup_verified: false,
  limitation: 'SQL con claims simulados; no mide JWT, cámara, PostgREST ni rendimiento de 999 asistentes. Cada operación retiene sus locks 0.5 s para forzar contención.' };

async function sql(text, label) {
  const file = join(folder, `${String(sequence++).padStart(3, '0')}-${label}.sql`);
  files.push(file); await writeFile(file, text, 'utf8');
  return new Promise((resolveQuery, reject) => {
    const child = spawn(process.execPath, [npx, '--yes', 'supabase', 'db', 'query', '--remote', '--file', file, '--yes'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill(), 60000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        // Do not echo SQL/credential-bearing statements or unfiltered CLI output.
        reject(new Error(`Falló ${label} (salida ${code}). Archivo de recuperación: ${join(folder, 'cleanup.sql')}`)); return;
      }
      try {
        const value = JSON.parse(stdout.slice(stdout.indexOf('{')));
        if (!Array.isArray(value.rows)) throw new Error('Missing query rows');
        resolveQuery(value.rows);
      } catch { reject(new Error(`Respuesta inesperada de CLI en ${label}; no se imprimen credenciales.`)); }
    });
  });
}

const setup = `begin;
set local statement_timeout='20s';
insert into auth.users(id,email,invited_at,aud,role,raw_user_meta_data)
select u,u::text||'@example.invalid',now(),'authenticated','authenticated',jsonb_build_object('sra_concurrency_run','${run}')
from unnest(array[${[ids.owner, ...ids.scanners].map(id => `'${id}'::uuid`).join(',')}]) u;
insert into public.organizations(id,name,slug) values('${ids.org}','Prueba concurrente temporal','test-concurrency-${run}');
insert into public.organization_members(organization_id,user_id,role) values
('${ids.org}','${ids.owner}','owner'),${ids.scanners.map(id => `('${ids.org}','${id}','member')`).join(',')};
insert into public.events(id,organization_id,name,starts_at,status) values('${ids.event}','${ids.org}','Prueba concurrente temporal',now(),'live');
insert into public.event_members(event_id,user_id,role) values ${ids.scanners.map(id => `('${ids.event}','${id}','scanner')`).join(',')};
insert into public.ticket_types(id,event_id,name,capacity) values('${ids.type}','${ids.event}','Prueba concurrencia',999);
${tickets.map((id, i) => `insert into public.tickets(id,event_id,type_id,source) values('${id}','${ids.event}','${ids.type}','complimentary');
insert into public.ticket_credentials(ticket_id,credential_kind,token_digest) values('${id}','native',extensions.digest('${tokens[i]}','sha256'));`).join('\n')}
commit;
select '${run}' as fixture_run;`;

const cleanup = `begin;
set local statement_timeout='20s';
do $$ begin
 if exists(select 1 from public.organizations where id='${ids.org}' and slug<>'test-concurrency-${run}') then
   raise exception 'Fixture organization tag mismatch';
 end if;
 if exists(select 1 from public.events where id='${ids.event}' and organization_id<>'${ids.org}') then
   raise exception 'Fixture event tag mismatch';
 end if;
end; $$;
delete from public.audit_logs where organization_id='${ids.org}';
delete from app_private.redemption_requests where event_id='${ids.event}';
delete from app_private.ticket_action_requests where ticket_id in(select id from public.tickets where event_id='${ids.event}');
delete from app_private.issuance_requests where ticket_id in(select id from public.tickets where event_id='${ids.event}');
delete from public.checkins where event_id='${ids.event}';
delete from public.ticket_credentials where ticket_id in(select id from public.tickets where event_id='${ids.event}');
delete from public.tickets where event_id='${ids.event}';
delete from public.ticket_types where event_id='${ids.event}';
delete from public.event_members where event_id='${ids.event}';
delete from public.events where id='${ids.event}' and organization_id='${ids.org}';
delete from public.organization_members where organization_id='${ids.org}';
delete from public.organizations where id='${ids.org}' and slug='test-concurrency-${run}';
delete from auth.users where id in(${[ids.owner, ...ids.scanners].map(id => `'${id}'`).join(',')}) and raw_user_meta_data->>'sra_concurrency_run'='${run}';
commit;
select not exists(select 1 from public.organizations where id='${ids.org}')
 and not exists(select 1 from public.events where id='${ids.event}')
 and not exists(select 1 from auth.users where raw_user_meta_data->>'sra_concurrency_run'='${run}') as clean;`;
await writeFile(join(folder, 'cleanup.sql'), cleanup, 'utf8');
files.push(join(folder, 'cleanup.sql'));
console.log(`Prueba aislada ${run}. Proyecto: ${expectedProject}. 4 operadores; sin correos ni asistentes reales.`);

function operation(actor, expression) {
  return `begin;
set local statement_timeout='20s'; set local lock_timeout='10s';
set local role authenticated;
select set_config('request.jwt.claim.sub','${actor}',true);
select set_config('sra_perf.started',clock_timestamp()::text,true);
do $$ declare response jsonb; begin
 begin response := ${expression};
 exception when check_violation then response:=jsonb_build_object('error',SQLSTATE); end;
 perform set_config('sra_perf.response',response::text,true);
 perform pg_sleep(0.5);
end; $$;
select current_setting('sra_perf.response')::jsonb as response,pg_backend_pid() as backend,
current_setting('sra_perf.started')::timestamptz as started_at,clock_timestamp() as finished_at;
commit;`;
}
const redeem = (index, request = randomUUID()) => `public.redeem_ticket('${ids.event}','${tokens[index]}','${request}')`;
const action = (index, kind, token = null) => `jsonb_build_object('ticket_id',public.manage_ticket_credential('${tickets[index]}','${kind}','${randomUUID()}','Prueba concurrente aislada',${token ? `'${token}'` : 'null'}))`;

async function parallel(label, statements) {
  if (interrupted) throw new Error('Prueba interrumpida; se limpiarán los fixtures');
  console.log(`Ejecutando: ${label} (${statements.length} sesiones).`);
  const settled = await Promise.allSettled(statements.map((statement, i) => sql(statement, `${label}-${i}`)));
  const failure = settled.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const rows = settled.map(result => result.value[0]);
  const distinct = new Set(rows.map(row => row.backend)).size;
  const maxOverlap = Math.max(...rows.map(row => {
    const instant = Date.parse(row.started_at);
    return rows.filter(other => Date.parse(other.started_at) <= instant && Date.parse(other.finished_at) > instant).length;
  }));
  assert.ok(distinct >= 2 && maxOverlap >= 2, `${label}: no se demostró concurrencia real; repetir la prueba`);
  const summary = { scenario: label, sessions: rows.length, independent_backends: distinct, maximum_overlap: maxOverlap,
    results: rows.map(row => row.response.result || (row.response.error ? `rejected:${row.response.error}` : 'action_applied')) };
  report.scenarios.push(summary);
  console.log(`${label}: ${summary.results.join(', ')}; solapamiento máximo ${maxOverlap}.`);
  return rows;
}

let failure;
try {
  await sql(setup, 'setup');
  const same = await parallel('same-qr', ids.scanners.map(actor => operation(actor, redeem(0))));
  assert.equal(same.filter(row => row.response.result === 'accepted').length, 1);
  assert.equal(same.filter(row => row.response.result === 'duplicate').length, 3);
  const retryId = randomUUID();
  const retries = await parallel('same-request-retry', ids.scanners.map(() => operation(ids.scanners[0], redeem(1, retryId))));
  assert.ok(retries.every(row => row.response.result === 'accepted'));
  assert.ok(retries.every(row => JSON.stringify(row.response) === JSON.stringify(retries[0].response)));
  const voidRace = await parallel('void-versus-scan', [operation(ids.owner, action(2, 'void')), operation(ids.scanners[0], redeem(2))]);
  assert.ok((voidRace[0].response.ticket_id === tickets[2] && voidRace[1].response.result === 'void') ||
    (voidRace[0].response.error === '23514' && voidRace[1].response.result === 'accepted'));
  const rotation = await parallel('reissue-versus-scan', [operation(ids.owner, action(3, 'reissue', tokens[8])), operation(ids.scanners[1], redeem(3))]);
  const rotated = rotation[0].response.ticket_id === tickets[3];
  assert.ok((rotated && rotation[1].response.result === 'void') ||
    (rotation[0].response.error === '23514' && rotation[1].response.result === 'accepted'));
  if (rotated) {
    const result = await sql(operation(ids.scanners[1], `public.redeem_ticket('${ids.event}','${tokens[8]}','${randomUUID()}')`), 'new-qr');
    assert.equal(result[0].response.result, 'accepted');
  }
  const different = await parallel('different-qr', ids.scanners.map((actor, i) => operation(actor, redeem(i + 4))));
  assert.ok(different.every(row => row.response.result === 'accepted'));
  const invariant = await sql(`select
    (select count(*) from public.checkins where ticket_id='${tickets[0]}' and result='accepted') as same_qr_acceptances,
    (select count(*) from public.checkins where ticket_id='${tickets[1]}' and result='accepted') as retry_acceptances,
    (select count(*) from app_private.redemption_requests where request_id='${retryId}') as retry_requests,
    (select count(*) from public.audit_logs where event_id='${ids.event}' and metadata->>'request_id'='${retryId}') as retry_audits,
    not exists(select ticket_id from public.checkins where event_id='${ids.event}' and result='accepted' group by ticket_id having count(*)>1) as one_acceptance_per_ticket;`, 'invariants');
  const row = invariant[0];
  assert.equal(Number(row.same_qr_acceptances), 1); assert.equal(Number(row.retry_acceptances), 1);
  assert.equal(Number(row.retry_requests), 1); assert.equal(Number(row.retry_audits), 1); assert.equal(row.one_acceptance_per_ticket, true);
  report.invariants = row;
} catch (error) { failure = error; }
finally {
  console.log('Limpiando exclusivamente los fixtures de esta ejecución…');
  try {
    const rows = await sql(cleanup, 'cleanup-run');
    assert.equal(rows[0].clean, true);
    report.cleanup_verified = true;
    for (const file of files) await unlink(file);
    await rmdir(folder);
  } catch {
    report.cleanup_verified = false;
    failure = new Error(`No se pudo verificar la limpieza. Ejecutar el SQL de recuperación: ${join(folder, 'cleanup.sql')}`);
  }
  report.finished_at = new Date().toISOString();
  report.passed = !failure && !interrupted;
  await writeFile(resolve('docs/concurrency-latest.json'), JSON.stringify(report, null, 2) + '\n');
}
if (failure) { console.error(failure.message); process.exitCode = 1; }
else if (!interrupted) console.log('Pruebas concurrentes correctas. Limpieza verificada. Informe: docs/concurrency-latest.json');
