import { config as mailConfig, client, decryptToken, emailMessage, sendingEnabled, mailLog } from '../../server/mail.mjs';
export const config = { schedule: '*/15 * * * *' };

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
    const result = await db.rpc('claim_ticket_emails', { p_daily_limit: cfg.limit, p_limit: 3 });
    if (result.error) { mailLog('error', 'claim_failed', { code: result.error.code }); return new Response('Queue unavailable', { status: 503 }); }
    claims = result.data;
  } catch { mailLog('error', 'claim_failed', { code: 'network_error' }); return new Response('Queue unavailable', { status: 503 }); }
  mailLog('info', 'jobs_claimed', { count: claims?.length || 0 });
  for (const claim of claims || []) {
    let status = 'unknown'; let providerId = null; let errorCode = null;
    try {
      const { data: job, error: jobError } = await db.rpc('get_claimed_ticket_email', { p_job_id: claim.id, p_lease_id: claim.lease_id });
      if (jobError) throw new Error('queue_unavailable');
      if (!job) { status = 'cancelled'; errorCode = 'ticket_no_longer_sendable'; }
      else {
        let token; let message;
        try { token = decryptToken(job.encrypted_token, job.ticket_id, cfg.key); message = await emailMessage(job, token, cfg); }
        catch { status = 'failed'; throw new Error('credential_preparation_failed'); }
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(message), signal: AbortSignal.timeout(5000),
        });
        if (response.status === 201) {
          const result = await response.json();
          status = 'submitted'; providerId = typeof result.messageId === 'string' ? result.messageId : null;
        } else if (response.status >= 400 && response.status < 500) { status = 'failed'; errorCode = `brevo_http_${response.status}`; }
        else { status = 'unknown'; errorCode = `brevo_http_${response.status}`; }
      }
    } catch (failure) { errorCode = failure.message === 'credential_preparation_failed' ? failure.message : 'provider_or_worker_uncertain'; }
    let finishError;
    try {
      ({ error: finishError } = await db.rpc('finish_ticket_email', { p_job_id: claim.id, p_lease_id: claim.lease_id, p_status: status, p_provider_id: providerId, p_error: errorCode }));
    } catch { finishError = { code: 'network_error' }; }
    if (finishError) { mailLog('error', 'finish_failed', { job_id: claim.id, code: finishError.code }); return new Response('Queue result could not be confirmed', { status: 503 }); }
    mailLog(status === 'submitted' ? 'info' : 'warn', 'job_finished', { job_id: claim.id, status, code: errorCode });
  }
  return new Response('Queue processed');
}
