import { config as mailConfig, client, decryptToken, emailMessage } from '../../server/mail.mjs';
export const config = { schedule: '*/15 * * * *' };

export default async function handler() {
  let cfg; try { cfg = mailConfig(); } catch { return new Response('Mail configuration pending', { status: 503 }); }
  if (!cfg.sending) return new Response('Mail sending disabled');
  const db = client(cfg);
  const { data: claims, error } = await db.rpc('claim_ticket_emails', { p_daily_limit: cfg.limit, p_limit: 3 });
  if (error) return new Response('Queue unavailable', { status: 503 });
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
    const { error: finishError } = await db.rpc('finish_ticket_email', { p_job_id: claim.id, p_lease_id: claim.lease_id, p_status: status, p_provider_id: providerId, p_error: errorCode });
    if (finishError) return new Response('Queue result could not be confirmed', { status: 503 });
  }
  return new Response('Queue processed');
}
