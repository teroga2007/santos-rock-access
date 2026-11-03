import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function configurationError(field) {
  return Object.assign(new Error('mail_configuration'), { code: 'mail_configuration', field });
}
export function sendingEnabled(env = process.env) {
  const value = String(env.MAIL_SENDING_ENABLED || 'false').trim().toLowerCase();
  if (!['true', 'false'].includes(value)) throw configurationError('MAIL_SENDING_ENABLED');
  return value === 'true';
}
// Deliberately omit exception messages, payloads, addresses and credentials.
export function mailLog(level, event, fields = {}) {
  const safe = {};
  for (const key of ['code', 'field', 'job_id', 'status', 'http_status', 'count']) {
    if (fields[key] !== undefined) safe[key] = fields[key];
  }
  console[level](JSON.stringify({ component: 'ticket_mail', event, ...safe }));
}

export function encryptionKey(value) {
  if (!/^[0-9a-f]{64}$/i.test(value || '')) throw configurationError('MAIL_QUEUE_ENCRYPTION_KEY');
  return Buffer.from(value, 'hex');
}
export function encryptToken(token, ticketId, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(ticketId));
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}
export function decryptToken(value, ticketId, key) {
  const [version, iv, tag, body] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('invalid_envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(ticketId)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const token = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  if (!/^sra1_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('invalid_token');
  return token;
}
export function config(env = process.env) {
  const limit = Number(env.EMAIL_DAILY_LIMIT || 80);
  if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw configurationError('EMAIL_DAILY_LIMIT');
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  if (!url) throw configurationError('SUPABASE_URL');
  try { if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error(); }
  catch { throw configurationError('SUPABASE_URL'); }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw configurationError('SUPABASE_SERVICE_ROLE_KEY');
  const key = encryptionKey(env.MAIL_QUEUE_ENCRYPTION_KEY);
  const sending = sendingEnabled(env);
  if (sending && !env.BREVO_API_KEY) throw configurationError('BREVO_API_KEY');
  if (sending && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_FROM || '')) throw configurationError('EMAIL_FROM');
  if (env.EMAIL_REPLY_TO && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_REPLY_TO)) throw configurationError('EMAIL_REPLY_TO');
  return { url, key, limit, sending, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, apiKey: env.BREVO_API_KEY,
    from: env.EMAIL_FROM, fromName: env.EMAIL_FROM_NAME || 'Santos Rock', replyTo: env.EMAIL_REPLY_TO, origin: env.APP_ORIGIN };
}
export const client = cfg => createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
export const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
export async function emailMessage(job, token, cfg) {
  const { default: QRCode } = await import('qrcode');
  const png = await QRCode.toBuffer(token, { width: 600, margin: 4, errorCorrectionLevel: 'M' });
  const date = new Intl.DateTimeFormat('es-CR', { timeZone: job.timezone, dateStyle: 'long', timeStyle: 'short' }).format(new Date(job.starts_at));
  return {
    sender: { name: cfg.fromName, email: cfg.from }, to: [{ email: job.recipient, name: job.holder_name || 'Asistente' }],
    ...(cfg.replyTo ? { replyTo: { email: cfg.replyTo } } : {}),
    subject: `Tu entrada para ${job.event_name}`.replace(/[\r\n]/g, ' ').slice(0, 200),
    htmlContent: `<h1>${escapeHtml(job.event_name)}</h1><p>Hola ${escapeHtml(job.holder_name || 'asistente')}.</p><p>${escapeHtml(date)} · ${escapeHtml(job.venue || 'Lugar por definir')}</p><p>${escapeHtml(job.type_name)} · Zona ${escapeHtml(job.access_zone)}</p><p>Tu QR está adjunto. Guardalo y presentalo al ingresar. Es personal y permite un solo ingreso; no lo compartás.</p><p>Entrada: ${escapeHtml(job.ticket_id)}</p>`,
    textContent: `${job.event_name}\n${date}\n${job.venue || 'Lugar por definir'}\n${job.type_name} · ${job.access_zone}\nTu QR está adjunto. Guardalo y presentalo al ingresar. Un solo ingreso.\nEntrada: ${job.ticket_id}`,
    attachment: [{ name: `santos-rock-${job.ticket_id}.png`, content: png.toString('base64') }],
    headers: { idempotencyKey: job.id }, tags: ['santos-rock-access'],
  };
}
