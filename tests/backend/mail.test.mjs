import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { encryptToken, decryptToken, encryptionKey, config, emailMessage, emailBundleMessage, mailLog } from '../../backend/mail.mjs';
import queueHandler from '../../netlify/functions/queue-ticket-emails.mjs';
import worker from '../../netlify/functions/send-ticket-emails.mjs';
const key = encryptionKey('ab'.repeat(32));
const token = 'sra1_' + 'A'.repeat(43);
const ticket = randomUUID();

test('AES-GCM binds the encrypted token to its ticket and rejects tampering', () => {
  const encrypted = encryptToken(token, ticket, key);
  assert.equal(decryptToken(encrypted, ticket, key), token);
  assert.ok(!encrypted.includes(token));
  assert.throws(() => decryptToken(encrypted, randomUUID(), key));
  const parts = encrypted.split('.'); parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
  assert.throws(() => decryptToken(parts.join('.'), ticket, key));
  assert.throws(() => encryptionKey('invalid'));
});
test('configuration defaults to disabled sending and 80 reservations/day', () => {
  const cfg = config({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'dummy', MAIL_QUEUE_ENCRYPTION_KEY: 'ab'.repeat(32) });
  assert.equal(cfg.sending, false); assert.equal(cfg.limit, 80);
  assert.throws(() => config({}));
});
test('disabled scheduled worker succeeds without secrets and never calls external services', async () => {
  const previousEnv = process.env; const previousFetch = global.fetch; const previousLog = console.info;
  const logs = []; let calls = 0;
  process.env = { MAIL_SENDING_ENABLED: 'false' };
  global.fetch = async () => { calls++; throw new Error('External call blocked'); };
  console.info = message => logs.push(JSON.parse(message));
  try {
    const response = await worker();
    assert.equal(response.status, 200); assert.equal(calls, 0);
    assert.equal(logs[0].event, 'worker_disabled');
  } finally { process.env = previousEnv; global.fetch = previousFetch; console.info = previousLog; }
});
test('configuration diagnostics identify the variable, never its secret value', async () => {
  const previousEnv = process.env; const previousLog = console.error; const previousFetch = global.fetch;
  const logs = []; let calls = 0;
  process.env = { MAIL_SENDING_ENABLED: 'true', SUPABASE_URL: 'https://mail-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE-TEST-VALUE', MAIL_QUEUE_ENCRYPTION_KEY: 'INVALID-PRIVATE-KEY' };
  console.error = value => logs.push(JSON.parse(value));
  global.fetch = async () => { calls++; throw new Error('No external calls expected'); };
  try {
    const response = await worker(); assert.equal(response.status, 503); assert.equal(calls, 0);
    assert.equal(logs[0].field, 'MAIL_QUEUE_ENCRYPTION_KEY');
    assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
    mailLog('error', 'test', { code: 'network_error', message: 'PRIVATE-TEST-VALUE', token: 'PRIVATE-TEST-VALUE' });
    assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
  } finally { process.env = previousEnv; console.error = previousLog; global.fetch = previousFetch; }
});
test('invalid switch, malformed URL and invalid reply-to are diagnosed before claiming work', () => {
  const base = { SUPABASE_URL: 'https://mail-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'dummy', MAIL_QUEUE_ENCRYPTION_KEY: 'ab'.repeat(32) };
  for (const [field, value] of [['MAIL_SENDING_ENABLED','treu'], ['SUPABASE_URL','bad-url'], ['EMAIL_REPLY_TO','bad-email']]) {
    assert.throws(() => config({ ...base, [field]: value }), error => error.field === field);
  }
});
test('message has escaped HTML, a PNG attachment and no public credential URL', async () => {
  const message = await emailMessage({ id: randomUUID(), ticket_id: ticket, recipient: 'person@example.invalid', holder_name: '<script>bad</script>', event_name: 'Santos Rock', venue: 'Los Santos', starts_at: '2026-11-15T01:00:00Z', timezone: 'America/Costa_Rica', type_name: 'General', access_zone: 'general' }, token, { from: 'pases@entradas.example.invalid', fromName: 'Santos Rock' });
  assert.ok(!message.htmlContent.includes('<script>')); assert.ok(message.htmlContent.includes('&lt;script&gt;'));
  assert.ok(message.htmlContent.includes(token));
  assert.ok(message.textContent.includes('Código de ingreso manual:\n' + token));
  assert.ok(!message.htmlContent.includes('href="' + token));
  assert.ok(message.htmlContent.includes('https://wa.me/50686896331'));
  assert.ok(message.textContent.includes('un único ingreso'));
  assert.equal(Buffer.from(message.attachment[0].content, 'base64').subarray(1, 4).toString(), 'PNG');
});
test('server endpoints: JWT checked, payload encrypted and disabled worker makes no external calls', async () => {
  const previousEnv = { ...process.env }; const originalFetch = global.fetch;
  Object.assign(process.env, { SUPABASE_URL: 'https://mail-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-only', MAIL_QUEUE_ENCRYPTION_KEY: 'ab'.repeat(32), MAIL_SENDING_ENABLED: 'false', APP_ORIGIN: 'https://access.example.invalid' });
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    if (String(url).includes('/auth/v1/user')) return Response.json({ id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.invalid' });
    if (String(url).includes('/rpc/queue_ticket_emails')) {
      const body = JSON.parse(options.body);
      assert.equal(body.p_actor_id, '11111111-1111-4111-8111-111111111111');
      assert.equal(decryptToken(body.p_items[0].encrypted_token, ticket, key), token);
      return Response.json([{ id: randomUUID(), status: 'pending', ticket_id: ticket }]);
    }
    throw new Error('Unexpected external call blocked in test');
  };
  try {
    const unauthorized = await queueHandler(new Request('https://access.example.invalid/.netlify/functions/queue-ticket-emails', { method: 'POST', body: '{}' }));
    assert.equal(unauthorized.status, 401); assert.equal(calls, 0);
    const request = new Request('https://access.example.invalid/.netlify/functions/queue-ticket-emails', { method: 'POST', headers: { Authorization: 'Bearer test-user-token', Origin: 'https://access.example.invalid' }, body: JSON.stringify({ items: [{ ticket_id: ticket, token }] }) });
    const response = await queueHandler(request); assert.equal(response.status, 200); assert.equal(calls, 2);
    await worker(); assert.equal(calls, 2);
  } finally { global.fetch = originalFetch; process.env = previousEnv; }
});
test('worker accepts provider confirmation once', async () => {
  const previousEnv = { ...process.env }; const originalFetch = global.fetch;
  Object.assign(process.env, { SUPABASE_URL: 'https://mail-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-only', MAIL_QUEUE_ENCRYPTION_KEY: 'ab'.repeat(32), MAIL_SENDING_ENABLED: 'true', BREVO_API_KEY: 'test-key', EMAIL_FROM: 'pases@entradas.example.invalid' });
  const id = randomUUID(); const lease = randomUUID(); let finish; let providerCalls = 0;
  global.fetch = async (url, options) => {
    const path = String(url);
    if (path.includes('/rpc/claim_ticket_email_deliveries')) return Response.json([{ id, lease_id: lease }]);
    if (path.includes('/rpc/get_claimed_ticket_email')) return Response.json({ id, ticket_id: ticket, recipient: 'person@example.invalid', encrypted_token: encryptToken(token, ticket, key), holder_name: 'Persona', event_name: 'Evento', starts_at: '2026-11-15T01:00:00Z', timezone: 'America/Costa_Rica', type_name: 'General', access_zone: 'general' });
    if (path.includes('api.brevo.com')) { providerCalls++; return Response.json({ messageId: '<test@example.invalid>' }, { status: 201 }); }
    if (path.includes('/rpc/finish_ticket_email')) { finish = JSON.parse(options.body); return new Response(null, { status: 204 }); }
    throw new Error('Unexpected call');
  };
  try { await worker(); assert.equal(providerCalls, 1); assert.equal(finish.p_status, 'submitted'); assert.equal(finish.p_provider_id, '<test@example.invalid>'); }
  finally { global.fetch = originalFetch; process.env = previousEnv; }
});
test('worker handles rejection, uncertain network and obsolete ticket without real sends', async () => {
  const previousEnv = { ...process.env }; const originalFetch = global.fetch;
  Object.assign(process.env, { SUPABASE_URL: 'https://mail-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-only', MAIL_QUEUE_ENCRYPTION_KEY: 'ab'.repeat(32), MAIL_SENDING_ENABLED: 'true', BREVO_API_KEY: 'test-key', EMAIL_FROM: 'pases@entradas.example.invalid' });
  try {
    for (const scenario of ['rejection', 'network', 'server-error', 'obsolete']) {
      const id = randomUUID(); const lease = randomUUID(); let finish; let providerCalls = 0;
      global.fetch = async (url, options) => {
        const path = String(url);
        if (path.includes('/rpc/claim_ticket_email_deliveries')) return Response.json([{ id, lease_id: lease }]);
        if (path.includes('/rpc/get_claimed_ticket_email')) return Response.json(scenario === 'obsolete' ? null : { id, ticket_id: ticket, recipient: 'person@example.invalid', encrypted_token: encryptToken(token, ticket, key), event_name: 'Evento', starts_at: '2026-11-15T01:00:00Z', timezone: 'America/Costa_Rica', type_name: 'General', access_zone: 'general' });
        if (path.includes('api.brevo.com')) {
          providerCalls++;
          if (scenario === 'network') throw new Error('Test network failure');
          return Response.json({ code: 'test' }, { status: scenario === 'server-error' ? 500 : 429 });
        }
        if (path.includes('/rpc/finish_ticket_email')) { finish = JSON.parse(options.body); return new Response(null, { status: 204 }); }
        throw new Error('Unexpected call');
      };
      await worker();
      assert.equal(finish.p_status, scenario === 'rejection' ? 'failed' : scenario === 'obsolete' ? 'cancelled' : 'unknown');
      assert.equal(providerCalls, scenario === 'obsolete' ? 0 : 1);
    }
  } finally { global.fetch = originalFetch; process.env = previousEnv; }
});

test('ticket email personalizes the greeting and uses event timezone, venue and type', async () => {
  const message = await emailMessage({ id: randomUUID(), ticket_id: ticket, recipient: 'javier@example.invalid', holder_name: '  Javier Solano ', event_name: 'Festival Santos Rock 2027', venue: 'Rancho Turístico El Guayabal, Santa María de Dota.', starts_at: '2027-01-16T23:00:00Z', timezone: 'America/Costa_Rica', type_name: 'Staff', access_zone: 'general' }, token, { from: 'pases@example.invalid', fromName: 'Santos Rock' });
  assert.ok(message.textContent.startsWith('¡Hola, Javier! 🤘'));
  assert.match(message.textContent, /sábado,? 16 de enero de 2027/);
  assert.match(message.textContent, /5:00/);
  assert.ok(message.textContent.includes('Rancho Turístico El Guayabal, Santa María de Dota.'));
  assert.ok(message.textContent.includes('Tipo: Staff\nZona: General'));
  assert.ok(message.subject.includes('Festival Santos Rock 2027'));
  const other = await emailMessage({ id: randomUUID(), ticket_id: ticket, recipient: 'test@example.invalid', event_name: 'Otro evento', venue: null, starts_at: '2028-02-01T01:00:00Z', timezone: 'America/Costa_Rica', type_name: 'General', access_zone: 'general' }, token, { from: 'pases@example.invalid' });
  assert.ok(other.textContent.startsWith('¡Hola! 🤘'));
  assert.ok(other.textContent.includes('Otro evento'));
  assert.ok(other.textContent.includes('Lugar por definir'));
  assert.ok(!other.textContent.includes('2027'));
});

test('bundle sends distinct QR attachments and manual codes in one message and rejects mixed recipients', async () => {
  const base = { id: randomUUID(), ticket_id: ticket, recipient: 'buyer@example.invalid', holder_name: 'Comprador', event_name: 'Festival', starts_at: '2027-01-16T23:00:00Z', timezone: 'America/Costa_Rica', type_name: 'General', access_zone: 'general' };
  const entries = Array.from({ length: 3 }, (_, i) => ({ job: { ...base, id: randomUUID(), ticket_id: randomUUID() }, token: 'sra1_' + String.fromCharCode(65 + i).repeat(43) }));
  const deliveryKey = randomUUID();
  const message = await emailBundleMessage(entries, { from: 'test@example.invalid' }, deliveryKey);
  assert.equal(message.attachment.length, 3);
  assert.equal(new Set(message.attachment.map(a => a.content)).size, 3);
  assert.equal(message.to.length, 1);
  assert.equal(message.headers.idempotencyKey, deliveryKey);
  await assert.rejects(() => emailBundleMessage(entries, {}, randomUUID() + ':' + randomUUID()), /invalid_idempotency_key/);
  for (const entry of entries) { assert.ok(message.htmlContent.includes(entry.token)); assert.ok(message.textContent.includes(entry.token)); }
  assert.ok(message.subject.includes('3 entradas'));
  assert.ok(message.textContent.includes('Entrada 3 de 3'));
  await assert.rejects(() => emailBundleMessage([entries[0], { ...entries[1], job: { ...entries[1].job, recipient: 'other@example.invalid' } }], {}, randomUUID()));
});
test('grouped worker submits once for all valid companions and finalizes their shared delivery', async () => {
  const previousEnv = { ...process.env }; const originalFetch = global.fetch;
  Object.assign(process.env, { SUPABASE_URL: 'https://mail-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-only', MAIL_QUEUE_ENCRYPTION_KEY: 'ab'.repeat(32), MAIL_SENDING_ENABLED: 'true', BREVO_API_KEY: 'test-key', EMAIL_FROM: 'pases@example.invalid' });
  const delivery = randomUUID(); const lease = randomUUID(); const ids = [randomUUID(), randomUUID(), randomUUID()];
  const jobs = ids.slice(0, 2).map((id, i) => { const ticket_id = randomUUID(); return { id, ticket_id, recipient: 'buyer@example.invalid', encrypted_token: encryptToken('sra1_' + String.fromCharCode(65 + i).repeat(43), ticket_id, key), event_name: 'Test', starts_at: '2027-01-16T23:00:00Z', timezone: 'America/Costa_Rica', type_name: 'General', access_zone: 'general' }; });
  let providerCalls = 0; let finish;
  global.fetch = async (url, options) => {
    const path = String(url);
    if (path.includes('/rpc/claim_ticket_email_deliveries')) return Response.json(ids.map(id => ({ id, lease_id: lease, delivery_id: delivery })));
    if (path.includes('/rpc/get_claimed_ticket_email_delivery')) return Response.json(jobs);
    if (path.includes('api.brevo.com')) { providerCalls++; const message = JSON.parse(options.body); assert.equal(message.attachment.length, 2); assert.equal(message.to.length, 1); assert.equal(message.headers.idempotencyKey, lease); assert.match(message.headers.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); return Response.json({ messageId: 'group-test' }, { status: 201 }); }
    if (path.includes('/rpc/finish_ticket_email_delivery')) { finish = JSON.parse(options.body); return new Response(null, { status: 204 }); }
    throw new Error('Unexpected external call');
  };
  try { await worker(); assert.equal(providerCalls, 1); assert.deepEqual(finish.p_job_ids, ids.slice(0, 2)); assert.equal(finish.p_status, 'submitted'); assert.equal(finish.p_delivery_id, delivery); }
  finally { global.fetch = originalFetch; process.env = previousEnv; }
});
