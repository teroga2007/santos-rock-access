import { config as mailConfig, client, decryptToken, emailBundleMessage, sendingEnabled, mailLog } from '../mail.mjs';

export default async function handler() {
  let cfg;
  try {
    if (!sendingEnabled()) {
      mailLog('info', 'worker_disabled');
      // Validate runtime variables without creating a client or making any request.
      try { mailConfig({ ...process.env, MAIL_SENDING_ENABLED: 'true' }); mailLog('info', 'configuration_validated'); }
      catch (error) { mailLog('warn', 'configuration_warning', { code: error.code, field: error.field }); }
      return new Response('Mail sending disabled');
    }
    cfg = mailConfig();
  } catch (error) { mailLog('error', 'configuration_error', { code: error.code, field: error.field }); return new Response('Mail configuration pending', { status: 503 }); }
  const db = client(cfg);
  let claims;
  try {
    const result = await db.rpc('claim_ticket_email_deliveries', { p_daily_limit: cfg.limit, p_limit: 3 });
    if (result.error) { mailLog('error', 'claim_failed', { code: result.error.code }); return new Response('Queue unavailable', { status: 503 }); }
    claims = result.data;
  } catch { mailLog('error', 'claim_failed', { code: 'network_error' }); return new Response('Queue unavailable', { status: 503 }); }
  mailLog('info', 'jobs_claimed', { count: claims?.length || 0 });
  const deliveries = new Map();
  for (const claim of claims || []) {
    const id = claim.delivery_id || claim.id;
    if (!deliveries.has(id)) deliveries.set(id, []);
    deliveries.get(id).push(claim);
  }
  for (const group of deliveries.values()) {
    const claim = group[0];
    let jobIds = group.map(item => item.id);
    let status = 'unknown'; let providerId = null; let errorCode = null;
    try {
      const { data, error: jobError } = claim.delivery_id
        ? await db.rpc('get_claimed_ticket_email_delivery', { p_delivery_id: claim.delivery_id, p_lease_id: claim.lease_id })
        : await db.rpc('get_claimed_ticket_email', { p_job_id: claim.id, p_lease_id: claim.lease_id });
      const jobs = claim.delivery_id ? data : data ? [data] : [];
      if (jobError) throw new Error('queue_unavailable');
      if (!Array.isArray(jobs)) throw new Error('queue_unavailable');
      jobIds = jobs.map(job => job.id);
      if (!jobs.length) { status = 'cancelled'; errorCode = 'ticket_no_longer_sendable'; }
      else {
        let message;
        try { message = await emailBundleMessage(jobs.map(job => ({ job, token: decryptToken(job.encrypted_token, job.ticket_id, cfg.key) })), cfg, claim.lease_id); }
        catch { status = 'failed'; throw new Error('credential_preparation_failed'); }
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(message), signal: AbortSignal.timeout(5000),
        });
        if (response.status === 201) {
          const result = await response.json();
          status = 'submitted'; providerId = typeof result.messageId === 'string' ? result.messageId : null;
        } else if (response.status >= 400 && response.status < 500) {
          status = 'failed'; errorCode = `brevo_http_${response.status}`;
          // Store only recognized provider codes; never log response messages or payloads.
          try {
            const body = await response.json();
            if (['invalid_parameter', 'missing_parameter', 'out_of_range', 'unauthorized', 'duplicate_parameter'].includes(body.code)) errorCode += ':' + body.code;
          } catch { /* The HTTP status remains sufficient if the body is not JSON. */ }
        }
        else { status = 'unknown'; errorCode = `brevo_http_${response.status}`; }
      }
    } catch (failure) { errorCode = failure.message === 'credential_preparation_failed' ? failure.message : 'provider_or_worker_uncertain'; }
    let finishError;
    try {
      ({ error: finishError } = claim.delivery_id
        ? await db.rpc('finish_ticket_email_delivery', { p_delivery_id: claim.delivery_id, p_lease_id: claim.lease_id, p_job_ids: jobIds, p_status: status, p_provider_id: providerId, p_error: errorCode })
        : await db.rpc('finish_ticket_email', { p_job_id: claim.id, p_lease_id: claim.lease_id, p_status: status, p_provider_id: providerId, p_error: errorCode }));
    } catch { finishError = { code: 'network_error' }; }
    if (finishError) { mailLog('error', 'finish_failed', { job_id: claim.id, code: finishError.code }); return new Response('Queue result could not be confirmed', { status: 503 }); }
    mailLog(status === 'submitted' ? 'info' : 'warn', 'job_finished', { job_id: claim.id, status, code: errorCode });
  }
  return new Response('Queue processed');
}
